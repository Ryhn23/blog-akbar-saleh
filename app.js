require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const slugify = require('slugify');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const sanitizeHtml = require('sanitize-html');

const {
  initDB,
  getAll,
  getOne,
  run,
  calculateReadingTime,
  getLockoutStatus,
  recordFailedLoginAttempt,
  clearFailedLoginAttempts
} = require('./db');
const { generateArticlePdf } = require('./services/pdf-service');

const app = express();
const PORT = process.env.PORT || 7842;
const isProd = process.env.NODE_ENV === 'production';

// Initialize Database
initDB();

// Google OAuth 2.0 Configuration
const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
const googleCallbackUrl = process.env.GOOGLE_CALLBACK_URL || `${process.env.APP_URL || 'http://localhost:7842'}/auth/google/callback`;
const isGoogleAuthEnabled = Boolean(googleClientId && googleClientSecret);

if (isGoogleAuthEnabled) {
  passport.use(new GoogleStrategy({
    clientID: googleClientId,
    clientSecret: googleClientSecret,
    callbackURL: googleCallbackUrl
  }, (accessToken, refreshToken, profile, done) => {
    const user = {
      googleId: profile.id,
      name: profile.displayName || 'Pembaca',
      email: (profile.emails && profile.emails[0] ? profile.emails[0].value : ''),
      avatar: (profile.photos && profile.photos[0] ? profile.photos[0].value : '')
    };
    return done(null, user);
  }));
}

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

// Ensure upload directory exists
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer Storage Configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const baseName = path.basename(file.originalname, ext);
    const cleanName = slugify(baseName, { lower: true, strict: true }) || 'file';
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E6);
    cb(null, `${cleanName}-${uniqueSuffix}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB limit
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'attachment_file') {
      const allowedDoc = /pdf|docx|doc|pptx|ppt|xlsx|xls|txt|rtf|zip|rar|7z|odt|ods|odp/;
      const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
      if (allowedDoc.test(ext) || (file.mimetype && (file.mimetype.includes('pdf') || file.mimetype.includes('document') || file.mimetype.includes('text') || file.mimetype.includes('zip') || file.mimetype.includes('compressed')))) {
        return cb(null, true);
      }
      return cb(new Error('Format file dokumen tidak didukung! Gunakan PDF, DOCX, PPTX, XLSX, TXT, atau ZIP.'));
    }
    // Default image check for cover_file and Quill inline images
    const allowedTypes = /jpeg|jpg|png|webp|gif|svg/;
    const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
    const mime = file.mimetype;
    if (allowedTypes.test(ext) || allowedTypes.test(mime)) {
      return cb(null, true);
    }
    return cb(new Error('Format file tidak didukung!'));
  }
});

const postUploadMiddleware = upload.fields([
  { name: 'cover_file', maxCount: 1 },
  { name: 'attachment_file', maxCount: 1 }
]);

// View Engine & Static Assets
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use(express.json({ limit: '20mb' }));

// Trust reverse proxy (Nginx / Docker)
if (isProd || process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}

// Security: Helmet
app.use(helmet({
  contentSecurityPolicy: false, // Allows Quill, Google Fonts, AOS, CDN icons
  crossOriginEmbedderPolicy: false
}));

// Security: CORS
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim());
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Blocked by CORS'));
    }
  },
  credentials: true
}));

// Rate Limiter
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false
});
app.use(generalLimiter);

const loginLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 15,
  message: 'Terlalu banyak percobaan login dari IP ini. Silakan coba lagi setelah satu jam.'
});

// Session Middleware
app.use(session({
  secret: process.env.SESSION_SECRET || 'akbar-saleh-default-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: isProd && process.env.COOKIE_SECURE === 'true',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 7 // 7 days
  }
}));

app.use(passport.initialize());

// Global Template Variables Middleware
app.use((req, res, next) => {
  res.locals.siteName = process.env.SITE_NAME || 'Akbar Saleh';
  res.locals.siteTagline = process.env.SITE_TAGLINE || 'Kajian & Pemikiran Keislaman';
  res.locals.siteDescription = process.env.SITE_DESCRIPTION || 'Ruang publikasi artikel ilmiah, studi keislaman, opini, dan catatan pemikiran oleh Akbar Saleh, B.A., Pengasuh Pondok Pesantren Khatamun Nabiyyin Jakarta.';
  res.locals.authorName = process.env.AUTHOR_NAME || 'Akbar Saleh, B.A.';
  res.locals.authorRole = process.env.AUTHOR_ROLE || 'Kyai & Pengasuh Pondok Pesantren Khatamun Nabiyyin Jakarta';
  res.locals.authorBio = process.env.AUTHOR_BIO || 'Kyai dan Pengasuh Pondok Pesantren Khatamun Nabiyyin Jakarta. Menulis seputar studi keislaman, riset keilmuan, dan analisis sosial keagamaan.';
  res.locals.authorEmail = process.env.AUTHOR_EMAIL || 'akbarsaleh@khatamunnabiyyin.com';
  res.locals.authorLocation = process.env.AUTHOR_LOCATION || 'Jakarta, Indonesia';
  res.locals.appUrl = process.env.APP_URL || `http://localhost:${PORT}`;
  res.locals.currentPath = req.path;
  res.locals.isLoggedIn = !!req.session.userId;
  res.locals.readerUser = req.session.readerUser || null;
  res.locals.isGoogleAuthEnabled = isGoogleAuthEnabled;
  next();
});

// Auth Guard
const requireAuth = (req, res, next) => {
  if (req.session.userId) {
    next();
  } else {
    res.redirect('/admin/login');
  }
};

// --- SEO & DISCOVERY ROUTES ---

