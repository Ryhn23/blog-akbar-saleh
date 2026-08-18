const { calculateReadingTime, computeContentHash, savePostTranslation, savePageTranslation } = require('../db');

const OLLAMA_HOST = (process.env.OLLAMA_HOST || 'https://ai.khatamunnabiyyin.net').replace(/\/+$/, '');
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gemma4:31b-cloud';
const OLLAMA_TIMEOUT = parseInt(process.env.OLLAMA_TIMEOUT_MS, 10) || 120000;

const SUPPORTED_LANGUAGES = {
  id: {
    code: 'id',
    name: 'Bahasa Indonesia',
    nativeName: 'Bahasa Indonesia',
    label: 'ID',
    dir: 'ltr'
  },
  en: {
    code: 'en',
    name: 'English',
    nativeName: 'English',
    label: 'EN',
    dir: 'ltr',
    promptTarget: 'academic, elegant English suitable for scholarly publications in Islamic studies'
  },
  ar: {
    code: 'ar',
    name: 'Arabic',
    nativeName: 'العربية',
    label: 'AR',
    dir: 'rtl',
    promptTarget: 'classical, eloquent literary Arabic (فصحى بليغة) adhering to standard Islamic scholastic terminology'
  },
  fa: {
    code: 'fa',
    name: 'Persian',
    nativeName: 'فارسی',
    label: 'FA',
    dir: 'rtl',
    promptTarget: 'formal, articulate Persian/Farsi adhering to standard academic and religious literature terminology'
  }
};

/**
 * Global UI Localized Dictionary for all 4 languages
 */
