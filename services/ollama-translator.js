const { calculateReadingTime, savePostTranslation, savePageTranslation } = require('../db');

const OLLAMA_HOST = (process.env.OLLAMA_HOST || 'https://ollama-ms-ry1.nextray.org').replace(/\/+$/, '');
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
  hero_default_title: {
    id: 'Catatan, Kajian Ilmiah & Pemikiran Keislaman',
    en: 'Notes, Scholarly Studies & Islamic Philosophy',
    ar: 'ملاحظات، دراسات علمية وفكر إسلامي',
    fa: 'یادداشت‌ها، مطالعات علمی و اندیشه اسلامی'
  },
  hero_default_content: {
    id: 'Ruang publikasi artikel ilmiah, studi keislaman, opini, dan catatan pemikiran oleh Kyai & Pengasuh Pondok Pesantren Khatamun Nabiyyin Jakarta.',
    en: 'A platform for academic articles, Islamic studies, religious philosophy, and scholarly commentary by Kyai & Director of Khatamun Nabiyyin Islamic Seminary, Jakarta.',
    ar: 'منصة لنشر المقالات الأكاديمية، الدراسات الإسلامية، والآراء الفكرية لمدير حوزة خاتم النبيين (ص) بجاكرتا.',
    fa: 'پایگاه نشر مقالات پژوهشی، مطالعات اسلامی و اندیشه‌های دینی به قلم مدیر حوزه علمیه خاتم النبیین (ص) جاکارتا.'
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
    id: 'Diskusi & Tanggapan Ilmiah',
    en: 'Scholarly Discussion & Comments',
    ar: 'المناقشات والتعليقات العلمية',
    fa: 'بحث و نظرات علمی'
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

  const result = {
    title: translatedMeta.title.trim(),
    meta_description: (translatedMeta.meta_description || '').trim(),
    category: (translatedMeta.category || post.category || 'Kajian').trim(),
    content: fullTranslatedContent.trim(),
    reading_time: calculateReadingTime(fullTranslatedContent),
    lang_code: targetLang
  };

  // Save / Cache in Database
  if (post.id) {
    savePostTranslation(post.id, targetLang, result);
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

    const result = {
      title: parsed.title || pageData.title,
      subtitle: parsed.subtitle || pageData.subtitle,
      content: parsed.content || pageData.content,
      lang_code: targetLang
    };

    savePageTranslation(pageSlug, targetLang, result);
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