// Dynamic XML Sitemap for Googlebot
app.get('/sitemap.xml', (req, res) => {
  const baseUrl = process.env.APP_URL || `http://localhost:${PORT}`;
  const posts = getAll('SELECT slug, updated_at, created_at FROM posts WHERE is_published = 1 AND is_hidden = 0 ORDER BY created_at DESC');
  const categories = getAll('SELECT DISTINCT category FROM posts WHERE is_published = 1 AND is_hidden = 0');

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n`;

  // 1. Homepage
  xml += `  <url>\n`;
  xml += `    <loc>${baseUrl}/</loc>\n`;
  xml += `    <changefreq>daily</changefreq>\n`;
  xml += `    <priority>1.0</priority>\n`;
  xml += `  </url>\n`;

  // 2. About Page
  xml += `  <url>\n`;
  xml += `    <loc>${baseUrl}/about</loc>\n`;
  xml += `    <changefreq>monthly</changefreq>\n`;
  xml += `    <priority>0.9</priority>\n`;
  xml += `  </url>\n`;

  // 3. Blog Archive Page
  xml += `  <url>\n`;
  xml += `    <loc>${baseUrl}/blog</loc>\n`;
  xml += `    <changefreq>daily</changefreq>\n`;
  xml += `    <priority>0.8</priority>\n`;
  xml += `  </url>\n`;

  // 4. Category Pages
  categories.forEach(cat => {
    if (cat.category) {
      xml += `  <url>\n`;
      xml += `    <loc>${baseUrl}/blog?category=${encodeURIComponent(cat.category)}</loc>\n`;
      xml += `    <changefreq>weekly</changefreq>\n`;
      xml += `    <priority>0.7</priority>\n`;
      xml += `  </url>\n`;
    }
  });

  // 5. Individual Posts
  posts.forEach(post => {
    const lastmodDate = new Date(post.updated_at || post.created_at).toISOString().split('T')[0];
    xml += `  <url>\n`;
    xml += `    <loc>${baseUrl}/blog/${post.slug}</loc>\n`;
    xml += `    <lastmod>${lastmodDate}</lastmod>\n`;
    xml += `    <changefreq>weekly</changefreq>\n`;
    xml += `    <priority>0.8</priority>\n`;
    xml += `  </url>\n`;
  });

  xml += `</urlset>`;

  res.header('Content-Type', 'application/xml');
  res.send(xml);
});

// Robots.txt for Search Engines
app.get('/robots.txt', (req, res) => {
  const baseUrl = process.env.APP_URL || `http://localhost:${PORT}`;
  const robotsTxt = `User-agent: *
Allow: /
Allow: /blog
Allow: /blog/*
Allow: /about
Allow: /css/
Allow: /favicon/
Allow: /uploads/
Disallow: /admin
Disallow: /admin/*
Disallow: /auth/
Disallow: /auth/*

Sitemap: ${baseUrl}/sitemap.xml
`;
  res.header('Content-Type', 'text/plain');
  res.send(robotsTxt);
});

// RSS 2.0 Feed for Google News & Feed Aggregators
const sendRssFeed = (req, res) => {
  const baseUrl = process.env.APP_URL || `http://localhost:${PORT}`;
  const siteName = process.env.SITE_NAME || 'Akbar Saleh';
  const siteTagline = process.env.SITE_TAGLINE || 'Kajian & Pemikiran Keislaman';
  const siteDesc = process.env.SITE_DESCRIPTION || 'Ruang publikasi artikel ilmiah dan kajian keislaman oleh Akbar Saleh, B.A.';
  const authorName = process.env.AUTHOR_NAME || 'Akbar Saleh, B.A.';
  
  const posts = getAll('SELECT * FROM posts WHERE is_published = 1 AND is_hidden = 0 ORDER BY created_at DESC LIMIT 20');

  let rss = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  rss += `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">\n`;
  rss += `  <channel>\n`;
  rss += `    <title>${siteName} — ${siteTagline}</title>\n`;
  rss += `    <link>${baseUrl}</link>\n`;
  rss += `    <description>${siteDesc}</description>\n`;
  rss += `    <language>id-ID</language>\n`;
  rss += `    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>\n`;
  rss += `    <atom:link href="${baseUrl}/rss.xml" rel="self" type="application/rss+xml" />\n`;

  posts.forEach(post => {
    const postUrl = `${baseUrl}/blog/${post.slug}`;
    const pubDate = new Date(post.created_at).toUTCString();
    const cleanDesc = (post.meta_description || post.content.replace(/<[^>]+>/g, '').slice(0, 250)) + '...';

    rss += `    <item>\n`;
    rss += `      <title><![CDATA[${post.title}]]></title>\n`;
    rss += `      <link>${postUrl}</link>\n`;
    rss += `      <guid isPermaLink="true">${postUrl}</guid>\n`;
    rss += `      <dc:creator><![CDATA[${authorName}]]></dc:creator>\n`;
    rss += `      <category><![CDATA[${post.category || 'Kajian'}]]></category>\n`;
    rss += `      <pubDate>${pubDate}</pubDate>\n`;
    rss += `      <description><![CDATA[${cleanDesc}]]></description>\n`;
    if (post.cover_image) {
      const coverUrl = post.cover_image.startsWith('http') ? post.cover_image : `${baseUrl}${post.cover_image}`;
      rss += `      <enclosure url="${coverUrl}" type="image/jpeg" />\n`;
    }
    rss += `    </item>\n`;
  });

  rss += `  </channel>\n`;
  rss += `</rss>`;

  res.header('Content-Type', 'application/rss+xml');
  res.send(rss);
};

app.get('/rss.xml', sendRssFeed);
app.get('/feed.xml', sendRssFeed);

// --- PUBLIC ROUTES ---

// Homepage
app.get('/', (req, res) => {
  const baseUrl = process.env.APP_URL || `http://localhost:${PORT}`;
  const siteName = process.env.SITE_NAME || 'Akbar Saleh';
  const siteTagline = process.env.SITE_TAGLINE || 'Kajian & Pemikiran Keislaman';
  const authorName = process.env.AUTHOR_NAME || 'Akbar Saleh, B.A.';
  const authorRole = process.env.AUTHOR_ROLE || 'Pengasuh Pondok Pesantren Khatamun Nabiyyin Jakarta';

  const featuredPosts = getAll('SELECT * FROM posts WHERE is_published = 1 AND is_hidden = 0 AND is_featured = 1 ORDER BY created_at DESC LIMIT 2');
  const recentPosts = getAll('SELECT * FROM posts WHERE is_published = 1 AND is_hidden = 0 ORDER BY created_at DESC LIMIT 6');
  const categories = getAll('SELECT category, COUNT(*) as count FROM posts WHERE is_published = 1 AND is_hidden = 0 GROUP BY category ORDER BY count DESC');
  const totalPosts = getOne('SELECT COUNT(*) as total FROM posts WHERE is_published = 1 AND is_hidden = 0')?.total || 0;

  const homeHero = getOne('SELECT * FROM pages WHERE slug = ?', ['home']);
  const heroBadge = homeHero ? homeHero.subtitle : 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ';
  const heroTitle = homeHero ? homeHero.title : 'Catatan, Kajian Ilmiah & <span class="text-emerald-800">Pemikiran Keislaman</span>';
  const heroContent = homeHero ? homeHero.content : 'Selamat datang di ruang tulisan pribadi saya. Halaman ini memuat riset ilmiah, telaah studi keislaman, opini sosial-keagamaan, serta catatan refleksi dari <strong>Pondok Pesantren Khatamun Nabiyyin Jakarta</strong>.';

  const schemaJsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${baseUrl}/#website`,
        "url": baseUrl,
        "name": siteName,
        "description": siteTagline,
        "inLanguage": "id-ID",
        "potentialAction": {
          "@type": "SearchAction",
          "target": `${baseUrl}/blog?q={search_term_string}`,
          "query-input": "required name=search_term_string"
        }
      },
      {
        "@type": "Person",
        "@id": `${baseUrl}/#author`,
        "name": authorName,
        "jobTitle": authorRole,
        "worksFor": {
          "@type": "Organization",
          "name": "Pondok Pesantren Khatamun Nabiyyin Jakarta"
        },
        "url": `${baseUrl}/about`
      }
    ]
  };

  res.render('index', {
    featuredPosts,
    recentPosts,
    categories,
    totalPosts,
    heroBadge,
    heroTitle,
    heroContent,
    canonicalUrl: `${baseUrl}/`,
    schemaJsonLd
  });
});

