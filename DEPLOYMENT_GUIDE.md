# Panduan Lengkap Deployment & Operasional Blog Akbar Saleh

Dokumen ini berisi panduan langkah-demi-langkah untuk menjalankan blog di lingkungan lokal (*development/testing*), inisialisasi Git mandiri, hingga deployment produksi di **VPS berbasis Docker**.

---

## 1. Menjalankan di Komputer Lokal

### A. Mode Development Langsung (Node.js)
1. **Pastikan file `.env` sudah ada:**
   ```bash
   cp .env.example .env
   ```
2. **Kompilasi CSS Tailwind:**
   ```bash
   npm run build:css
   ```
3. **Jalankan server aplikasi:**
   ```bash
   npm run dev
   # atau untuk mode standar:
   npm start
   ```
4. Buka peramban di `http://localhost:7842`.
5. Halaman login admin: `http://localhost:7842/admin/login` (Default: `admin` / `admin123`).

---

### B. Uji Coba Menggunakan Docker di Lokal
Untuk memastikan container bekerja identik dengan VPS:
```bash
# Build dan jalankan container
docker compose up --build

# Untuk menghentikan
docker compose down
```
Aplikasi akan aktif di `http://localhost:7842`. Data database SQLite tersimpan secara persisten di folder `./data/` dan gambar di `./public/uploads/`.

---

## 2. Inisialisasi Git Repository Mandiri

Karena repo lama (BRIM) sudah dibersihkan total, inisialisasi git repository baru Anda:

```bash
# 1. Inisialisasi git baru
git init

# 2. Tambahkan semua file
git add .

# 3. Buat commit pertama
git commit -m "feat: initial release Blog Akbar Saleh v2.0"

# 4. Ubah branch utama menjadi main
git branch -M main

# 5. Hubungkan ke remote repository Anda (GitHub / GitLab)
git remote add origin git@github.com:USERNAME/blog-akbar-saleh.git

# 6. Push ke remote
git push -u origin main
```

---

## 3. Langkah Deployment ke VPS (Docker & Nginx)

### Langkah 1: Persiapan di VPS
Pastikan VPS Anda (Ubuntu / Debian / OS lainnya) telah terpasang:
- **Docker & Docker Compose Plugin**
- **Nginx** (sebagai Reverse Proxy & SSL Terminating)
- **Certbot** (untuk SSL HTTPS gratis dari Let's Encrypt)
- **UFW Firewall** (Port 22, 80, 443 terbuka):
  ```bash
  sudo ufw allow OpenSSH
  sudo ufw allow 'Nginx Full'
  sudo ufw enable
  ```

---

### Langkah 2: Clone Repository di VPS
Masuk ke VPS via SSH, lalu clone repository Anda:
```bash
cd /var/www  # atau direktori pilihan Anda, misal /home/ubuntu
git clone git@github.com:USERNAME/blog-akbar-saleh.git
cd blog-akbar-saleh
```

---

### Langkah 3: Konfigurasi Environment Variable (`.env`)
Buat file `.env` produksi:
```bash
cp .env.example .env
nano .env
```

**Sesuaikan variabel berikut:**
```env
PORT=7842
NODE_ENV=production
APP_URL=https://yourdomain.com

# Ganti dengan string acak yang kuat
SESSION_SECRET=kunci-rahasia-acak-super-aman-minimal-32-karakter
ALLOWED_ORIGINS=https://yourdomain.com

# Database
DATABASE_PATH=/app/data/database.sqlite

# Admin Credentials Awal
ADMIN_USERNAME=akbar
ADMIN_PASSWORD=PasswordKuatAnda123!
```

---

### Langkah 4: Jalankan Container Docker
```bash
docker compose up -d --build
```
Cek status container:
```bash
docker compose ps
docker compose logs -f
```

---

### Langkah 5: Konfigurasi Nginx & SSL HTTPS
1. Buat konfigurasi Nginx:
   ```bash
   sudo nano /etc/nginx/sites-available/blog-akbar-saleh
   ```
   Salin isi dari file `nginx.conf.example`, sesuaikan `yourdomain.com` dengan domain Anda.

2. Aktifkan konfigurasi Nginx:
   ```bash
   sudo ln -s /etc/nginx/sites-available/blog-akbar-saleh /etc/nginx/sites-enabled/
   sudo nginx -t
   sudo systemctl reload nginx
   ```

3. Pasang sertifikat SSL otomatis dengan Certbot:
   ```bash
   sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
   ```

Selamat! Blog Akbar Saleh kini telah aktif di `https://yourdomain.com`.

---

## 4. Cara Update Blog di Masa Depan

Bila ada pembaruan kode atau tampilan dari komputer lokal Anda:
1. Di komputer lokal:
   ```bash
   git add .
   git commit -m "update: fitur baru"
   git push origin main
   ```
2. Di VPS Anda:
   ```bash
   cd /var/www/blog-akbar-saleh
   git pull origin main
   docker compose up -d --build
   ```
*(Proses update hanya memakan waktu beberapa detik tanpa menghapus data database maupun gambar yang telah diunggah).*

---

## 5. Prosedur Backup Data SQLite & Uploads

Database dan media blog berada di dua folder lokal pada host VPS:
- Database: `./data/database.sqlite`
- Media/Gambar: `./public/uploads/`

### Script Backup Cepat (Cronjob):
```bash
# Contoh membuat arsip backup harian
tar -czvf /backup/blog-backup-$(date +%F).tar.gz ./data ./public/uploads
```