const UI_DICTIONARY = {
  nav_home: {
    id: 'Beranda',
    en: 'Home',
    ar: 'الرئيسية',
    fa: 'صفحه نخست'
  },
  nav_blog: {
    id: 'Kajian & Tulisan',
    en: 'Studies & Essays',
    ar: 'الدراسات والمقالات',
    fa: 'پژوهش‌ها و یادداشت‌ها'
  },
  nav_about: {
    id: 'Tentang',
    en: 'About',
    ar: 'عن الكاتب',
    fa: 'درباره نویسنده'
  },
  nav_dashboard: {
    id: 'Dasbor',
    en: 'Dashboard',
    ar: 'لوحة التحكم',
    fa: 'داشبورد'
  },
  site_tagline: {
    id: 'Blog dan Kumpulan Tulisan Ilmiah',
    en: 'Scholarly Blog & Islamic Research Essays',
    ar: 'مدونة ومقالات بحثية إسلامية',
    fa: 'وبلاگ و مقالات پژوهشی اسلامی'
  },
  author_role: {
    id: 'Kyai & Pengasuh Pondok Pesantren Khatamun Nabiyyin Jakarta',
    en: 'Kyai & Director of Khatamun Nabiyyin Islamic Seminary, Jakarta',
    ar: 'مدير حوزة خاتم النبيين (ص) بجاكرتا',
    fa: 'مدیر حوزه علمیه خاتم النبیین (ص) جاکارتا'
  },
  hero_default_title: {
    id: 'Catatan, Kajian Ilmiah & <span class="text-emerald-800">Pemikiran Keislaman</span>',
    en: 'Notes, Scholarly Studies & <span class="text-emerald-800">Islamic Philosophy</span>',
    ar: 'ملاحظات، دراسات علمية و<span class="text-emerald-800">فكر إسلامي</span>',
    fa: 'یادداشت‌ها، مطالعات علمی و <span class="text-emerald-800">اندیشه اسلامی</span>'
  },
  hero_default_content: {
    id: 'Selamat datang di ruang tulisan pribadi saya. Halaman ini memuat riset ilmiah, telaah studi keislaman, opini sosial-keagamaan, serta catatan refleksi dari <strong>Pondok Pesantren Khatamun Nabiyyin Jakarta</strong>.',
    en: 'Welcome to my scholarly platform. This page features academic research, Islamic jurisprudence studies, socio-religious commentary, and reflective insights from <strong>Khatamun Nabiyyin Islamic Seminary, Jakarta</strong>.',
    ar: 'مرحبًا بكم في مدونتي العلمية. تنشر هذه الصفحة البحوث الأكاديمية، والدراسات الفقهية، والآراء الفكرية والاجتماعية الصادرة عن <strong>حوزة خاتم النبيين (ص) بجاكرتا</strong>.',
    fa: 'به پایگاه پژوهشی من خوش آمدید. این صفحه شامل پژوهش‌های علمی، مطالعات فقهی، یادداشت‌های اجتماعی-دینی و دیدگاه‌های تحلیلی از <strong>حوزه علمیه خاتم النبیین (ص) جاکارتا</strong> است.'
  },
  featured_section: {
    id: 'Tulisan Utama',
    en: 'Featured Essays',
    ar: 'أبرز المقالات',
    fa: 'نوشته‌های برگزیده'
  },
  recent_section: {
    id: 'Kajian Terbaru',
    en: 'Recent Articles',
    ar: 'أحدث المقالات',
    fa: 'تازه‌ترین پژوهش‌ها'
  },
  all_articles: {
    id: 'Lihat Seluruh Arsip Tulisan',
    en: 'View All Article Archives',
    ar: 'عرض جميع الأرشيفات',
    fa: 'مشاهده تمامی آرشیوها'
  },
  read_more: {
    id: 'Baca Selengkapnya',
    en: 'Read More',
    ar: 'اقرأ المزيد',
    fa: 'ادامه مطلب'
  },
  min_read: {
    id: 'menit baca',
    en: 'min read',
    ar: 'دقائق للقراءة',
    fa: 'دقیقه مطالعه'
  },
  search_placeholder: {
    id: 'Cari judul atau topik kajian...',
    en: 'Search articles, topics or keywords...',
    ar: 'ابحث عن المقالات أو المواضيع...',
    fa: 'جستجوی مقالات، مباحث یا کلیدواژه‌ها...'
  },
  all_categories: {
    id: 'Semua Kategori',
    en: 'All Categories',
    ar: 'جميع الفئات',
    fa: 'تمامی دسته‌بندی‌ها'
  },
  download_pdf: {
    id: 'Unduh PDF',
    en: 'Download PDF',
    ar: 'تحميل PDF',
    fa: 'دانلود PDF'
  },
  share: {
    id: 'Bagikan',
    en: 'Share',
    ar: 'مشاركة',
    fa: 'اشتراک‌گذاری'
  },
  attachment_title: {
    id: 'Lampiran Dokumen Tambahan',
    en: 'Attached Resource Document',
    ar: 'ملف المرفقات الإضافية',
    fa: 'فایل پیوست مقاله'
  },
  comments_heading: {
    id: 'Tanggapan & Diskusi',
    en: 'Responses & Discussion',
    ar: 'التعليقات والمناقشات',
    fa: 'دیدگاه‌ها و گفتگوها'
  },
  archive_breadcrumb: {
    id: 'Arsip Tulisan',
    en: 'Article Archives',
    ar: 'أرشيف المقالات',
    fa: 'آرشیو مقالات'
  },
  share_article: {
    id: 'Bagikan Artikel Ini',
    en: 'Share This Article',
    ar: 'شارك هذه المقالة',
    fa: 'اشتراک‌گذاری این مقاله'
  },
  share_subtitle: {
    id: 'Sebarkan tulisan ini ke WhatsApp, Telegram, atau simpan arsip PDF resminya.',
    en: 'Share this article to WhatsApp, Telegram, or download the official PDF.',
    ar: 'شارك هذا المقال عبر واتساب، تيليجرام، أو احفظ نسخة PDF الرسمية.',
    fa: 'این مقاله را در واتساپ، تلگرام به اشتراک بگذارید یا نسخه رسمی PDF را ذخیره کنید.'
  },
  share_now: {
    id: 'Bagikan Sekarang',
    en: 'Share Now',
    ar: 'مشاركة الآن',
    fa: 'اشتراک‌گذاری'
  },
  copy_link: {
    id: 'Salin Tautan',
    en: 'Copy Link',
    ar: 'نسخ الرابط',
    fa: 'کپی پیوند'
  },
  link_copied: {
    id: 'Tautan artikel berhasil disalin!',
    en: 'Article link copied to clipboard!',
    ar: 'تم نسخ رابط المقال بنجاح!',
    fa: 'پیوند مقاله با موفقیت کپی شد!'
  },
  attachment_label: {
    id: 'Lampiran Dokumen / Makalah',
    en: 'Document Attachment / Paper',
    ar: 'ملف المرفقات / ورقة بحثية',
    fa: 'پیوست سند / مقاله'
  },
  file_size: {
    id: 'Ukuran berkas',
    en: 'File size',
    ar: 'حجم الملف',
    fa: 'حجم فایل'
  },
  download_document: {
    id: 'Unduh Dokumen',
    en: 'Download Document',
    ar: 'تحميل الملف',
    fa: 'دانلود فایل'
  },
  related_posts: {
    id: 'Tulisan Terkait Lainnya',
    en: 'Related Articles',
    ar: 'مقالات ذات صلة',
    fa: 'مطالب مرتبط دیگر'
  },
  sort_label: {
    id: 'Urutan:',
    en: 'Sort:',
    ar: 'الترتيب:',
    fa: 'ترتیب:'
  },
  comment_login_notice: {
    id: 'Untuk menjaga adab diskusi dan mencegah spam, silakan masuk menggunakan akun Google Anda sebelum menulis atau membalas tanggapan.',
    en: 'To maintain discussion ethics and prevent spam, please sign in with your Google account before commenting.',
    ar: 'للحفاظ على آداب الحوار ومنع الرسائل المزعجة، يرجى تسجيل الدخول بحساب Google قبل التعليق.',
    fa: 'برای حفظ ادب گفتگو و جلوگیری از هرزنامه، لطفاً پیش از ارسال نظر با حساب گوگل خود وارد شوید.'
  },
  login_with_google_to_comment: {
    id: 'Masuk dengan Google untuk Berkomentar',
    en: 'Sign in with Google to Comment',
    ar: 'تسجيل الدخول عبر Google للتعليق',
    fa: 'ورود با گوگل برای ثبت نظر'
  },
  reply: {
    id: 'Balas',
    en: 'Reply',
    ar: 'رد',
    fa: 'پاسخ'
  },
  original_author_badge: {
    id: 'Penulis Asli',
    en: 'Original Author',
    ar: 'الكاتب الأصلي',
    fa: 'نویسنده اصلی'
  },
  verified_google: {
    id: 'Terverifikasi Akun Google',
    en: 'Verified Google Account',
    ar: 'تم التحقق عبر Google',
    fa: 'تأیید شده با حساب گوگل'
  },
  replying_to: {
    id: 'Membalas tanggapan dari',
    en: 'Replying to',
    ar: 'الرد على تعليق',
    fa: 'پاسخ به دیدگاه'
  },
  close: {
    id: 'Tutup',
    en: 'Close',
    ar: 'إغلاق',
    fa: 'بستن'
  },
  write_reply_placeholder: {
    id: 'Tulis balasan Anda...',
    en: 'Write your reply...',
    ar: 'اكتب ردك هنا...',
    fa: 'پاسخ خود را بنویسید...'
  },
  send_reply: {
    id: 'Kirim Balasan',
    en: 'Send Reply',
    ar: 'إرسال الرد',
    fa: 'ارسال پاسخ'
  },
  send_comment: {
    id: 'Kirim Tanggapan',
    en: 'Submit Response',
    ar: 'إرسال التعليق',
    fa: 'ارسال دیدگاه'
  },
  write_comment_placeholder: {
    id: 'Tuliskan pandangan atau tanggapan ilmiah Anda...',
    en: 'Write your scholarly perspective or comment...',
    ar: 'اكتب وجهة نظرك أو تعقيبك العلمي...',
    fa: 'دیدگاه یا تحلیل علمی خود را بنویسید...'
  },
  no_comments_yet: {
    id: 'Belum ada tanggapan untuk artikel ini. Jadilah yang pertama memulai diskusi.',
    en: 'No responses yet for this article. Be the first to start the discussion.',
    ar: 'لا توجد تعليقات بعد على هذا المقال. كن أول من يبدأ النقاش.',
    fa: 'هنوز دیدگاهی برای این مقاله ثبت نشده است. اولین نفری باشید که گفتگو را آغاز می‌کند.'
  },
  back_to_archive: {
    id: '← Kembali ke Semua Arsip',
    en: '← Back to All Articles',
    ar: '← العودة إلى جميع الأرشيفات',
    fa: '← بازگشت به تمامی آرشیوها'
  },
  back_to_top: {
    id: 'Kembali ke Atas ↑',
    en: 'Back to Top ↑',
    ar: 'العودة إلى الأعلى ↑',
    fa: 'بازگشت به بالا ↑'
  },
  logout: {
    id: 'Keluar',
    en: 'Sign Out',
    ar: 'تسجيل الخروج',
    fa: 'خروج'
  },
  write_comment: {
    id: 'Tulis Tanggapan Anda',
    en: 'Leave a Comment',
    ar: 'أضف تعليقك',
    fa: 'دیدگاه خود را ارسال کنید'
  },
  sort_relevant: {
    id: 'Paling Relevan',
    en: 'Most Relevant',
    ar: 'الأكثر صلة',
    fa: 'مرتبط‌ترین'
  },
  sort_newest: {
    id: 'Terbaru',
    en: 'Newest',
    ar: 'الأحدث',
    fa: 'جدیدترین'
  },
  sort_oldest: {
    id: 'Terlama',
    en: 'Oldest',
    ar: 'الأقدم',
    fa: 'قدیمی‌ترین'
  },
  ai_translation_badge: {
    id: 'Diterjemahkan secara akademis oleh Ollama AI (Gemma 4:31B)',
    en: 'Scholarly translated by Ollama AI (Gemma 4:31B)',
    ar: 'ترجمة أكاديمية بواسطة Ollama AI (Gemma 4:31B)',
    fa: 'ترجمه آکادمیک توسط Ollama AI (Gemma 4:31B)'
  },
  view_original: {
    id: 'Baca Naskah Asli (Indonesia) ↗',
    en: 'Read Original (Indonesian) ↗',
    ar: 'قراءة النص الأصلي (الإندونيسية) ↗',
    fa: 'مشاهده متن اصلی (اندونزیایی) ↗'
  },
  no_articles_found: {
    id: 'Tidak ditemukan tulisan yang cocok.',
    en: 'No matching articles found.',
    ar: 'لم يتم العثور على مقالات مطابقة.',
    fa: 'هیچ مقاله‌ای یافت نشد.'
  },
  filter_clear: {
    id: 'Hapus Filter',
    en: 'Clear Filter',
    ar: 'إزالة التصفية',
    fa: 'حذف فیلتر'
  },
  ai_translated_notice: {
    id: 'Diterjemahkan secara akademis oleh',
    en: 'Scholarly translated by',
    ar: 'ترجمة أكاديمية بواسطة',
    fa: 'ترجمه تخصصی توسط'
  },
  to_language: {
    id: 'ke bahasa',
    en: 'into',
    ar: 'إلى اللغة',
    fa: 'به زبان'
  },
  read_original_id: {
    id: 'Baca Naskah Asli (Indonesia) ↗',
    en: 'Read Original (Indonesian) ↗',
    ar: 'قراءة النص الأصلي (الإندونيسية) ↗',
    fa: 'خواندن متن اصلی (اندونزیایی) ↗'
  },
  no_articles_yet: {
    id: 'Belum ada tulisan yang dipublikasikan.',
    en: 'No articles published yet.',
    ar: 'لم يتم نشر أي مقالات بعد.',
    fa: 'هنوز مقاله‌ای منتشر نشده است.'
  },
  default_location: {
    id: 'Jakarta, Indonesia',
    en: 'Jakarta, Indonesia',
    ar: 'جاكرتا، إندونيسيا',
    fa: 'جاکارتا، اندونزی'
  },
  author_profile_tag: {
    id: 'Profil Penulis',
    en: 'Author Profile',
    ar: 'الملف التعريفي للكاتب',
    fa: 'شناسنامه نویسنده'
  },
  official_contact: {
    id: 'Kontak Resmi',
    en: 'Official Contact',
    ar: 'الاتصال الرسمي',
    fa: 'ارتباط رسمی'
  },
  copyright_notice: {
    id: 'Seluruh Hak Cipta Dilindungi.',
    en: 'All Rights Reserved.',
    ar: 'جميع الحقوق محفوظة.',
    fa: 'تمامی حقوق محفوظ است.'
  }
};