// Blog List (with search & category filter)
app.get('/blog', (req, res) => {
  const baseUrl = process.env.APP_URL || `http://localhost:${PORT}`;
  const authorName = process.env.AUTHOR_NAME || 'Akbar Saleh, B.A.';
  const { q, category } = req.query;
  let sql = 'SELECT * FROM posts WHERE is_published = 1 AND is_hidden = 0';
  const params = [];

  if (category) {
    sql += ' AND category = ?';
    params.push(category);
  }

  if (q) {
    sql += ' AND (title LIKE ? OR content LIKE ? OR meta_description LIKE ?)';
    const searchPattern = `%${q}%`;
    params.push(searchPattern, searchPattern, searchPattern);
  }

  sql += ' ORDER BY created_at DESC';

  const posts = getAll(sql, params);
  const categories = getAll('SELECT category, COUNT(*) as count FROM posts WHERE is_published = 1 AND is_hidden = 0 GROUP BY category ORDER BY count DESC');

  const pageTitle = category ? `Kajian ${category}` : (q ? `Hasil Pencarian: "${q}"` : 'Arsip Kajian & Tulisan Ilmiah');
  const canonicalUrl = category ? `${baseUrl}/blog?category=${encodeURIComponent(category)}` : `${baseUrl}/blog`;

  const schemaJsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "name": pageTitle,
    "url": canonicalUrl,
    "description": `Kumpulan risalah, kajian keislaman, dan artikel ilmiah oleh ${authorName}`,
    "breadcrumb": {
      "@type": "BreadcrumbList",
      "itemListElement": [
        {
          "@type": "ListItem",
          "position": 1,
          "name": "Beranda",
          "item": baseUrl
        },
        {
          "@type": "ListItem",
          "position": 2,
          "name": "Arsip Tulisan",
          "item": `${baseUrl}/blog`
        }
      ]
    }
  };

  res.render('blog', {
    title: pageTitle,
    posts,
    categories,
    selectedCategory: category || '',
    searchQuery: q || '',
    canonicalUrl,
    schemaJsonLd
  });
});

// About Page (Dynamic from DB)
app.get('/about', (req, res) => {
  const baseUrl = process.env.APP_URL || `http://localhost:${PORT}`;
  const authorName = process.env.AUTHOR_NAME || 'Akbar Saleh, B.A.';
  const authorRole = process.env.AUTHOR_ROLE || 'Pengasuh Pondok Pesantren Khatamun Nabiyyin Jakarta';

  const page = getOne('SELECT * FROM pages WHERE slug = ?', ['about']);

  const schemaJsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "ProfilePage",
        "@id": `${baseUrl}/about#webpage`,
        "url": `${baseUrl}/about`,
        "name": page?.title || `Tentang ${authorName}`,
        "isPartOf": {
          "@id": `${baseUrl}/#website`
        },
        "mainEntity": {
          "@id": `${baseUrl}/about#person`
        }
      },
      {
        "@type": "Person",
        "@id": `${baseUrl}/about#person`,
        "name": authorName,
        "jobTitle": page?.subtitle || authorRole,
        "affiliation": {
          "@type": "Organization",
          "name": "Pondok Pesantren Khatamun Nabiyyin Jakarta"
        },
        "knowsAbout": [
          "Studi Keislaman",
          "Fiqih & Fatwa",
          "Filsafat Islam",
          "Pendidikan Pesantren",
          "Kajian Hadits & Tafsir",
          "Pemikiran Islam Kontemporer"
        ],
        "url": `${baseUrl}/about`
      }
    ]
  };

  res.render('about', {
    page: page || {
      title: `Tentang ${authorName}`,
      subtitle: authorRole,
      content: '<p>Halaman tentang penulis.</p>'
    },
    canonicalUrl: `${baseUrl}/about`,
    schemaJsonLd
  });
});

// Helper: Verify if an email/googleId belongs to an authorized Admin/Author
function getVerifiedAdminUser(email, googleId) {
  if (!email && !googleId) return null;
  const cleanEmail = (email || '').trim().toLowerCase();

  // 1. Check database users table with explicit non-empty email or google_id
  if (cleanEmail) {
    const dbUserByEmail = getOne(
      'SELECT * FROM users WHERE email IS NOT NULL AND LENGTH(TRIM(email)) > 0 AND TRIM(LOWER(email)) = ?',
      [cleanEmail]
    );
    if (dbUserByEmail) return dbUserByEmail;
  }

  if (googleId) {
    const dbUserByGoogleId = getOne(
      'SELECT * FROM users WHERE google_id IS NOT NULL AND LENGTH(TRIM(google_id)) > 0 AND google_id = ?',
      [googleId]
    );
    if (dbUserByGoogleId) return dbUserByGoogleId;
  }

  // 2. Check explicitly configured ADMIN_GOOGLE_EMAIL or AUTHOR_EMAIL in .env
  const envAdminEmail = (process.env.ADMIN_GOOGLE_EMAIL || '').trim().toLowerCase();
  const envAuthorEmail = (process.env.AUTHOR_EMAIL || '').trim().toLowerCase();

  if (cleanEmail && ((envAdminEmail && cleanEmail === envAdminEmail) || (envAuthorEmail && cleanEmail === envAuthorEmail))) {
    return getOne('SELECT * FROM users ORDER BY id ASC LIMIT 1');
  }

  return null;
}

