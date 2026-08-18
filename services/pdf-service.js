const path = require('path');
const fs = require('fs');
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const PDFDocument = require('pdfkit');

// Register TTF fonts for Canvas rendering
const fontsDir = path.join(__dirname, '..', 'public', 'fonts');
if (fs.existsSync(fontsDir)) {
  const fontMap = [
    { file: 'DejaVuSans.ttf', name: 'DejaVu Sans' },
    { file: 'DejaVuSans-Bold.ttf', name: 'DejaVu Sans Bold' },
    { file: 'DejaVuSans-Oblique.ttf', name: 'DejaVu Sans Oblique' },
    { file: 'DejaVuSerif.ttf', name: 'DejaVu Serif' },
    { file: 'DejaVuSerif-Bold.ttf', name: 'DejaVu Serif Bold' }
  ];

  fontMap.forEach(({ file, name }) => {
    const fullPath = path.join(fontsDir, file);
    if (fs.existsSync(fullPath)) {
      try {
        GlobalFonts.registerFromPath(fullPath, name);
      } catch (err) {
        console.warn(`[Fonts] Failed to register ${file}:`, err.message);
      }
    }
  });
}

/**
 * Strips HTML tags and decodes common HTML entities
 */
function cleanHtml(html) {
  if (!html) return '';
  return html
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&rdquo;|&ldquo;/g, '"')
    .replace(/&rsquo;|&lsquo;/g, "'")
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–');
}

/**
 * Parses article HTML into structured blocks (paragraphs, headers, list items, quotes)
 */
function parseHtmlToBlocks(html) {
  if (!html) return [];
  const blocks = [];
  const cleaned = html.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const tagRegex = /<(p|h1|h2|h3|h4|blockquote|li)[^>]*>([\s\S]*?)<\/\1>/gi;
  let match;

  while ((match = tagRegex.exec(cleaned)) !== null) {
    const tag = match[1].toLowerCase();
    const innerHtml = match[2];
    const plainText = cleanHtml(innerHtml.replace(/<[^>]+>/g, '').trim());

    if (plainText) {
      if (tag === 'h1' || tag === 'h2') {
        blocks.push({ type: 'h2', text: plainText });
      } else if (tag === 'h3' || tag === 'h4') {
        blocks.push({ type: 'h3', text: plainText });
      } else if (tag === 'blockquote') {
        blocks.push({ type: 'quote', text: plainText });
      } else if (tag === 'li') {
        blocks.push({ type: 'bullet', text: plainText });
      } else {
        blocks.push({ type: 'paragraph', text: plainText });
      }
    }
  }

  if (blocks.length === 0) {
    const rawParagraphs = cleaned
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .split(/\n\s*\n/);

    rawParagraphs.forEach(p => {
      const text = cleanHtml(p.trim());
      if (text) blocks.push({ type: 'paragraph', text });
    });
  }

  return blocks;
}

const SCALE = 2; // 2x resolution (144 DPI) for crisp retina/print rendering
const PAGE_W = 595.28; // A4 Width in pt
const PAGE_H = 841.89; // A4 Height in pt
const MARGIN = 50;
const CONTENT_W = PAGE_W - (MARGIN * 2);
const MAX_CONTENT_Y = PAGE_H - 55;

/**
 * Wraps text into lines that fit within maxWidth
 */