/**
 * Returns localized string for a key
 */
function t(key, lang = 'id') {
  const currentLang = (lang || 'id').toLowerCase();
  const dict = UI_DICTIONARY[key];
  if (!dict) return key;
  return dict[currentLang] || dict.en || dict.id || key;
}

/**
 * Extracts and cleans JSON string from LLM output (even if wrapped in markdown code blocks)
 */
function extractJsonFromLlmResponse(rawContent) {
  if (!rawContent) return null;
  let text = rawContent.trim();
  
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  }

  try {
    return JSON.parse(text);
  } catch (err) {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (innerErr) {
        console.error('[Ollama Translator] Failed to parse JSON from regex match:', innerErr.message);
      }
    }
    throw new Error('Respons dari Ollama bukan format JSON yang valid: ' + err.message);
  }
}

/**
 * Helper: Splits long HTML content into structured sections (Chunking)
 * Splits intelligently on headings (<h2>, <h3>, <h4>) or paragraph breaks (<p>)
 */
function splitHtmlIntoSections(html, maxChunkSize = 2500) {
  if (!html || html.length <= maxChunkSize) {
    return [html];
  }

  const sections = [];
  // Split on block-level tags like <h2>, <h3>, <h4>, <hr>, or double <p>
  const parts = html.split(/(?=<h[2-4][^>]*>|<hr[^>]*>)/i);

  let currentChunk = '';
  for (const part of parts) {
    if ((currentChunk.length + part.length) > maxChunkSize && currentChunk.length > 0) {
      sections.push(currentChunk);
      currentChunk = part;
    } else {
      currentChunk += part;
    }
  }

  if (currentChunk.trim().length > 0) {
    sections.push(currentChunk);
  }

  return sections.length > 0 ? sections : [html];
}