// Google OAuth Routes
app.get('/auth/google', (req, res, next) => {
  if (!isGoogleAuthEnabled) {
    return res.status(503).send(`
      <div style="font-family: sans-serif; max-width: 500px; margin: 50px auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px; text-align: center;">
        <h2 style="color: #14532d; margin-top: 0;">Google OAuth Belum Dikonfigurasi</h2>
        <p style="color: #4b5563; font-size: 14px; line-height: 1.5;">Kredensial GOOGLE_CLIENT_ID dan GOOGLE_CLIENT_SECRET belum diisi pada file .env.</p>
        <a href="${req.query.returnTo || (req.query.role === 'admin' ? '/admin/login' : '/')}" style="display: inline-block; margin-top: 16px; padding: 8px 16px; background: #15803d; color: white; border-radius: 8px; text-decoration: none; font-size: 13px; font-weight: bold;">Kembali</a>
      </div>
    `);
  }
  if (req.query.role === 'admin') {
    const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';
    const lock = getLockoutStatus(clientIp);
    if (lock.isLocked) {
      return res.status(429).render('admin/login', {
        error: `Akses login admin dari perangkat ini sedang dikunci sementara karena 5x kesalahan sandi. Silakan tunggu ${lock.remainingText} sebelum mencoba lagi.`,
        isLocked: true,
        remainingText: lock.remainingText
      });
    }
    req.session.authRole = 'admin';
  } else {
    delete req.session.authRole;
  }
  if (req.query.returnTo) {
    req.session.returnTo = req.query.returnTo;
  }
  passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

app.get('/auth/google/callback', (req, res, next) => {
  if (!isGoogleAuthEnabled) return res.redirect('/');
  passport.authenticate('google', (err, user, info) => {
    if (err || !user) {
      console.error('[Google OAuth Error]', err || info);
      const redirectUrl = req.session.authRole === 'admin' ? '/admin/login' : (req.session.returnTo || '/');
      delete req.session.returnTo;
      delete req.session.authRole;
      return res.redirect(redirectUrl);
    }

    const isLoggingInAsAdmin = req.session.authRole === 'admin';
    delete req.session.authRole;

    // Strictly verify if this email is an authorized administrator
    const verifiedAdmin = getVerifiedAdminUser(user.email, user.googleId);

    if (isLoggingInAsAdmin) {
      if (verifiedAdmin) {
        // Link Google ID, email, and avatar to user record
        run('UPDATE users SET google_id = ?, email = COALESCE(email, ?), avatar = ? WHERE id = ?', [
          user.googleId,
          user.email,
          user.avatar || '',
          verifiedAdmin.id
        ]);

        req.session.userId = verifiedAdmin.id;
        req.session.userName = verifiedAdmin.name || process.env.AUTHOR_NAME || 'Akbar Saleh, B.A.';
        req.session.userEmail = user.email;
        req.session.userAvatar = user.avatar;
        req.session.isAdmin = true;

        // Also set reader session as verified author
        req.session.readerUser = {
          id: user.googleId,
          name: verifiedAdmin.name || process.env.AUTHOR_NAME || 'Akbar Saleh, B.A.',
          email: user.email,
          avatar: user.avatar,
          isAuthor: true
        };

        const returnTo = req.session.returnTo || '/admin';
        delete req.session.returnTo;
        return res.redirect(returnTo);
      } else {
        delete req.session.returnTo;
        return res.status(403).render('admin/login', {
          error: `Akses Ditolak: Email Google (${user.email}) tidak terdaftar sebagai admin/penulis. Silakan masuk dengan kata sandi terlebih dahulu lalu daftarkan email resmi Anda di menu Pengaturan.`
        });
      }
    }

    // Reader Login: strictly only flagged as isAuthor if email is verified
    if (verifiedAdmin) {
      user.isAuthor = true;
      user.name = verifiedAdmin.name || process.env.AUTHOR_NAME || 'Akbar Saleh, B.A.';
    } else {
      user.isAuthor = false;
    }

    req.session.readerUser = user;
    const returnTo = req.session.returnTo || '/';
    delete req.session.returnTo;
    res.redirect(returnTo + '#comments');
  })(req, res, next);
});

app.get('/auth/logout', (req, res) => {
  delete req.session.readerUser;
  const returnTo = req.query.returnTo || '/';
  res.redirect(returnTo);
});

// Single Post Page
app.get('/blog/:slug', (req, res) => {
  const post = getOne('SELECT * FROM posts WHERE slug = ?', [req.params.slug]);
  if (!post) {
    return res.status(404).render('404');
  }

  const isUnpublishedOrHidden = post.is_published === 0 || post.is_hidden === 1;
  const isAdmin = Boolean(req.session.userId);

  if (isUnpublishedOrHidden && !isAdmin) {
    return res.status(404).render('404');
  }

  const previewReason = post.is_published === 0 
    ? 'DRAF (Belum Diterbitkan)' 
    : (post.is_hidden === 1 ? 'DISEMBUNYIKAN DARI PUBLIK' : null);

  // Get related posts from same category
  const relatedPosts = getAll(
    'SELECT * FROM posts WHERE is_published = 1 AND is_hidden = 0 AND id != ? AND category = ? ORDER BY created_at DESC LIMIT 3',
    [post.id, post.category]
  );

  // Get all approved comments for this post
  const allComments = getAll(
    "SELECT * FROM comments WHERE post_id = ? AND status = 'approved' ORDER BY created_at ASC",
    [post.id]
  );

  // Build hierarchical comments tree (Root Comments + Nested Replies)
  const rootComments = [];
  const replyMap = {};

  allComments.forEach(c => {
    if (c.parent_id) {
      if (!replyMap[c.parent_id]) replyMap[c.parent_id] = [];
      replyMap[c.parent_id].push(c);
    } else {
      c.replies = [];
      rootComments.push(c);
    }
  });

  rootComments.forEach(c => {
    c.replies = replyMap[c.id] || [];
  });

  // Sort root comments based on requested sort option
  const sortMode = req.query.sort || 'relevant';
  if (sortMode === 'newest') {
    rootComments.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  } else if (sortMode === 'oldest') {
    rootComments.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  } else {
    // 'relevant': prioritize discussions with most replies first, then recent
    rootComments.sort((a, b) => {
      if (b.replies.length !== a.replies.length) {
        return b.replies.length - a.replies.length;
      }
      return new Date(b.created_at) - new Date(a.created_at);
    });
  }

  const baseUrl = process.env.APP_URL || `http://localhost:${PORT}`;
  const siteName = process.env.SITE_NAME || 'Akbar Saleh';
  const authorName = process.env.AUTHOR_NAME || 'Akbar Saleh, B.A.';
  const authorRole = process.env.AUTHOR_ROLE || 'Pengasuh Pondok Pesantren Khatamun Nabiyyin Jakarta';
  const postUrl = `${baseUrl}/blog/${post.slug}`;
  const wordCount = (post.content || '').replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
  const coverUrl = post.cover_image ? (post.cover_image.startsWith('http') ? post.cover_image : `${baseUrl}${post.cover_image}`) : `${baseUrl}/favicon/android-chrome-512x512.png`;

  const schemaJsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BlogPosting",
        "@id": `${postUrl}#article`,
        "isPartOf": {
          "@type": "WebSite",
          "@id": `${baseUrl}/#website`,
          "name": siteName,
          "url": baseUrl
        },
        "headline": post.title,
        "description": post.meta_description || post.title,
        "mainEntityOfPage": postUrl,
        "url": postUrl,
        "datePublished": new Date(post.created_at).toISOString(),
        "dateModified": new Date(post.updated_at || post.created_at).toISOString(),
        "articleSection": post.category || 'Kajian Keislaman',
        "wordCount": wordCount,
        "inLanguage": "id-ID",
        "image": {
          "@type": "ImageObject",
          "url": coverUrl
        },
        "author": {
          "@type": "Person",
          "name": authorName,
          "jobTitle": authorRole,
          "url": `${baseUrl}/about`
        },
        "publisher": {
          "@type": "Person",
          "name": authorName,
          "url": baseUrl
        }
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${postUrl}#breadcrumb`,
        "itemListElement": [
          {
            "@type": "ListItem",
            "position": 1,
            "name": "Beranda",
            "item": baseUrl
          },
          {
            "@type": "ListItem",
            "position": 2,
            "name": "Arsip Tulisan",
            "item": `${baseUrl}/blog`
          },
          {
            "@type": "ListItem",
            "position": 3,
            "name": post.category || "Kajian",
            "item": `${baseUrl}/blog?category=${encodeURIComponent(post.category || 'Kajian')}`
          },
          {
            "@type": "ListItem",
            "position": 4,
            "name": post.title,
            "item": postUrl
          }
        ]
      }
    ]
  };

  res.render('post', {
    post,
    comments: rootComments,
    totalCommentCount: allComments.length,
    currentSort: sortMode,
    canonicalUrl: postUrl,
    schemaJsonLd,
    isAdminPreview: isUnpublishedOrHidden && isAdmin,
    previewReason,
    relatedPosts: relatedPosts.length > 0 ? relatedPosts : getAll('SELECT * FROM posts WHERE is_published = 1 AND is_hidden = 0 AND id != ? ORDER BY created_at DESC LIMIT 3', [post.id])
  });
});

