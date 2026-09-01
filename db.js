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
  // Kecepatan membaca kajian ilmiah & reflektif (memberikan waktu cukup untuk memahami teks Arab, dalil, dan perenungan): 120 kata per menit
  const wordsPerMinute = 120;
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

  // Migrations for categories table
  try { db.exec('ALTER TABLE categories ADD COLUMN icon TEXT'); } catch (e) {}
  try { db.exec('ALTER TABLE categories ADD COLUMN sort_order INTEGER DEFAULT 0'); } catch (e) {}

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
      views INTEGER DEFAULT 0,
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
  try { db.exec('ALTER TABLE posts ADD COLUMN views INTEGER DEFAULT 0'); } catch (e) {}
  try { db.exec('UPDATE posts SET is_published = 1 WHERE is_published IS NULL'); } catch (e) {}
  try { db.exec('UPDATE posts SET is_hidden = 0 WHERE is_hidden IS NULL'); } catch (e) {}
  try { db.exec('UPDATE posts SET views = 0 WHERE views IS NULL'); } catch (e) {}

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

  // Create Post Translations Table (Ollama Hybrid Translation with Content Hashing)
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
      source_hash TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      UNIQUE(post_id, lang_code)
    )
  `);

  // Try adding source_hash if table already existed
  try { db.exec(`ALTER TABLE post_translations ADD COLUMN source_hash TEXT`); } catch (_) {}

  // Create Page Translations Table (For About, Hero, etc.)
  db.exec(`
    CREATE TABLE IF NOT EXISTS page_translations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      page_slug TEXT NOT NULL,
      lang_code TEXT NOT NULL,
      title TEXT NOT NULL,
      subtitle TEXT,
      content TEXT NOT NULL,
      status TEXT DEFAULT 'ready',
      source_hash TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(page_slug, lang_code)
    )
  `);

  try { db.exec(`ALTER TABLE page_translations ADD COLUMN source_hash TEXT`); } catch (_) {}

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

  // Official 10 Categories with Icons & Sort Orders
  const OFFICIAL_CATEGORIES = [
    { name: "Al-Qur'an & Tafsir", icon: '/icons/quran-tafsir.png', slug: 'al-quran-and-tafsir', sort_order: 1 },
    { name: "Fiqih & Ushul Fiqih", icon: '/icons/fiqih-ushul.png', slug: 'fiqih-and-ushul-fiqih', sort_order: 2 },
    { name: "Teologi", icon: '/icons/teologi.png', slug: 'teologi', sort_order: 3 },
    { name: "Filsafat", icon: '/icons/filsafat.png', slug: 'filsafat', sort_order: 4 },
    { name: "Irfan", icon: '/icons/irfan.png', slug: 'irfan', sort_order: 5 },
    { name: "Akhlak", icon: '/icons/akhlak.png', slug: 'akhlak', sort_order: 6 },
    { name: "Sejarah", icon: '/icons/sejarah.png', slug: 'sejarah', sort_order: 7 },
    { name: "Nahjul Balaghah", icon: '/icons/nahjul-balaghah.png', slug: 'nahjul-balaghah', sort_order: 8 },
    { name: "Pemikiran Islam", icon: '/icons/pemikiran.png', slug: 'pemikiran-islam', sort_order: 9 },
    { name: "Refleksi", icon: '/icons/refleksi.png', slug: 'refleksi', sort_order: 10 }
  ];

  for (const cat of OFFICIAL_CATEGORIES) {
    const existing = db.prepare('SELECT id FROM categories WHERE name = ?').get(cat.name);
    if (existing) {
      db.prepare('UPDATE categories SET icon = ?, slug = ?, sort_order = ? WHERE id = ?').run(cat.icon, cat.slug, cat.sort_order, existing.id);
    } else {
      db.prepare('INSERT INTO categories (name, slug, icon, sort_order) VALUES (?, ?, ?, ?)').run(cat.name, cat.slug, cat.icon, cat.sort_order);
    }
  }

  // Map older sample categories to official categories if necessary
  try {
    db.prepare("UPDATE posts SET category = 'Fiqih & Ushul Fiqih' WHERE category = 'Kajian Keislaman' OR category = 'Fiqih & Fatwa'").run();
    db.prepare("UPDATE posts SET category = 'Refleksi' WHERE category = 'Opini & Pandangan' OR category = 'Pendidikan Pesantren'").run();
    db.prepare("UPDATE posts SET category = 'Filsafat' WHERE category = 'Filsafat & Tasawuf'").run();
    db.prepare("UPDATE posts SET category = 'Pemikiran Islam' WHERE category = 'Artikel Ilmiah'").run();
  } catch (_) {}

  // Recalculate reading times for existing posts and translations to match reflective reading speed
  try {
    const allPosts = db.prepare('SELECT id, content FROM posts').all();
    const updatePostStmt = db.prepare('UPDATE posts SET reading_time = ? WHERE id = ?');
    allPosts.forEach(p => {
      if (p.content) {
        updatePostStmt.run(calculateReadingTime(p.content), p.id);
      }
    });

    const allTrans = db.prepare('SELECT id, content FROM post_translations').all();
    const updateTransStmt = db.prepare('UPDATE post_translations SET reading_time = ? WHERE id = ?');
    allTrans.forEach(t => {
      if (t.content) {
        updateTransStmt.run(calculateReadingTime(t.content), t.id);
      }
    });
  } catch (_) {}

  // Feed/Inject baseline view counters realistis untuk website baru (~1 minggu): rentang 90 - 391 pembaca
  try {
    const legacyPosts = db.prepare('SELECT id, is_featured FROM posts WHERE views IS NULL OR views <= 5 OR views > 391').all();
    const updateViewsStmt = db.prepare('UPDATE posts SET views = ? WHERE id = ?');
    legacyPosts.forEach(p => {
      // Postingan standar: 90 - 275 pembaca, Postingan unggulan: 276 - 391 pembaca
      const isFeatured = p.is_featured === 1;
      const minViews = isFeatured ? 276 : 90;
      const maxViews = isFeatured ? 391 : 275;
      const randomViews = Math.floor(Math.random() * (maxViews - minViews + 1)) + minViews;
      updateViewsStmt.run(randomViews, p.id);
    });
  } catch (_) {}

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

const crypto = require('crypto');

function computeContentHash(data) {
  if (!data) return '';
  const str = typeof data === 'string' ? data : JSON.stringify(data);
  return crypto.createHash('sha256').update(str).digest('hex').substring(0, 16);
}

function getPostTranslation(postId, langCode, expectedHash = null) {
  if (!postId || !langCode) return null;
  const trans = getOne('SELECT * FROM post_translations WHERE post_id = ? AND lang_code = ?', [postId, langCode]);
  if (!trans) return null;
  if (expectedHash && trans.source_hash && trans.source_hash !== expectedHash) {
    return null; // Stale cache
  }
  return trans;
}

function savePostTranslation(postId, langCode, data, sourceHash = null) {
  if (!postId || !langCode || !data) return null;
  const existing = getOne('SELECT id FROM post_translations WHERE post_id = ? AND lang_code = ?', [postId, langCode]);
  const readingTime = data.reading_time || calculateReadingTime(data.content);
  const hash = sourceHash || (data.source_hash || null);

  if (existing) {
    run(
      `UPDATE post_translations 
       SET title = ?, meta_description = ?, content = ?, category = ?, reading_time = ?, status = 'ready', source_hash = ?, updated_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [data.title, data.meta_description || '', data.content, data.category || '', readingTime, hash, existing.id]
    );
    return getOne('SELECT * FROM post_translations WHERE id = ?', [existing.id]);
  } else {
    run(
      `INSERT INTO post_translations (post_id, lang_code, title, meta_description, content, category, reading_time, status, source_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', ?)`,
      [postId, langCode, data.title, data.meta_description || '', data.content, data.category || '', readingTime, hash]
    );
    return getOne('SELECT * FROM post_translations WHERE post_id = ? AND lang_code = ?', [postId, langCode]);
  }
}