/**
 * Translates a single section/chunk of HTML content
 */
async function translateSectionChunk(chunkHtml, langConfig, sectionIndex, totalSections) {
  const systemPrompt = `You are a distinguished academic translator specializing in Islamic studies, classical jurisprudence (fiqh), philosophy, and religious literature.
Your task is to translate an Indonesian Islamic scholarly text segment into ${langConfig.promptTarget}.

CRITICAL RULES:
1. Preserve ALL HTML tags, attributes, formatting, headings, lists, blockquotes, and link anchors EXACTLY as structured.
2. Translate ONLY the human-readable text inside the HTML elements.
3. Output MUST BE strictly a valid JSON object with EXACTLY the following key:
   - "translated_html": (string) Translated HTML content for this segment
Do NOT include any commentary, notes, or text outside the JSON object.`;

  const userPrompt = `Translate segment [${sectionIndex + 1}/${totalSections}] from Indonesian to ${langConfig.name}:

${chunkHtml}`;

  const payload = {
    model: OLLAMA_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    stream: false,
    format: 'json',
    options: {
      temperature: 0.2,
      top_p: 0.9
    }
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT);

  try {
    const response = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`Ollama HTTP Error ${response.status}: ${errBody}`);
    }

    const data = await response.json();
    const parsed = extractJsonFromLlmResponse(data.message.content);
    return parsed.translated_html || chunkHtml;
  } catch (err) {
    clearTimeout(timeoutId);
    console.error(`[Ollama Translate] Section ${sectionIndex + 1} translation failed, falling back to original segment:`, err.message);
    return chunkHtml;
  }
}