// Download Article as Protected Read-Only PDF
app.get('/blog/:slug/pdf', (req, res) => {
  const post = getOne('SELECT * FROM posts WHERE slug = ?', [req.params.slug]);
  if (!post) {
    return res.status(404).render('404');
  }

  if ((post.is_published === 0 || post.is_hidden === 1) && !req.session.userId) {
    return res.status(404).render('404');
  }

  const baseUrl = process.env.APP_URL || `http://localhost:${PORT}`;
  const doc = generateArticlePdf(post, {
    siteName: process.env.SITE_NAME || 'Akbar Saleh',
    siteUrl: baseUrl,
    authorName: process.env.AUTHOR_NAME || 'Akbar Saleh, B.A.',
    authorRole: process.env.AUTHOR_ROLE || 'Pengasuh Pondok Pesantren Khatamun Nabiyyin Jakarta'
  });

  const filename = `${post.slug}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);

  doc.pipe(res);
  doc.end();
});

// Submit Comment / Reply (Must be logged in with Google)
const commentLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: 'Terlalu sering mengirim tanggapan. Silakan tunggu 1 menit.'
});

app.post('/blog/:slug/comments', commentLimiter, (req, res) => {
  const post = getOne('SELECT id, slug FROM posts WHERE slug = ?', [req.params.slug]);
  if (!post) {
    return res.status(404).send('Artikel tidak ditemukan.');
  }

  if (!req.session.readerUser) {
    return res.status(401).redirect(`/blog/${post.slug}#comments`);
  }

  const { content, parent_id } = req.body;
  if (!content || !content.trim()) {
    return res.redirect(`/blog/${post.slug}#comments`);
  }

  // Check parent_id if provided
  let validParentId = null;
  if (parent_id) {
    const parentComment = getOne('SELECT id FROM comments WHERE id = ? AND post_id = ?', [parent_id, post.id]);
    if (parentComment) {
      validParentId = parentComment.id;
    }
  }

  // Sanitize comment HTML / Text to prevent any XSS
  const cleanContent = sanitizeHtml(content.trim(), {
    allowedTags: ['b', 'i', 'em', 'strong', 'a', 'p', 'br'],
    allowedAttributes: {
      'a': ['href', 'target', 'rel']
    },
    allowedSchemes: ['http', 'https'],
    transformTags: {
      'a': sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'nofollow noopener noreferrer' })
    }
  });

  if (!cleanContent) {
    return res.redirect(`/blog/${post.slug}#comments`);
  }

  const reader = req.session.readerUser;

  // Determine strictly if comment author is the verified Author/Admin
  const verifiedAdmin = getVerifiedAdminUser(reader.email, reader.id);
  const isAuthor = (verifiedAdmin || req.session.userId) ? 1 : 0;
  const commenterName = isAuthor ? ((verifiedAdmin && verifiedAdmin.name) || process.env.AUTHOR_NAME || 'Akbar Saleh, B.A.') : reader.name;

  run(
    `INSERT INTO comments (post_id, parent_id, user_name, user_email, user_avatar, content, is_author, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'approved')`,
    [post.id, validParentId, commenterName, reader.email, reader.avatar, cleanContent, isAuthor]
  );

  const anchor = validParentId ? `comment-${validParentId}` : 'comments';
  res.redirect(`/blog/${post.slug}#${anchor}`);
});

// --- ADMIN ROUTES ---

// Admin Login
app.get('/admin/login', (req, res) => {
  if (req.session.userId) return res.redirect('/admin');
  const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';
  const lock = getLockoutStatus(clientIp);

  if (lock.isLocked) {
    return res.render('admin/login', {
      error: `Akses login dari perangkat ini dikunci sementara karena 5 kali percobaan sandi salah. Silakan tunggu ${lock.remainingText} sebelum mencoba lagi.`,
      isLocked: true,
      remainingText: lock.remainingText
    });
  }

  res.render('admin/login', { error: null, isLocked: false });
});

