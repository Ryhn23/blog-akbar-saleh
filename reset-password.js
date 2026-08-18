require('dotenv').config();
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const rawDbPath = process.env.DATABASE_PATH || './data/database.sqlite';
const dbPath = path.isAbsolute(rawDbPath) ? rawDbPath : path.join(__dirname, rawDbPath);

function resetPassword() {
  console.log('Memulai proses reset password untuk Blog Akbar Saleh...');

  if (!fs.existsSync(dbPath)) {
    console.error(`Error: Database tidak ditemukan di "${dbPath}". Jalankan aplikasi terlebih dahulu.`);
    process.exit(1);
  }

  try {
    const db = new Database(dbPath);
    const targetUsername = process.env.ADMIN_USERNAME || 'admin';
    const newPassword = process.env.ADMIN_PASSWORD || 'admin123';

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(targetUsername);

    const hash = bcrypt.hashSync(newPassword, 10);

    if (!user) {
      console.log(`User "${targetUsername}" tidak ditemukan. Membuat user admin baru...`);
      db.prepare('INSERT INTO users (username, password, name) VALUES (?, ?, ?)')
        .run(targetUsername, hash, process.env.AUTHOR_NAME || 'Akbar Saleh');
    } else {
      db.prepare('UPDATE users SET password = ? WHERE username = ?').run(hash, targetUsername);
    }

    console.log(`✅ SUKSES! Password untuk user "${targetUsername}" telah direset menjadi: ${newPassword}`);
    console.log('Silakan login di /admin/login dan Anda dapat mengubahnya sewaktu-waktu di menu Pengaturan.');
    db.close();
  } catch (error) {
    console.error('Terjadi kesalahan saat mereset password:', error);
    process.exit(1);
  }
}

resetPassword();