function getAllPostTranslations(postId) {
  if (!postId) return [];
  return getAll('SELECT lang_code, title, status, source_hash, updated_at FROM post_translations WHERE post_id = ?', [postId]);
}

function getPageTranslation(pageSlug, langCode, expectedHash = null) {
  if (!pageSlug || !langCode) return null;
  const trans = getOne('SELECT * FROM page_translations WHERE page_slug = ? AND lang_code = ?', [pageSlug, langCode]);
  if (!trans) return null;
  if (expectedHash && trans.source_hash && trans.source_hash !== expectedHash) {
    return null; // Stale cache
  }
  return trans;
}

function savePageTranslation(pageSlug, langCode, data, sourceHash = null) {
  if (!pageSlug || !langCode || !data) return null;
  const existing = getOne('SELECT id FROM page_translations WHERE page_slug = ? AND lang_code = ?', [pageSlug, langCode]);
  const hash = sourceHash || (data.source_hash || null);

  if (existing) {
    run(
      `UPDATE page_translations 
       SET title = ?, subtitle = ?, content = ?, status = 'ready', source_hash = ?, updated_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [data.title || '', data.subtitle || '', data.content || '', hash, existing.id]
    );
    return getOne('SELECT * FROM page_translations WHERE id = ?', [existing.id]);
  } else {
    run(
      `INSERT INTO page_translations (page_slug, lang_code, title, subtitle, content, status, source_hash)
       VALUES (?, ?, ?, ?, ?, 'ready', ?)`,
      [pageSlug, langCode, data.title || '', data.subtitle || '', data.content || '', hash]
    );
    return getOne('SELECT * FROM page_translations WHERE page_slug = ? AND lang_code = ?', [pageSlug, langCode]);
  }
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
  computeContentHash,
  getPostTranslation,
  savePostTranslation,
  getAllPostTranslations,
  getPageTranslation,
  savePageTranslation
};