/**
 * Translates a full post (with section chunking if long)
 */
async function translatePostToLanguage(post, targetLang) {
  if (!post || !post.title || !post.content) {
    throw new Error('Data artikel tidak lengkap untuk diterjemahkan.');
  }

  const langConfig = SUPPORTED_LANGUAGES[targetLang];
  if (!langConfig || targetLang === 'id') {
    throw new Error(`Bahasa target '${targetLang}' tidak didukung atau merupakan bahasa utama.`);
  }

  // 1. Translate Title, Meta Description & Category
  const headerPrompt = `You are an academic translator. Translate the metadata of an Islamic scholarly article from Indonesian to ${langConfig.promptTarget}.
Output strictly a valid JSON object with:
- "title": (string) Translated title
- "meta_description": (string) Translated meta description summary
- "category": (string) Translated category name`;

  const headerUserPrompt = `Title: ${post.title}
Category: ${post.category || 'Kajian Keislaman'}
Meta Description: ${post.meta_description || ''}`;

  const headerPayload = {
    model: OLLAMA_MODEL,
    messages: [
      { role: 'system', content: headerPrompt },
      { role: 'user', content: headerUserPrompt }
    ],
    stream: false,
    format: 'json',
    options: { temperature: 0.2 }
  };

  const headerController = new AbortController();
  const headerTimeout = setTimeout(() => headerController.abort(), OLLAMA_TIMEOUT);

  let translatedMeta = {
    title: post.title,
    meta_description: post.meta_description || '',
    category: post.category || 'Kajian'
  };

  try {
    const metaRes = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(headerPayload),
      signal: headerController.signal
    });
    clearTimeout(headerTimeout);
    if (metaRes.ok) {
      const metaData = await metaRes.json();
      const parsedMeta = extractJsonFromLlmResponse(metaData.message.content);
      if (parsedMeta && parsedMeta.title) {
        translatedMeta = parsedMeta;
      }
    }
  } catch (err) {
    clearTimeout(headerTimeout);
    console.warn('[Ollama Translator] Metadata translation warning:', err.message);
  }

  // 2. Translate Content with Section Sequence Segmentation (Chunking)
  const sections = splitHtmlIntoSections(post.content, 2500);
  console.log(`[Ollama Translator] Translating post '${post.slug}' in ${sections.length} section(s) to ${targetLang}...`);

  const translatedSections = [];
  for (let i = 0; i < sections.length; i++) {
    const translatedChunk = await translateSectionChunk(sections[i], langConfig, i, sections.length);
    translatedSections.push(translatedChunk);
  }

  const fullTranslatedContent = translatedSections.join('');

  const sourceHash = computeContentHash({
    title: post.title,
    meta: post.meta_description || '',
    content: post.content,
    cat: post.category || ''
  });

  const result = {
    title: translatedMeta.title.trim(),
    meta_description: (translatedMeta.meta_description || '').trim(),
    category: (translatedMeta.category || post.category || 'Kajian').trim(),
    content: fullTranslatedContent.trim(),
    reading_time: calculateReadingTime(fullTranslatedContent),
    lang_code: targetLang,
    source_hash: sourceHash
  };

  // Save / Cache in Database with Content Hash
  if (post.id) {
    savePostTranslation(post.id, targetLang, result, sourceHash);
  }

  return result;
}

