const { calculateReadingTime, savePostTranslation } = require('../db');

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
 * Extracts and cleans JSON string from LLM output (even if wrapped in markdown code blocks)
 */
function extractJsonFromLlmResponse(rawContent) {
  if (!rawContent) return null;
  let text = rawContent.trim();
  
  // Remove markdown code fences if present
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  }

  try {
    return JSON.parse(text);
  } catch (err) {
    // Try regex extraction of outermost JSON object
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (innerErr) {
        console.error('[Ollama Translator] Failed to parse JSON from response:', innerErr.message);
      }
    }
    throw new Error('Respons dari Ollama bukan format JSON yang valid: ' + err.message);
  }
}

/**
 * Translates a single post into target language using Ollama
 */
async function translatePostToLanguage(post, targetLang) {
  if (!post || !post.title || !post.content) {
    throw new Error('Data artikel tidak lengkap untuk diterjemahkan.');
  }

  const langConfig = SUPPORTED_LANGUAGES[targetLang];
  if (!langConfig || targetLang === 'id') {
    throw new Error(`Bahasa target '${targetLang}' tidak didukung atau merupakan bahasa utama.`);
  }

  const systemPrompt = `You are a distinguished academic translator specializing in Islamic studies, classical jurisprudence (fiqh), philosophy, and religious literature.
Your task is to translate an Indonesian Islamic scholarly article into ${langConfig.promptTarget}.

CRITICAL RULES:
1. Preserve ALL HTML tags, attributes, formatting, headings (<h3>, <h4>), lists (<ul>, <ol>, <li>), blockquotes, and link anchors (<a href="...">) EXACTLY as structured.
2. Translate ONLY the human-readable text inside the HTML elements. Do not remove or alter image tags, formatting tags, or CSS classes.
3. Preserve Islamic honorifics, scholastic terms, and proper nouns with proper academic standard transliteration and dignity.
4. Output MUST BE strictly a valid JSON object with EXACTLY the following keys:
   - "title": (string) Translated title of the article
   - "meta_description": (string) Translated meta description summary
   - "category": (string) Translated category name
   - "content": (string) Full translated HTML content
Do NOT include any commentary, explanations, or text outside the JSON object.`;

  const userPrompt = `Please translate this article from Indonesian to ${langConfig.name}:

Title: ${post.title}
Category: ${post.category || 'Kajian Keislaman'}
Meta Description: ${post.meta_description || ''}

HTML Content:
${post.content}`;

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
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`Ollama HTTP Error ${response.status}: ${errBody}`);
    }

    const data = await response.json();
    if (!data || !data.message || !data.message.content) {
      throw new Error('Format respon API Ollama tidak sesuai ekspektasi.');
    }

    const parsed = extractJsonFromLlmResponse(data.message.content);
    if (!parsed || !parsed.title || !parsed.content) {
      throw new Error('Hasil terjemahan tidak memiliki atribut title atau content yang lengkap.');
    }

    const result = {
      title: parsed.title.trim(),
      meta_description: (parsed.meta_description || '').trim(),
      category: (parsed.category || post.category || 'Kajian').trim(),
      content: parsed.content.trim(),
      reading_time: calculateReadingTime(parsed.content),
      lang_code: targetLang
    };

    // Save/Cache into database
    if (post.id) {
      savePostTranslation(post.id, targetLang, result);
    }

    return result;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`Permintaan ke server Ollama timeout setelah ${OLLAMA_TIMEOUT / 1000} detik.`);
    }
    throw error;
  }
}

/**
 * Translates a post to all supported foreign languages (en, ar, fa)
 */
async function translatePostAllLanguages(post) {
  const results = {};
  const foreignLangs = ['en', 'ar', 'fa'];

  for (const lang of foreignLangs) {
    try {
      console.log(`[Ollama Translator] Translating post #${post.id} (${post.slug}) to ${lang}...`);
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
  translatePostToLanguage,
  translatePostAllLanguages
};