app.post('/admin/login', (req, res) => {
  const { username, password } = req.body;
  const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';

  const ipLock = getLockoutStatus(clientIp);
  const userLock = username ? getLockoutStatus(username) : { isLocked: false };

  if (ipLock.isLocked || userLock.isLocked) {
    const activeLock = ipLock.isLocked ? ipLock : userLock;
    return res.status(429).render('admin/login', {
      error: `Akses login dikunci sementara. Silakan tunggu ${activeLock.remainingText} sebelum mencoba lagi.`,
      isLocked: true,
      remainingText: activeLock.remainingText
    });
  }

  const user = getOne('SELECT * FROM users WHERE username = ?', [username]);

  if (user && bcrypt.compareSync(password, user.password)) {
    // Clear failed attempts on successful login
    clearFailedLoginAttempts(clientIp);
    if (username) clearFailedLoginAttempts(username);

    req.session.userId = user.id;
    req.session.userName = user.name || user.username;
    res.redirect('/admin');
  } else {
    const failIp = recordFailedLoginAttempt(clientIp);
    const failUser = username ? recordFailedLoginAttempt(username) : null;
    const activeFail = (failIp.isLocked || (failUser && failUser.isLocked)) ? (failIp.isLocked ? failIp : failUser) : failIp;

    if (activeFail.isLocked) {
      return res.status(429).render('admin/login', {
        error: `Percobaan sandi salah mencapai 5 kali! Akses login dikunci selama ${activeFail.remainingText}.`,
        isLocked: true,
        remainingText: activeFail.remainingText
      });
    } else {
      res.render('admin/login', {
        error: `Nama pengguna atau kata sandi tidak sesuai. Sisa kesempatan: ${activeFail.remainingAttempts} kali lagi sebelum akun dikunci.`,
        isLocked: false
      });
    }
  }
});

// Admin Logout
app.get('/admin/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/admin/login');
});

// Admin Dashboard
app.get('/admin', requireAuth, (req, res) => {
  const { q } = req.query;
  let sql = 'SELECT * FROM posts';
  const params = [];

  if (q) {
    sql += ' WHERE title LIKE ? OR category LIKE ?';
    params.push(`%${q}%`, `%${q}%`);
  }

  sql += ' ORDER BY created_at DESC';

  const posts = getAll(sql, params);
  const totalPosts = posts.length;
  const categoriesCount = getAll('SELECT DISTINCT category FROM posts').length;

  res.render('admin/dashboard', {
    posts,
    totalPosts,
    categoriesCount,
    searchQuery: q || ''
  });
});

// New Post
app.get('/admin/posts/new', requireAuth, (req, res) => {
  const categories = getAll('SELECT * FROM categories ORDER BY name ASC');
  res.render('admin/edit', { post: null, categories, error: null });
});

app.post('/admin/posts', requireAuth, postUploadMiddleware, (req, res) => {
  const { title, content, meta_description, category, is_featured, is_published, is_hidden, cover_url } = req.body;
  
  let baseSlug = slugify(title, { lower: true, strict: true }) || 'post-' + Date.now();
  let slug = baseSlug;
  let counter = 1;
  while (getOne('SELECT id FROM posts WHERE slug = ?', [slug])) {
    slug = `${baseSlug}-${counter++}`;
  }

  const coverFile = req.files && req.files['cover_file'] ? req.files['cover_file'][0] : null;
  const attachmentFile = req.files && req.files['attachment_file'] ? req.files['attachment_file'][0] : null;

  const cover_image = coverFile ? `/uploads/${coverFile.filename}` : (cover_url || '');
  const attachment_url = attachmentFile ? `/uploads/${attachmentFile.filename}` : null;
  const attachment_name = attachmentFile ? attachmentFile.originalname : null;
  const attachment_size = attachmentFile ? attachmentFile.size : 0;

  const reading_time = calculateReadingTime(content);
  const featured = is_featured === '1' || is_featured === 'on' ? 1 : 0;
  const published = is_published === '1' || is_published === 'on' ? 1 : 0;
  const hidden = is_hidden === '1' || is_hidden === 'on' ? 1 : 0;
  const postCategory = category?.trim() || 'Kajian Keislaman';

  try {
    run(
      `INSERT INTO posts (title, slug, content, meta_description, category, cover_image, is_featured, is_published, is_hidden, reading_time, attachment_url, attachment_name, attachment_size)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [title, slug, content, meta_description, postCategory, cover_image, featured, published, hidden, reading_time, attachment_url, attachment_name, attachment_size]
    );
    res.redirect('/admin');
  } catch (error) {
    const categories = getAll('SELECT * FROM categories ORDER BY name ASC');
    res.status(400).render('admin/edit', {
      post: { ...req.body, slug },
      categories,
      error: 'Gagal membuat artikel: ' + error.message
    });
  }
});

// Edit Post
app.get('/admin/posts/:id/edit', requireAuth, (req, res) => {
  const post = getOne('SELECT * FROM posts WHERE id = ?', [req.params.id]);
  if (!post) return res.status(404).send('Artikel tidak ditemukan.');
  const categories = getAll('SELECT * FROM categories ORDER BY name ASC');
  res.render('admin/edit', { post, categories, error: null });
});

// Category Management Routes
app.get('/admin/categories', requireAuth, (req, res) => {
  const categories = getAll(`
    SELECT c.id, c.name, c.slug, COUNT(p.id) as post_count 
    FROM categories c 
    LEFT JOIN posts p ON p.category = c.name 
    GROUP BY c.id 
    ORDER BY c.name ASC
  `);
  res.render('admin/categories', { categories, error: null, success: null });
});

app.post('/admin/categories', requireAuth, (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    const categories = getAll(`
      SELECT c.id, c.name, c.slug, COUNT(p.id) as post_count 
      FROM categories c 
      LEFT JOIN posts p ON p.category = c.name 
      GROUP BY c.id 
      ORDER BY c.name ASC
    `);
    return res.render('admin/categories', { categories, error: 'Nama kategori tidak boleh kosong.', success: null });
  }

  const cleanName = name.trim();
  const slug = slugify(cleanName, { lower: true, strict: true });

  const existing = getOne('SELECT id FROM categories WHERE name = ? OR slug = ?', [cleanName, slug]);
  if (existing) {
    const categories = getAll(`
      SELECT c.id, c.name, c.slug, COUNT(p.id) as post_count 
      FROM categories c 
      LEFT JOIN posts p ON p.category = c.name 
      GROUP BY c.id 
      ORDER BY c.name ASC
    `);
    return res.render('admin/categories', { categories, error: `Kategori "${cleanName}" sudah ada.`, success: null });
  }

  run('INSERT INTO categories (name, slug) VALUES (?, ?)', [cleanName, slug]);
  res.redirect('/admin/categories');
});

app.post('/admin/categories/:id/edit', requireAuth, (req, res) => {
  const { name } = req.body;
  const category = getOne('SELECT * FROM categories WHERE id = ?', [req.params.id]);
  if (!category) return res.status(404).send('Kategori tidak ditemukan.');

  if (!name || !name.trim()) {
    return res.redirect('/admin/categories');
  }

  const newName = name.trim();
  const newSlug = slugify(newName, { lower: true, strict: true });

  // Update category and sync associated posts
  run('UPDATE categories SET name = ?, slug = ? WHERE id = ?', [newName, newSlug, req.params.id]);
  run('UPDATE posts SET category = ? WHERE category = ?', [newName, category.name]);

  res.redirect('/admin/categories');
});

app.post('/admin/categories/:id/delete', requireAuth, (req, res) => {
  const category = getOne('SELECT * FROM categories WHERE id = ?', [req.params.id]);
  if (!category) return res.redirect('/admin/categories');

  // Reassign posts of deleted category to 'Kajian Keislaman' or keep
  run('UPDATE posts SET category = ? WHERE category = ?', ['Kajian Keislaman', category.name]);
  run('DELETE FROM categories WHERE id = ?', [req.params.id]);

  res.redirect('/admin/categories');
});

// Comment Moderation Routes
app.get('/admin/comments', requireAuth, (req, res) => {
  const { status } = req.query;
  let sql = `
    SELECT c.*, p.title as post_title, p.slug as post_slug
    FROM comments c
    JOIN posts p ON p.id = c.post_id
  `;
  const params = [];
  if (status) {
    sql += ' WHERE c.status = ?';
    params.push(status);
  }
  sql += ' ORDER BY c.created_at DESC';

  const comments = getAll(sql, params);
  const totalComments = getAll('SELECT COUNT(*) as count FROM comments')[0]?.count || 0;
  const approvedCount = getAll("SELECT COUNT(*) as count FROM comments WHERE status = 'approved'")[0]?.count || 0;
  const hiddenCount = getAll("SELECT COUNT(*) as count FROM comments WHERE status = 'hidden'")[0]?.count || 0;

  res.render('admin/comments', {
    comments,
    totalComments,
    approvedCount,
    hiddenCount,
    currentFilter: status || 'all'
  });
});

app.post('/admin/comments/:id/status', requireAuth, (req, res) => {
  const { status } = req.body;
  if (['approved', 'hidden'].includes(status)) {
    run('UPDATE comments SET status = ? WHERE id = ?', [status, req.params.id]);
  }
  res.redirect('/admin/comments');
});

app.post('/admin/comments/:id/delete', requireAuth, (req, res) => {
  run('DELETE FROM comments WHERE id = ?', [req.params.id]);
  res.redirect('/admin/comments');
});

app.post('/admin/posts/:id', requireAuth, postUploadMiddleware, (req, res) => {
  const { title, content, meta_description, category, is_featured, is_published, is_hidden, cover_url, existing_cover, existing_attachment_url, existing_attachment_name, existing_attachment_size, delete_attachment } = req.body;
  const post = getOne('SELECT * FROM posts WHERE id = ?', [req.params.id]);
  if (!post) return res.status(404).send('Artikel tidak ditemukan.');

  let slug = post.slug;
  if (req.body.slug && req.body.slug !== post.slug) {
    slug = slugify(req.body.slug, { lower: true, strict: true });
    const existing = getOne('SELECT id FROM posts WHERE slug = ? AND id != ?', [slug, req.params.id]);
    if (existing) {
      slug = `${slug}-${Date.now()}`;
    }
  }

  const coverFile = req.files && req.files['cover_file'] ? req.files['cover_file'][0] : null;
  const attachmentFile = req.files && req.files['attachment_file'] ? req.files['attachment_file'][0] : null;

  const cover_image = coverFile ? `/uploads/${coverFile.filename}` : (cover_url || existing_cover || '');

  let attachment_url = existing_attachment_url || null;
  let attachment_name = existing_attachment_name || null;
  let attachment_size = existing_attachment_size ? parseInt(existing_attachment_size, 10) : 0;

  if (delete_attachment === '1') {
    attachment_url = null;
    attachment_name = null;
    attachment_size = 0;
  } else if (attachmentFile) {
    attachment_url = `/uploads/${attachmentFile.filename}`;
    attachment_name = attachmentFile.originalname;
    attachment_size = attachmentFile.size;
  }

  const reading_time = calculateReadingTime(content);
  const featured = is_featured === '1' || is_featured === 'on' ? 1 : 0;
  const published = is_published === '1' || is_published === 'on' ? 1 : 0;
  const hidden = is_hidden === '1' || is_hidden === 'on' ? 1 : 0;
  const postCategory = category?.trim() || 'Umum';

  try {
    run(
      `UPDATE posts 
       SET title = ?, slug = ?, content = ?, meta_description = ?, category = ?, cover_image = ?, is_featured = ?, is_published = ?, is_hidden = ?, reading_time = ?, attachment_url = ?, attachment_name = ?, attachment_size = ?, updated_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [title, slug, content, meta_description, postCategory, cover_image, featured, published, hidden, reading_time, attachment_url, attachment_name, attachment_size, req.params.id]
    );
    res.redirect('/admin');
  } catch (error) {
    res.status(400).render('admin/edit', {
      post: { ...req.body, id: req.params.id },
      error: 'Gagal memperbarui artikel: ' + error.message
    });
  }
});

