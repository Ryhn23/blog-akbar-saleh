const { calculateReadingTime, computeContentHash, savePostTranslation, savePageTranslation, getPageTranslation } = require('../db');

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
 * Global UI Localized Dictionary for interface elements, buttons, and navigation
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
  download_attachment: {
    id: 'Unduh Berkas',
    en: 'Download File',
    ar: 'تحميل الملف',
    fa: 'دانلود فایل'
  },
  related_articles: {
    id: 'Kajian Terkait Lainnya',
    en: 'Related Scholarly Articles',
    ar: 'مقالات ودراسات ذات صلة',
    fa: 'مقالات و پژوهش‌های مرتبط'
  },
  discussion_intro: {
    id: 'Ruang pertukaran gagasan, catatan kritis, dan dialog ilmiah yang santun.',
    en: 'A platform for intellectual exchange, constructive insights, and respectful academic dialogue.',
    ar: 'مساحة لتبادل الأفكار، والرؤى النقدية، والحوار العلمي البنّاء.',
    fa: 'فضایی برای تبادل اندیشه، یادداشت‌های انتقادی و گفتگوی علمی سازنده.'
  },
  sort_by: {
    id: 'Urutan:',
    en: 'Sort by:',
    ar: 'الترتيب:',
    fa: 'مرتب‌سازی:'
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
  login_to_comment: {
    id: 'Ingin berdiskusi atau menyampaikan tanggapan?',
    en: 'Want to join the discussion or share your response?',
    ar: 'هل ترغب في المشاركة في النقاش أو تقديم تعليق؟',
    fa: 'مایل به مشارکت در بحث یا ارسال دیدگاه هستید؟'
  },
  login_to_comment_desc: {
    id: 'Masuk dengan Akun Google Anda untuk menyampaikan catatan kritis atau pertanyaan ilmiah.',
    en: 'Sign in with your Google account to share your constructive feedback or academic inquiries.',
    ar: 'سجل الدخول باستخدام حساب جوجل للمشاركة بملاحظاتك العلمية أو استفساراتك.',
    fa: 'برای ارسال نظرات تحلیلی یا پرسش‌های علمی خود با حساب گوگل وارد شوید.'
  },
  login_with_google: {
    id: 'Masuk dengan Google',
    en: 'Sign in with Google',
    ar: 'تسجيل الدخول باستخدام جوجل',
    fa: 'ورود با حساب گوگل'
  },
  write_comment_placeholder: {
    id: 'Tulis tanggapan atau catatan kritis Anda di sini secara santun...',
    en: 'Write your scholarly response or constructive inquiry respectfully...',
    ar: 'اكتب تعليقك أو ملاحظاتك النقدية هنا بأسلوب علمي رصين...',
    fa: 'دیدگاه یا یادداشت تحلیلی خود را با بیانی محترمانه بنویسید...'
  },
  send_comment: {
    id: 'Kirim Tanggapan',
    en: 'Submit Response',
    ar: 'إرسال التعليق',
    fa: 'ارسال دیدگاه'
  },
  reply_to: {
    id: 'Balas tanggapan',
    en: 'Reply to',
    ar: 'الرد على',
    fa: 'پاسخ به'
  },
  reply: {
    id: 'Balas',
    en: 'Reply',
    ar: 'رد',
    fa: 'پاسخ'
  },
  cancel: {
    id: 'Batal',
    en: 'Cancel',
    ar: 'إلغاء',
    fa: 'انصراف'
  },
  author_badge: {
    id: 'Penulis',
    en: 'Author',
    ar: 'الكاتب',
    fa: 'نویسنده'
  },
  author_profile_tag: {
    id: 'Profil Penulis',
    en: 'Author Profile',
    ar: 'الملف التعريفي للكاتب',
    fa: 'مشخصات نویسنده'
  },
  reading_label: {
    id: 'Baca',
    en: 'Read',
    ar: 'قراءة',
    fa: 'مطالعه'
  },
  filter_all: {
    id: 'Semua',
    en: 'All',
    ar: 'الكل',
    fa: 'همه'
  },
  no_articles_found: {
    id: 'Belum ada tulisan dalam kategori atau pencarian ini.',
    en: 'No articles found in this category or search.',
    ar: 'لم يتم العثور على مقالات في هذا القسم أو البحث.',
    fa: 'مقاله‌ای در این دسته‌بندی یا جستجو یافت نشد.'
  },
  no_articles_yet: {
    id: 'Belum ada artikel yang dipublikasikan.',
    en: 'No published articles yet.',
    ar: 'لا توجد مقالات منشورة حتى الآن.',
    fa: 'هنوز مقاله‌ای منتشر نشده است.'
  },
  filter_clear: {
    id: 'Lihat Seluruh Tulisan',
    en: 'View All Articles',
    ar: 'عرض جميع المقالات',
    fa: 'مشاهده همه مقالات'
  },
  ai_translation_notice: {
    id: 'Halaman ini diterjemahkan secara dinamis menggunakan model AI Gemma 4.',
    en: 'This page is dynamically translated using the Gemma 4 AI model.',
    ar: 'تمت ترجمة هذه الصفحة ديناميكيًا باستخدام نموذج الذكاء الاصطناعي Gemma 4.',
    fa: 'این صفحه به صورت پویا با استفاده از مدل هوش مصنوعی Gemma 4 ترجمه شده است.'
  },
  footer_about_heading: {
    id: 'Tentang Penulis',
    en: 'About the Author',
    ar: 'عن الكاتب',
    fa: 'درباره نویسنده'
  },
  footer_nav_heading: {
    id: 'Navigasi',
    en: 'Navigation',
    ar: 'روابط سريعة',
    fa: 'دسترسی سریع'
  },
  footer_contact_heading: {
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

const CONTEXTUAL_TRANSLATION_GUIDELINES = `
CRITICAL CONTEXTUAL TRANSLATION GUIDELINES:
1. Translate contextually, naturally, and grammatically according to the scholarly standards of the target language.
2. Contextually localize institutional, cultural, and Islamic religious concepts within the flow of the sentence:
   - Indonesian "Pesantren" / "Pondok Pesantren": Localize naturally according to context (e.g. in Arabic as "المعاهد الإسلامية" / "الحوزة العلمية" / "المعاهد الدينية"; in Persian as "حوزه‌های علمیه" / "مدارس علوم دینی"; in English as "Islamic Seminary" / "Islamic Boarding School"). NEVER leave it in untranslated Latin or as an awkward transliteration.
   - Indonesian "Santri": Localize as religious/seminary students (Arabic: "طلاب العلوم الدينية" / "طلاب المعهد"; Persian: "طلاب" / "دانش‌پژوهان"; English: "seminary students").
   - Indonesian "Kyai" / "Kiai": Localize as religious scholar/teacher/director (Arabic: "الشيخ" / "عالم الدين" / "الأستاذ"; Persian: "عالم دینی" / "استاد"; English: "Islamic scholar").
   - Indonesian "Pendidikan Pesantren": Localize as Islamic seminary education (Arabic: "التعليم الديني في المعاهد" / "التربية الحوزوية"; Persian: "آموزش حوزوی"; English: "Islamic Seminary Education").
3. Maintain appropriate grammatical agreement, cases, and natural syntax in the target language.
`;

/**
 * Translates dynamic site and author profile settings (from .env / database)
 * into target language using Ollama with SHA-256 content hash cache.
 */
async function getOrTranslateSiteProfile(targetLang) {
  const currentLang = (targetLang || 'id').toLowerCase();
  const rawProfile = {
    siteName: process.env.SITE_NAME || 'Akbar Saleh',
    siteTagline: process.env.SITE_TAGLINE || 'Kajian & Pemikiran Keislaman',
    authorRole: process.env.AUTHOR_ROLE || 'Kyai & Pengasuh Pondok Pesantren Khatamun Nabiyyin Jakarta',
    authorBio: process.env.AUTHOR_BIO || 'Kyai dan Pengasuh Pondok Pesantren Khatamun Nabiyyin Jakarta. Menulis seputar studi keislaman, riset keilmuan, dan analisis sosial keagamaan.',
    authorLocation: process.env.AUTHOR_LOCATION || 'Jakarta, Indonesia'
  };

  if (currentLang === 'id' || !SUPPORTED_LANGUAGES[currentLang]) {
    return rawProfile;
  }

  const sourceHash = computeContentHash(rawProfile);
  const cached = getPageTranslation('site_profile', currentLang, sourceHash);

  if (cached && cached.content) {
    try {
      const parsed = JSON.parse(cached.content);
      return {
        siteName: rawProfile.siteName,
        siteTagline: parsed.site_tagline || rawProfile.siteTagline,
        authorRole: parsed.author_role || rawProfile.authorRole,
        authorBio: parsed.author_bio || rawProfile.authorBio,
        authorLocation: parsed.author_location || rawProfile.authorLocation
      };
    } catch (_) {}
  }

  // Translate dynamically on-demand via Ollama
  const langConfig = SUPPORTED_LANGUAGES[currentLang];
  const systemPrompt = `You are a distinguished academic translator specializing in Islamic studies, theology, and philosophy.
Your task is to translate dynamic author profile and website metadata from Indonesian into ${langConfig.promptTarget}.

${CONTEXTUAL_TRANSLATION_GUIDELINES}

Output MUST BE strictly a valid JSON object with the following keys:
- "site_tagline": (string) Translated site tagline
- "author_role": (string) Translated author role and institution
- "author_bio": (string) Translated short biography
- "author_location": (string) Translated location/city`;

  const userPrompt = `Translate the following site profile metadata from Indonesian to ${langConfig.name}:
Tagline: ${rawProfile.siteTagline}
Author Role: ${rawProfile.authorRole}
Author Bio: ${rawProfile.authorBio}
Location: ${rawProfile.authorLocation}`;

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
      throw new Error(`Ollama HTTP Error ${response.status}`);
    }

    const data = await response.json();
    const parsed = extractJsonFromLlmResponse(data.message.content);

    if (parsed) {
      savePageTranslation('site_profile', currentLang, {
        title: parsed.site_tagline || rawProfile.siteTagline,
        subtitle: parsed.author_role || rawProfile.authorRole,
        content: JSON.stringify(parsed)
      }, sourceHash);

      return {
        siteName: rawProfile.siteName,
        siteTagline: parsed.site_tagline || rawProfile.siteTagline,
        authorRole: parsed.author_role || rawProfile.authorRole,
        authorBio: parsed.author_bio || rawProfile.authorBio,
        authorLocation: parsed.author_location || rawProfile.authorLocation
      };
    }
  } catch (err) {
    clearTimeout(timeoutId);
    console.warn(`[Ollama Site Profile Translate Failed for '${currentLang}']:`, err.message);
  }

  return rawProfile;
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
3. ${CONTEXTUAL_TRANSLATION_GUIDELINES}
4. Output MUST BE strictly a valid JSON object with EXACTLY the following key:
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
${CONTEXTUAL_TRANSLATION_GUIDELINES}
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
${CONTEXTUAL_TRANSLATION_GUIDELINES}
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
      title: (parsed.title || pageData.title).trim(),
      subtitle: (parsed.subtitle || pageData.subtitle || '').trim(),
      content: (parsed.content || pageData.content).trim(),
      lang_code: targetLang,
      source_hash: sourceHash
    };

    savePageTranslation(pageSlug, targetLang, result, sourceHash);
    return result;
  } catch (err) {
    clearTimeout(timeoutId);
    console.error(`[Ollama Translator] Failed to translate page ${pageSlug} to ${targetLang}:`, err.message);
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
  getOrTranslateSiteProfile,
  translatePostToLanguage,
  translatePageToLanguage,
  translatePostAllLanguages,
  computeContentHash
};
