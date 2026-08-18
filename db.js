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
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

  // Seed default admin if table is empty
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

module.exports = {
  initDB,
  getAll,
  getOne,
  run,
  calculateReadingTime
};