/**
 * Translates a standalone page (e.g. About page, Hero section)
 */
async function translatePageToLanguage(pageSlug, pageData, targetLang) {
  const langConfig = SUPPORTED_LANGUAGES[targetLang];
  if (!langConfig || targetLang === 'id') {
    throw new Error(`Bahasa target '${targetLang}' tidak didukung.`);
  }

  const systemPrompt = `You are an academic translator. Translate this website page content from Indonesian into ${langConfig.promptTarget}.
Preserve all HTML formatting tags (<p>, <strong>, <em>, <a>, <ul>, <li>).
Output strictly a valid JSON object with:
- "title": (string) Translated page title
- "subtitle": (string) Translated page subtitle
- "content": (string) Translated HTML content`;

  const userPrompt = `Page: ${pageSlug}
Title: ${pageData.title || ''}
Subtitle: ${pageData.subtitle || ''}
HTML Content:
${pageData.content || ''}`;

  const payload = {
    model: OLLAMA_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    stream: false,
    format: 'json',
    options: { temperature: 0.2 }
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT);

  try {
    const response = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Ollama HTTP ${response.status}: ${err}`);
    }

    const data = await response.json();
    const parsed = extractJsonFromLlmResponse(data.message.content);

    const sourceHash = computeContentHash({
      title: pageData.title || '',
      subtitle: pageData.subtitle || '',
      content: pageData.content || ''
    });

    const result = {
      title: parsed.title || pageData.title,
      subtitle: parsed.subtitle || pageData.subtitle,
      content: parsed.content || pageData.content,
      lang_code: targetLang,
      source_hash: sourceHash
    };

    savePageTranslation(pageSlug, targetLang, result, sourceHash);
    return result;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

/**
 * Translates a post to all foreign languages (en, ar, fa)
 */
async function translatePostAllLanguages(post) {
  const results = {};
  const foreignLangs = ['en', 'ar', 'fa'];

  for (const lang of foreignLangs) {
    try {
      console.log(`[Ollama Translator] Batch translating post #${post.id} (${post.slug}) to ${lang}...`);
      const res = await translatePostToLanguage(post, lang);
      results[lang] = { success: true, data: res };
    } catch (err) {
      console.error(`[Ollama Translator] Error translating to ${lang}:`, err.message);
      results[lang] = { success: false, error: err.message };
    }
  }

  return results;
}

module.exports = {
  SUPPORTED_LANGUAGES,
  UI_DICTIONARY,
  t,
  splitHtmlIntoSections,
  translatePostToLanguage,
  translatePageToLanguage,
  translatePostAllLanguages
};