function wrapText(ctx, text, maxWidth) {
  const words = text.split(/\s+/);
  const lines = [];
  let currentLine = '';

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const width = ctx.measureText(testLine).width;
    if (width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

/**
 * Sandwich PDF Engine:
 * Layer 1 (Visual): Flattened Canvas Graphic (100% immune to text edits in online PDF editors)
 * Layer 2 (Text): Invisible Selectable Text Layer (Allows users to highlight, CTRL+C copy, and CTRL+F search)
 */
class SandwichPdfBuilder {
  constructor(post, options = {}) {
    this.post = post;
    this.authorName = options.authorName || 'Akbar Saleh, B.A.';
    this.authorRole = options.authorRole || 'Kyai & Pengasuh Pondok Pesantren Khatamun Nabiyyin Jakarta';
    this.siteName = options.siteName || 'Akbar Saleh';
    this.siteUrl = options.siteUrl || 'https://khatamunnabiyyin.com';
    this.articleUrl = `${this.siteUrl}/blog/${post.slug}`;
    this.pages = [];
    this.currentPage = null;
  }

  addNewPage() {
    const canvas = createCanvas(PAGE_W * SCALE, PAGE_H * SCALE);
    const ctx = canvas.getContext('2d');
    ctx.scale(SCALE, SCALE);

    // Clean white background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);

    const pageObj = {
      canvas,
      ctx,
      textOverlays: [],
      y: MARGIN
    };

    this.pages.push(pageObj);
    this.currentPage = pageObj;

    const pageNum = this.pages.length;
    if (pageNum === 1) {
      this.drawHeaderLetterhead();
    } else {
      this.drawRunningHeader();
    }

    return pageObj;
  }

  ensureSpace(neededHeight) {
    if (!this.currentPage || this.currentPage.y + neededHeight > MAX_CONTENT_Y) {
      this.addNewPage();
    }
  }

  drawHeaderLetterhead() {
    const { ctx } = this.currentPage;

    // Emerald top accent bar
    ctx.fillStyle = '#065f46';
    ctx.fillRect(50, 40, CONTENT_W, 3);

    // Site Title
    ctx.fillStyle = '#064e3b';
    ctx.font = '16px "DejaVu Sans Bold", sans-serif';
    ctx.fillText(this.siteName.toUpperCase(), 50, 62);
    this.addOverlayText(this.siteName.toUpperCase(), 50, 50, 16, 'Helvetica-Bold');

    // Subtitle
    ctx.fillStyle = '#4b5563';
    ctx.font = '9px "DejaVu Sans Oblique", sans-serif';
    ctx.fillText('Ruang Publikasi Riset Ilmiah, Telaah Fiqih & Catatan Pemikiran Keislaman', 50, 78);

    // Author Role
    ctx.fillStyle = '#6b7280';
    ctx.font = '8.5px "DejaVu Sans", sans-serif';
    ctx.fillText(this.authorRole, 50, 92);

    // Header Divider
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(50, 102);
    ctx.lineTo(PAGE_W - 50, 102);
    ctx.stroke();

    this.currentPage.y = 118;
  }

  drawRunningHeader() {
    const { ctx } = this.currentPage;
    ctx.fillStyle = '#6b7280';
    ctx.font = '8px "DejaVu Sans", sans-serif';
    ctx.fillText(`${this.siteName.toUpperCase()} — ${this.post.category || 'KAJIAN KEISLAMAN'}`, 50, 35);

    ctx.strokeStyle = '#f3f4f6';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(50, 42);
    ctx.lineTo(PAGE_W - 50, 42);
    ctx.stroke();

    this.currentPage.y = 60;
  }

  addOverlayText(text, x, y, size, font = 'Helvetica') {
    if (!text || !text.trim()) return;
    this.currentPage.textOverlays.push({
      text,
      x,
      y,
      size,
      font
    });
  }

  renderPostHeader() {
    const categoryText = (this.post.category || 'KAJIAN KEISLAMAN').toUpperCase();
    const dateFormatted = new Date(this.post.created_at || Date.now()).toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
    const readTime = this.post.reading_time || 1;
    const metaLine = `[ ${categoryText} ]   •   ${dateFormatted}   •   ${readTime} menit baca`;

    const { ctx } = this.currentPage;

    // Metadata line
    ctx.fillStyle = '#047857';
    ctx.font = '8.5px "DejaVu Sans Bold", sans-serif';
    ctx.fillText(`[ ${categoryText} ]`, 50, this.currentPage.y);

    const catW = ctx.measureText(`[ ${categoryText} ]`).width;
    ctx.fillStyle = '#6b7280';
    ctx.font = '8.5px "DejaVu Sans", sans-serif';
    ctx.fillText(`   •   ${dateFormatted}   •   ${readTime} menit baca`, 50 + catW, this.currentPage.y);

    this.addOverlayText(metaLine, 50, this.currentPage.y - 8, 8.5, 'Helvetica');
    this.currentPage.y += 18;

    // Title
    ctx.font = '17px "DejaVu Sans Bold", sans-serif';
    const titleLines = wrapText(ctx, this.post.title, CONTENT_W);
    this.ensureSpace(titleLines.length * 24 + 30);

    for (const line of titleLines) {
      this.currentPage.ctx.fillStyle = '#111827';
      this.currentPage.ctx.font = '17px "DejaVu Sans Bold", sans-serif';
      this.currentPage.ctx.fillText(line, 50, this.currentPage.y);
      this.addOverlayText(line, 50, this.currentPage.y - 14, 17, 'Helvetica-Bold');
      this.currentPage.y += 24;
    }

    this.currentPage.y += 4;

    // Author byline: strictly author name
    this.currentPage.ctx.fillStyle = '#374151';
    this.currentPage.ctx.font = '9.5px "DejaVu Sans Bold", sans-serif';
    const authorLine = `Penulis: ${this.authorName}`;
    this.currentPage.ctx.fillText(authorLine, 50, this.currentPage.y);
    this.addOverlayText(authorLine, 50, this.currentPage.y - 8, 9.5, 'Helvetica-Bold');

    this.currentPage.y += 16;

    // Abstract box (if present)
    if (this.post.meta_description && this.post.meta_description.trim()) {
      const abstractText = cleanHtml(this.post.meta_description.trim());
      ctx.font = '9px "DejaVu Sans Oblique", sans-serif';
      const absLines = wrapText(ctx, `Abstrak: "${abstractText}"`, CONTENT_W - 24);
      const boxH = absLines.length * 14 + 14;

      this.ensureSpace(boxH + 10);
      const boxY = this.currentPage.y;

      this.currentPage.ctx.fillStyle = '#10b981';
      this.currentPage.ctx.fillRect(50, boxY, CONTENT_W, 1.5);

      let textY = boxY + 12;
      for (const line of absLines) {
        this.currentPage.ctx.fillStyle = '#374151';
        this.currentPage.ctx.font = '9px "DejaVu Sans Oblique", sans-serif';
        this.currentPage.ctx.fillText(line, 60, textY);
        this.addOverlayText(line, 60, textY - 8, 9, 'Helvetica-Oblique');
        textY += 14;
      }

      this.currentPage.y = boxY + boxH + 10;
    }

    // Divider line before content
    this.currentPage.ctx.strokeStyle = '#f3f4f6';
    this.currentPage.ctx.lineWidth = 0.5;
    this.currentPage.ctx.beginPath();
    this.currentPage.ctx.moveTo(50, this.currentPage.y);
    this.currentPage.ctx.lineTo(PAGE_W - 50, this.currentPage.y);
    this.currentPage.ctx.stroke();

    this.currentPage.y += 16;
  }

  renderBlocks() {
    const blocks = parseHtmlToBlocks(this.post.content);

    for (const block of blocks) {
      if (block.type === 'h2') {
        const { ctx } = this.currentPage;
        ctx.font = '12px "DejaVu Sans Bold", sans-serif';
        const lines = wrapText(ctx, block.text, CONTENT_W);
        this.ensureSpace(lines.length * 18 + 14);

        this.currentPage.y += 8;
        for (const line of lines) {
          this.currentPage.ctx.fillStyle = '#064e3b';
          this.currentPage.ctx.font = '12px "DejaVu Sans Bold", sans-serif';
          this.currentPage.ctx.fillText(line, 50, this.currentPage.y);
          this.addOverlayText(line, 50, this.currentPage.y - 10, 12, 'Helvetica-Bold');
          this.currentPage.y += 18;
        }
        this.currentPage.y += 4;
      } else if (block.type === 'h3') {
        const { ctx } = this.currentPage;
        ctx.font = '10.5px "DejaVu Sans Bold", sans-serif';
        const lines = wrapText(ctx, block.text, CONTENT_W);
        this.ensureSpace(lines.length * 16 + 10);

        this.currentPage.y += 6;
        for (const line of lines) {
          this.currentPage.ctx.fillStyle = '#1f2937';
          this.currentPage.ctx.font = '10.5px "DejaVu Sans Bold", sans-serif';
          this.currentPage.ctx.fillText(line, 50, this.currentPage.y);
          this.addOverlayText(line, 50, this.currentPage.y - 9, 10.5, 'Helvetica-Bold');
          this.currentPage.y += 16;
        }
        this.currentPage.y += 3;
      } else if (block.type === 'quote') {
        const { ctx } = this.currentPage;
        ctx.font = '9.5px "DejaVu Sans Oblique", sans-serif';
        const lines = wrapText(ctx, block.text, CONTENT_W - 25);
        const quoteH = lines.length * 15 + 8;
        this.ensureSpace(quoteH + 8);

        const startY = this.currentPage.y;
        this.currentPage.ctx.fillStyle = '#059669';
        this.currentPage.ctx.fillRect(50, startY, 3, quoteH);

        let textY = startY + 11;
        for (const line of lines) {
          this.currentPage.ctx.fillStyle = '#4b5563';
          this.currentPage.ctx.font = '9.5px "DejaVu Sans Oblique", sans-serif';
          this.currentPage.ctx.fillText(line, 62, textY);
          this.addOverlayText(line, 62, textY - 8, 9.5, 'Helvetica-Oblique');
          textY += 15;
        }
        this.currentPage.y = startY + quoteH + 8;
      } else if (block.type === 'bullet') {
        const { ctx } = this.currentPage;
        ctx.font = '9.5px "DejaVu Sans", sans-serif';
        const lines = wrapText(ctx, block.text, CONTENT_W - 16);
        this.ensureSpace(lines.length * 15 + 4);

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          this.currentPage.ctx.fillStyle = '#1f2937';
          this.currentPage.ctx.font = '9.5px "DejaVu Sans", sans-serif';
          if (i === 0) {
            this.currentPage.ctx.fillText('•', 50, this.currentPage.y);
            this.currentPage.ctx.fillText(line, 62, this.currentPage.y);
            this.addOverlayText(`• ${line}`, 50, this.currentPage.y - 8, 9.5, 'Helvetica');
          } else {
            this.currentPage.ctx.fillText(line, 62, this.currentPage.y);
            this.addOverlayText(line, 62, this.currentPage.y - 8, 9.5, 'Helvetica');
          }
          this.currentPage.y += 15;
        }
        this.currentPage.y += 3;
      } else {
        // Standard Paragraph
        const { ctx } = this.currentPage;
        ctx.font = '9.5px "DejaVu Sans", sans-serif';
        const lines = wrapText(ctx, block.text, CONTENT_W);
        this.ensureSpace(lines.length * 15 + 8);

        for (const line of lines) {
          this.currentPage.ctx.fillStyle = '#1f2937';
          this.currentPage.ctx.font = '9.5px "DejaVu Sans", sans-serif';
          this.currentPage.ctx.fillText(line, 50, this.currentPage.y);
          this.addOverlayText(line, 50, this.currentPage.y - 8, 9.5, 'Helvetica');
          this.currentPage.y += 15;
        }
        this.currentPage.y += 6;
      }
    }

    // Attachment Notice Box (if present)
    if (this.post.attachment_url) {
      this.ensureSpace(40);
      const boxY = this.currentPage.y;
      this.currentPage.ctx.fillStyle = '#ecfdf5';
      this.currentPage.ctx.strokeStyle = '#a7f3d0';
      this.currentPage.ctx.lineWidth = 1;
      this.currentPage.ctx.fillRect(50, boxY, CONTENT_W, 32);
      this.currentPage.ctx.strokeRect(50, boxY, CONTENT_W, 32);

      this.currentPage.ctx.fillStyle = '#065f46';
      this.currentPage.ctx.font = '8.5px "DejaVu Sans Bold", sans-serif';
      this.currentPage.ctx.fillText('Lampiran Dokumen Tambahan:', 62, boxY + 12);
      this.addOverlayText('Lampiran Dokumen Tambahan:', 62, boxY + 4, 8.5, 'Helvetica-Bold');

      this.currentPage.ctx.fillStyle = '#374151';
      this.currentPage.ctx.font = '8px "DejaVu Sans", sans-serif';
      const attDesc = `${this.post.attachment_name || 'Dokumen Makalah'} — Tersedia untuk diunduh di situs web.`;
      this.currentPage.ctx.fillText(attDesc, 62, boxY + 24);
      this.addOverlayText(attDesc, 62, boxY + 16, 8, 'Helvetica');

      this.currentPage.y = boxY + 40;
    }

    // Closing Note
    this.ensureSpace(30);
    this.currentPage.y += 4;
    const closingY = this.currentPage.y;

    this.currentPage.ctx.strokeStyle = '#d1d5db';
    this.currentPage.ctx.lineWidth = 0.5;
    this.currentPage.ctx.beginPath();
    this.currentPage.ctx.moveTo(50, closingY);
    this.currentPage.ctx.lineTo(PAGE_W - 50, closingY);
    this.currentPage.ctx.stroke();

    const closingText = 'Naskah ini diterbitkan secara resmi melalui blog riset pribadi Akbar Saleh, B.A. Seluruh hak cipta dilindungi undang-undang.';
    this.currentPage.ctx.fillStyle = '#6b7280';
    this.currentPage.ctx.font = '8px "DejaVu Sans Oblique", sans-serif';
    this.currentPage.ctx.fillText(closingText, 50, closingY + 12);
    this.addOverlayText(closingText, 50, closingY + 4, 8, 'Helvetica-Oblique');
  }

  renderFooters() {
    const totalPages = this.pages.length;

    for (let i = 0; i < totalPages; i++) {
      const pageObj = this.pages[i];
      const { ctx } = pageObj;
      const footerY = PAGE_H - 35;

      // Top footer line
      ctx.strokeStyle = '#e5e7eb';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(50, footerY - 6);
      ctx.lineTo(PAGE_W - 50, footerY - 6);
      ctx.stroke();

      // Left: Source Link
      ctx.fillStyle = '#059669';
      ctx.font = '7.5px "DejaVu Sans", sans-serif';
      ctx.fillText(this.articleUrl, 50, footerY + 4);
      pageObj.textOverlays.push({
        text: this.articleUrl,
        x: 50,
        y: footerY - 4,
        size: 7.5,
        font: 'Helvetica'
      });

      // Right: Page Number & Secured Notice
      ctx.fillStyle = '#9ca3af';
      ctx.font = '7.5px "DejaVu Sans", sans-serif';
      const pageText = `Halaman ${i + 1} dari ${totalPages}  •  [Secured PDF]`;
      const pW = ctx.measureText(pageText).width;
      ctx.fillText(pageText, PAGE_W - 50 - pW, footerY + 4);
      pageObj.textOverlays.push({
        text: pageText,
        x: PAGE_W - 50 - pW,
        y: footerY - 4,
        size: 7.5,
        font: 'Helvetica'
      });
    }
  }

  generate() {
    this.addNewPage();
    this.renderPostHeader();
    this.renderBlocks();
    this.renderFooters();

    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      autoFirstPage: false,
      info: {
        Title: this.post.title,
        Author: this.authorName,
        Subject: this.post.category || 'Kajian Keislaman',
        Keywords: `Kajian Keislaman, Risalah Ilmiah, ${this.authorName}`,
        Creator: 'Akbar Saleh Blog Engine (Sandwich PDF Generator)',
        Producer: 'PDFKit & Skia Canvas Engine'
      }
    });

    for (let i = 0; i < this.pages.length; i++) {
      const pageObj = this.pages[i];
      doc.addPage({
        size: 'A4',
        margins: { top: 0, bottom: 0, left: 0, right: 0 }
      });

      // Layer 1: Flattened Canvas Visual Background (High-DPI JPEG)
      const imgBuf = pageObj.canvas.toBuffer('image/jpeg', { quality: 95 });
      doc.image(imgBuf, 0, 0, { width: PAGE_W, height: PAGE_H });

      // Layer 2: Invisible Selectable Text Layer (Allows mouse selection, CTRL+C, and CTRL+F search)
      doc.fillOpacity(0);
      for (const item of pageObj.textOverlays) {
        doc.fontSize(item.size)
          .font(item.font || 'Helvetica')
          .text(item.text, item.x, item.y, { lineBreak: false });
      }
      doc.fillOpacity(1); // Reset
    }

    return doc;
  }
}

/**
 * Public function to generate an encrypted Sandwich PDF stream
 */
function generateArticlePdf(post, options = {}) {
  const builder = new SandwichPdfBuilder(post, options);
  return builder.generate();
}

module.exports = {
  generateArticlePdf
};