// Quick Toggle Published Status (Publish / Draft)
app.post('/admin/posts/:id/toggle-publish', requireAuth, (req, res) => {
  const post = getOne('SELECT id, is_published FROM posts WHERE id = ?', [req.params.id]);
  if (post) {
    const newStatus = post.is_published === 1 ? 0 : 1;
    run('UPDATE posts SET is_published = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [newStatus, post.id]);
  }
  res.redirect('/admin');
});

// Quick Toggle Hidden Status (Visible / Hidden)
app.post('/admin/posts/:id/toggle-visibility', requireAuth, (req, res) => {
  const post = getOne('SELECT id, is_hidden FROM posts WHERE id = ?', [req.params.id]);
  if (post) {
    const newStatus = post.is_hidden === 1 ? 0 : 1;
    run('UPDATE posts SET is_hidden = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [newStatus, post.id]);
  }
  res.redirect('/admin');
});

// Delete Post
app.post('/admin/posts/:id/delete', requireAuth, (req, res) => {
  run('DELETE FROM posts WHERE id = ?', [req.params.id]);
  res.redirect('/admin');
});

// AJAX Image Upload for Quill Editor
app.post('/admin/upload-image', requireAuth, upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'Tidak ada file yang diunggah.' });
  }
  const imageUrl = `/uploads/${req.file.filename}`;
  res.json({
    success: true,
    url: imageUrl
  });
});

// Admin About Page Management
app.get('/admin/about', requireAuth, (req, res) => {
  const page = getOne('SELECT * FROM pages WHERE slug = ?', ['about']) || {
    title: 'Tentang Penulis',
    subtitle: process.env.AUTHOR_ROLE || 'Pengasuh Pondok Pesantren Khatamun Nabiyyin Jakarta',
    content: ''
  };
  res.render('admin/about', { page, error: null, success: null });
});

