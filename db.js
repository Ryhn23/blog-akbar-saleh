const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const slugify = require('slugify');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const rawDbPath = process.env.DATABASE_PATH || './data/database.sqlite';
const dbPath = path.isAbsolute(rawDbPath) ? rawDbPath : path.join(__dirname, rawDbPath);

// Ensure parent folder exists
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

let db = null;

function calculateReadingTime(htmlOrText) {
  if (!htmlOrText) return 1;
  const cleanText = htmlOrText.replace(/<[^>]+>/g, ' ').trim();
  const wordCount = cleanText.split(/\s+/).filter(Boolean).length;
  const wordsPerMinute = 200;
  const minutes = Math.ceil(wordCount / wordsPerMinute);
  return minutes > 0 ? minutes : 1;
}

function initDB() {
  if (db) return db;

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Create Users Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT,
      email TEXT,
      google_id TEXT,
      avatar TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Migrations for users table
  try { db.exec('ALTER TABLE users ADD COLUMN email TEXT'); } catch (e) {}
  try { db.exec('ALTER TABLE users ADD COLUMN google_id TEXT'); } catch (e) {}
  try { db.exec('ALTER TABLE users ADD COLUMN avatar TEXT'); } catch (e) {}

  // Create Categories Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create Posts Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      content TEXT NOT NULL,
      meta_description TEXT,
      category TEXT DEFAULT 'Kajian Keislaman',
      cover_image TEXT,
      is_featured INTEGER DEFAULT 0,
      is_published INTEGER DEFAULT 1,
      is_hidden INTEGER DEFAULT 0,
      reading_time INTEGER DEFAULT 1,
      attachment_url TEXT,
      attachment_name TEXT,
      attachment_size INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Migrations for posts table
  try { db.exec('ALTER TABLE posts ADD COLUMN attachment_url TEXT'); } catch (e) {}
  try { db.exec('ALTER TABLE posts ADD COLUMN attachment_name TEXT'); } catch (e) {}
  try { db.exec('ALTER TABLE posts ADD COLUMN attachment_size INTEGER DEFAULT 0'); } catch (e) {}
  try { db.exec('ALTER TABLE posts ADD COLUMN is_published INTEGER DEFAULT 1'); } catch (e) {}
  try { db.exec('ALTER TABLE posts ADD COLUMN is_hidden INTEGER DEFAULT 0'); } catch (e) {}
  try { db.exec('UPDATE posts SET is_published = 1 WHERE is_published IS NULL'); } catch (e) {}
  try { db.exec('UPDATE posts SET is_hidden = 0 WHERE is_hidden IS NULL'); } catch (e) {}

  // Create Comments Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      parent_id INTEGER DEFAULT NULL,
      user_name TEXT NOT NULL,
      user_email TEXT NOT NULL,
      user_avatar TEXT,
      content TEXT NOT NULL,
      is_author INTEGER DEFAULT 0,
      status TEXT DEFAULT 'approved',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_id) REFERENCES comments(id) ON DELETE CASCADE
    )
  `);

  // Create Pages Table (For Dynamic About, etc.)
  db.exec(`
    CREATE TABLE IF NOT EXISTS pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      subtitle TEXT,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create Post Translations Table (Ollama Hybrid Translation)
  db.exec(`
    CREATE TABLE IF NOT EXISTS post_translations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      lang_code TEXT NOT NULL,
      title TEXT NOT NULL,
      meta_description TEXT,
      content TEXT NOT NULL,
      category TEXT,
      reading_time INTEGER DEFAULT 1,
      status TEXT DEFAULT 'ready',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      UNIQUE(post_id, lang_code)
    )
  `);

  // Seed default About page if not exists
  const aboutPage = db.prepare('SELECT id FROM pages WHERE slug = ?').get('about');
  if (!aboutPage) {
    const defaultTitle = 'Tentang Penulis';
    const defaultSubtitle = process.env.AUTHOR_ROLE || 'Pengasuh Pondok Pesantren Khatamun Nabiyyin Jakarta';
    const defaultContent = `
<p><strong>Akbar Saleh, B.A.</strong> adalah Kyai dan Pengasuh <strong>Pondok Pesantren Khatamun Nabiyyin Jakarta</strong>. Beliau mendedikasikan pemikiran dan aktivitasnya dalam pembinaan keilmuan santri, kajian teks-teks klasik keislaman (turats), serta kajian keislaman kontemporer berbasis riset dan metodologi ilmiah.</p>
<h2>Fokus Kajian & Riset</h2>
<p>Melalui media publikasi personal ini, artikel dan tulisan yang diterbitkan berfokus pada:</p>
<ul>
  <li><strong>Studi Keislaman & Fiqih:</strong> Telaah hukum Islam, ushul fiqih, dan kontekstualisasi fatwa terhadap dinamika zaman.</li>
  <li><strong>Artikel Ilmiah & Filsafat Islam:</strong> Pembahasan epistemologi, logika, dan pemikiran para ulama serta filsuf muslim.</li>
  <li><strong>Pendidikan & Tradisi Pesantren:</strong> Integrasi sains, nalar kritis, dan spiritualitas dalam tradisi pesantren.</li>
  <li><strong>Opini & Pandangan Sosial:</strong> Analisis reflektif terhadap dinamika keumatan, kebangsaan, dan persaudaraan insani.</li>
</ul>
<h2>Pondok Pesantren Khatamun Nabiyyin Jakarta</h2>
<p>Pondok Pesantren Khatamun Nabiyyin Jakarta merupakan lembaga pendidikan Islam yang berfokus pada pembentukan kader-kader intelektual muslim yang mendalam dalam ilmu agama, memiliki integritas moral, nalar kritis ilmiah, dan berakhlak karimah.</p>
    `.trim();

    db.prepare('INSERT INTO pages (slug, title, subtitle, content) VALUES (?, ?, ?, ?)').run(
      'about',
      defaultTitle,
      defaultSubtitle,
      defaultContent
    );
  }

  // Seed default Home Hero header if not exists
  const homePage = db.prepare('SELECT id FROM pages WHERE slug = ?').get('home');
  if (!homePage) {
    db.prepare('INSERT INTO pages (slug, title, subtitle, content) VALUES (?, ?, ?, ?)').run(
      'home',
      'Catatan, Kajian Ilmiah & <span class="text-emerald-800">Pemikiran Keislaman</span>',
      'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ',
      'Selamat datang di ruang tulisan pribadi saya. Halaman ini memuat riset ilmiah, telaah studi keislaman, opini sosial-keagamaan, serta catatan refleksi dari <strong>Pondok Pesantren Khatamun Nabiyyin Jakarta</strong>.'
    );
  }

  // Seed default categories if empty
  const catCount = db.prepare('SELECT COUNT(*) as count FROM categories').get().count;
  if (catCount === 0) {
    const defaultCats = [
      'Kajian Keislaman',
      'Artikel Ilmiah',
      'Opini & Pandangan',
      'Pendidikan Pesantren',
      'Filsafat & Tasawuf',
      'Fiqih & Fatwa'
    ];
    const insertCat = db.prepare('INSERT OR IGNORE INTO categories (name, slug) VALUES (?, ?)');
    for (const name of defaultCats) {
      const slug = slugify(name, { lower: true, strict: true });
      insertCat.run(name, slug);
    }
  }

  // Create Login Lockouts Table for Progressive Brute-Force Protection
  db.exec(`
    CREATE TABLE IF NOT EXISTS login_lockouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      identifier TEXT UNIQUE NOT NULL,
      failed_attempts INTEGER DEFAULT 0,
      lockout_tier INTEGER DEFAULT 0,
      locked_until INTEGER DEFAULT 0,
      last_failed_at INTEGER DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create default admin user if none exists
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  if (userCount === 0) {
    const adminUser = process.env.ADMIN_USERNAME || 'admin';
    const adminPass = process.env.ADMIN_PASSWORD || 'admin123';
    const authorName = process.env.AUTHOR_NAME || 'Akbar Saleh, B.A.';
    const hash = bcrypt.hashSync(adminPass, 10);
    
    db.prepare('INSERT INTO users (username, password, name) VALUES (?, ?, ?)')
      .run(adminUser, hash, authorName);
    console.log(`[Database] Default admin user initialized: username="${adminUser}"`);
  }

  return db;
}

// Query Helpers
function getAll(sql, params = []) {
  if (!db) initDB();
  return db.prepare(sql).all(...(Array.isArray(params) ? params : [params]));
}

function getOne(sql, params = []) {
  if (!db) initDB();
  return db.prepare(sql).get(...(Array.isArray(params) ? params : [params])) || null;
}

function run(sql, params = []) {
  if (!db) initDB();
  return db.prepare(sql).run(...(Array.isArray(params) ? params : [params]));
}

// --- PROGRESSIVE LOGIN LOCKOUT SYSTEM ---
// Tiers: 1 (15m), 2 (30m), 3 (1h), 4 (3h), 5 (24h / 1 hari)
const LOCKOUT_DURATIONS = [
  0,
  15 * 60 * 1000,      // Tier 1: 15 menit
  30 * 60 * 1000,      // Tier 2: 30 menit
  60 * 60 * 1000,      // Tier 3: 1 jam
  3 * 60 * 60 * 1000,  // Tier 4: 3 jam
  24 * 60 * 60 * 1000  // Tier 5: 1 hari
];

function formatRemainingDuration(ms) {
  if (ms <= 0) return '0 menit';
  const totalSeconds = Math.ceil(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.ceil((totalSeconds % 3600) / 60);

  if (hours > 0) {
    return `${hours} jam ${minutes > 0 ? minutes + ' menit' : ''}`.trim();
  }
  return `${minutes} menit`;
}

function getLockoutStatus(identifier) {
  if (!identifier) return { isLocked: false };
  const cleanId = String(identifier).trim().toLowerCase();
  const record = getOne('SELECT * FROM login_lockouts WHERE identifier = ?', [cleanId]);
  if (!record) return { isLocked: false };

  const now = Date.now();
  if (record.locked_until && record.locked_until > now) {
    const remainingMs = record.locked_until - now;
    return {
      isLocked: true,
      remainingMs,
      remainingText: formatRemainingDuration(remainingMs),
      tier: record.lockout_tier
    };
  }

  return { isLocked: false, record };
}

function recordFailedLoginAttempt(identifier) {
  if (!identifier) return { isLocked: false };
  const cleanId = String(identifier).trim().toLowerCase();
  const now = Date.now();
  const record = getOne('SELECT * FROM login_lockouts WHERE identifier = ?', [cleanId]);

  if (!record) {
    run(
      'INSERT INTO login_lockouts (identifier, failed_attempts, lockout_tier, locked_until, last_failed_at) VALUES (?, 1, 0, 0, ?)',
      [cleanId, now]
    );
    return {
      isLocked: false,
      failedAttempts: 1,
      remainingAttempts: 4
    };
  }

  let attempts = record.failed_attempts + 1;
  let tier = record.lockout_tier || 0;
  let lockedUntil = 0;

  if (attempts >= 5) {
    tier = Math.min(tier + 1, 5);
    const duration = LOCKOUT_DURATIONS[tier] || LOCKOUT_DURATIONS[1];
    lockedUntil = now + duration;
    attempts = 0; // reset attempts for next cycle

    run(
      'UPDATE login_lockouts SET failed_attempts = ?, lockout_tier = ?, locked_until = ?, last_failed_at = ?, updated_at = CURRENT_TIMESTAMP WHERE identifier = ?',
      [attempts, tier, lockedUntil, now, cleanId]
    );

    return {
      isLocked: true,
      tier,
      durationMs: duration,
      remainingMs: duration,
      remainingText: formatRemainingDuration(duration)
    };
  } else {
    run(
      'UPDATE login_lockouts SET failed_attempts = ?, last_failed_at = ?, updated_at = CURRENT_TIMESTAMP WHERE identifier = ?',
      [attempts, now, cleanId]
    );

    return {
      isLocked: false,
      failedAttempts: attempts,
      remainingAttempts: 5 - attempts
    };
  }
}

function clearFailedLoginAttempts(identifier) {
  if (!identifier) return;
  const cleanId = String(identifier).trim().toLowerCase();
  run('DELETE FROM login_lockouts WHERE identifier = ?', [cleanId]);
}

function getPostTranslation(postId, langCode) {
  if (!postId || !langCode) return null;
  return getOne('SELECT * FROM post_translations WHERE post_id = ? AND lang_code = ?', [postId, langCode]);
}

function savePostTranslation(postId, langCode, data) {
  if (!postId || !langCode || !data) return null;
  const existing = getOne('SELECT id FROM post_translations WHERE post_id = ? AND lang_code = ?', [postId, langCode]);
  const readingTime = data.reading_time || calculateReadingTime(data.content);

  if (existing) {
    run(
      `UPDATE post_translations 
       SET title = ?, meta_description = ?, content = ?, category = ?, reading_time = ?, status = 'ready', updated_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [data.title, data.meta_description || '', data.content, data.category || '', readingTime, existing.id]
    );
    return getOne('SELECT * FROM post_translations WHERE id = ?', [existing.id]);
  } else {
    run(
      `INSERT INTO post_translations (post_id, lang_code, title, meta_description, content, category, reading_time, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'ready')`,
      [postId, langCode, data.title, data.meta_description || '', data.content, data.category || '', readingTime]
    );
    return getOne('SELECT * FROM post_translations WHERE post_id = ? AND lang_code = ?', [postId, langCode]);
  }
}

function getAllPostTranslations(postId) {
  if (!postId) return [];
  return getAll('SELECT lang_code, title, status, updated_at FROM post_translations WHERE post_id = ?', [postId]);
}

module.exports = {
  initDB,
  getAll,
  getOne,
  run,
  calculateReadingTime,
  getLockoutStatus,
  recordFailedLoginAttempt,
  clearFailedLoginAttempts,
  getPostTranslation,
  savePostTranslation,
  getAllPostTranslations
};