app.post('/admin/about', requireAuth, (req, res) => {
  const { title, subtitle, content } = req.body;
  
  if (!title || !title.trim()) {
    return res.render('admin/about', {
      page: { title, subtitle, content },
      error: 'Judul halaman tidak boleh kosong.',
      success: null
    });
  }

  const existing = getOne('SELECT id FROM pages WHERE slug = ?', ['about']);
  if (existing) {
    run(
      'UPDATE pages SET title = ?, subtitle = ?, content = ?, updated_at = CURRENT_TIMESTAMP WHERE slug = ?',
      [title.trim(), subtitle?.trim() || '', content || '', 'about']
    );
  } else {
    run(
      'INSERT INTO pages (slug, title, subtitle, content) VALUES (?, ?, ?, ?)',
      ['about', title.trim(), subtitle?.trim() || '', content || '']
    );
  }

  const updatedPage = getOne('SELECT * FROM pages WHERE slug = ?', ['about']);
  res.render('admin/about', {
    page: updatedPage,
    error: null,
    success: 'Halaman Tentang Penulis berhasil diperbarui!'
  });
});

// Admin Settings
app.get('/admin/settings', requireAuth, (req, res) => {
  const user = getOne('SELECT id, username, name, email, google_id, avatar FROM users WHERE id = ?', [req.session.userId]);
  const homeHero = getOne('SELECT * FROM pages WHERE slug = ?', ['home']) || {
    subtitle: 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ',
    title: 'Catatan, Kajian Ilmiah & <span class="text-emerald-800">Pemikiran Keislaman</span>',
    content: 'Selamat datang di ruang tulisan pribadi saya. Halaman ini memuat riset ilmiah, telaah studi keislaman, opini sosial-keagamaan, serta catatan refleksi dari <strong>Pondok Pesantren Khatamun Nabiyyin Jakarta</strong>.'
  };
  res.render('admin/settings', { user, homeHero, error: null, success: null });
});

app.post('/admin/settings/hero', requireAuth, (req, res) => {
  const { hero_badge, hero_title, hero_content } = req.body;
  const user = getOne('SELECT id, username, name, email, google_id, avatar FROM users WHERE id = ?', [req.session.userId]);

  if (!hero_title || !hero_title.trim()) {
    const homeHero = { subtitle: hero_badge, title: hero_title, content: hero_content };
    return res.render('admin/settings', { user, homeHero, error: 'Judul utama beranda tidak boleh kosong.', success: null });
  }

  const existing = getOne('SELECT id FROM pages WHERE slug = ?', ['home']);
  if (existing) {
    run(
      'UPDATE pages SET title = ?, subtitle = ?, content = ?, updated_at = CURRENT_TIMESTAMP WHERE slug = ?',
      [hero_title.trim(), hero_badge?.trim() || '', hero_content?.trim() || '', 'home']
    );
  } else {
    run(
      'INSERT INTO pages (slug, title, subtitle, content) VALUES (?, ?, ?, ?)',
      ['home', hero_title.trim(), hero_badge?.trim() || '', hero_content?.trim() || '']
    );
  }

  const updatedHomeHero = getOne('SELECT * FROM pages WHERE slug = ?', ['home']);
  res.render('admin/settings', {
    user,
    homeHero: updatedHomeHero,
    error: null,
    success: 'Tampilan Header Beranda berhasil diperbarui!'
  });
});

app.post('/admin/settings/profile', requireAuth, (req, res) => {
  const { name, username, email } = req.body;
  const user = getOne('SELECT id, username, name, email, google_id, avatar FROM users WHERE id = ?', [req.session.userId]);
  const homeHero = getOne('SELECT * FROM pages WHERE slug = ?', ['home']);

  if (!username) {
    return res.render('admin/settings', { user, homeHero, error: 'Username tidak boleh kosong.', success: null });
  }

  // Check username collision
  const existing = getOne('SELECT id FROM users WHERE username = ? AND id != ?', [username, req.session.userId]);
  if (existing) {
    return res.render('admin/settings', { user, homeHero, error: 'Username sudah digunakan oleh akun lain.', success: null });
  }

  run('UPDATE users SET name = ?, username = ?, email = ? WHERE id = ?', [name, username, email?.trim() || null, req.session.userId]);
  req.session.userName = name || username;
  if (email) req.session.userEmail = email.trim();

  const updatedUser = getOne('SELECT id, username, name, email, google_id, avatar FROM users WHERE id = ?', [req.session.userId]);
  res.render('admin/settings', { user: updatedUser, homeHero, error: null, success: 'Profil dan email Google resmi berhasil diperbarui!' });
});

app.post('/admin/settings/unbind-google', requireAuth, (req, res) => {
  run('UPDATE users SET google_id = NULL, email = NULL, avatar = NULL WHERE id = ?', [req.session.userId]);
  delete req.session.userEmail;
  delete req.session.userAvatar;
  if (req.session.readerUser && req.session.readerUser.isAuthor) {
    delete req.session.readerUser;
  }
  const user = getOne('SELECT id, username, name, email, google_id, avatar FROM users WHERE id = ?', [req.session.userId]);
  const homeHero = getOne('SELECT * FROM pages WHERE slug = ?', ['home']);
  res.render('admin/settings', {
    user,
    homeHero,
    error: null,
    success: 'Tautan akun Google berhasil dilepas (Unbind sukses)!'
  });
});

app.post('/admin/settings/password', requireAuth, (req, res) => {
  const { current_password, new_password, confirm_password } = req.body;
  const user = getOne('SELECT * FROM users WHERE id = ?', [req.session.userId]);
  const homeHero = getOne('SELECT * FROM pages WHERE slug = ?', ['home']);

  if (new_password !== confirm_password) {
    return res.render('admin/settings', { user, homeHero, error: 'Kata sandi baru dan konfirmasi tidak cocok.', success: null });
  }

  if (user && bcrypt.compareSync(current_password, user.password)) {
    const hash = bcrypt.hashSync(new_password, 10);
    run('UPDATE users SET password = ? WHERE id = ?', [hash, req.session.userId]);
    res.render('admin/settings', { user, homeHero, error: null, success: 'Kata sandi berhasil diubah!' });
  } else {
    res.render('admin/settings', { user, homeHero, error: 'Kata sandi saat ini tidak sesuai.', success: null });
  }
});

// 404 Handler
app.use((req, res) => {
  res.status(404).render('404');
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('[Error Handler]', err);
  res.status(500).send('Terjadi kesalahan pada server: ' + (isProd ? 'Silakan hubungi administrator.' : err.message));
});

// Start Server
app.listen(PORT, () => {
  console.log(`=========================================`);
  console.log(`🚀 Blog Akbar Saleh berjalan di:`);
  console.log(`   Local: http://localhost:${PORT}`);
  console.log(`   Mode : ${process.env.NODE_ENV || 'development'}`);
  console.log(`=========================================`);
});
