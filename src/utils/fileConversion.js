export const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const MARKDOWN_MIME_TYPES = ['text/markdown', 'text/x-markdown'];
const TEXT_MIME_TYPES = ['text/plain'];

const MAX_CHARS_PER_LINE = 90;
const PDF_LINE_HEIGHT = 16;
const PAGE_WIDTH = 612; // 8.5 inches * 72 dpi
const PAGE_HEIGHT = 792; // 11 inches * 72 dpi
const LEFT_MARGIN = 72;
const TOP_MARGIN = 72;
const BOTTOM_MARGIN = 72;

const toLowerCase = (value) => (typeof value === 'string' ? value.toLowerCase() : '');

const hasExtension = (name, extension) => name.endsWith(extension);

const baseFileName = (name = '') => {
  if (typeof name !== 'string') {
    return 'document';
  }
  const trimmed = name.trim();
  if (!trimmed) {
    return 'document';
  }
  const withoutExt = trimmed.replace(/\.[^/.]+$/, '');
  return withoutExt && withoutExt !== trimmed ? withoutExt : trimmed;
};

const ensurePdfFileName = (name) => {
  const lowered = toLowerCase(name);
  if (lowered.endsWith('.pdf')) {
    return name;
  }
  return `${baseFileName(name)}.pdf`;
};

export const isDocxFile = (file) => {
  if (!file) return false;
  const name = toLowerCase(file.name);
  const type = toLowerCase(file.type);
  return hasExtension(name, '.docx') || type === toLowerCase(DOCX_MIME_TYPE);
};

export const isPdfFile = (file) => {
  if (!file) return false;
  const name = toLowerCase(file.name);
  const type = toLowerCase(file.type);
  return hasExtension(name, '.pdf') || type === 'application/pdf';
};

const isMarkdownFile = (file) => {
  if (!file) return false;
  const name = toLowerCase(file.name);
  const type = toLowerCase(file.type);
  return hasExtension(name, '.md') || hasExtension(name, '.markdown') || MARKDOWN_MIME_TYPES.includes(type);
};

const isTextFile = (file) => {
  if (!file) return false;
  const name = toLowerCase(file.name);
  const type = toLowerCase(file.type);
  return hasExtension(name, '.txt') || TEXT_MIME_TYPES.includes(type);
};

const ensureFileInstance = (blob, name, lastModified) => {
  if (typeof File === 'function') {
    return new File([blob], name, {
      type: 'application/pdf',
      lastModified,
    });
  }

  const fallback = blob;
  fallback.name = name;
  fallback.lastModified = lastModified;
  fallback.type = 'application/pdf';
  return fallback;
};

const wrapParagraph = (paragraph, maxChars) => {
  const cleaned = paragraph.replace(/\s+/g, ' ').trim();
  if (!cleaned) {
    return [''];
  }

  const words = cleaned.split(' ');
  const lines = [];
  let currentLine = words.shift() || '';

  words.forEach((word) => {
    if (!currentLine) {
      currentLine = word;
      return;
    }

    const candidate = `${currentLine} ${word}`;
    if (candidate.length <= maxChars) {
      currentLine = candidate;
      return;
    }

    lines.push(currentLine);

    if (word.length > maxChars) {
      for (let i = 0; i < word.length; i += maxChars) {
        lines.push(word.slice(i, i + maxChars));
      }
      currentLine = '';
    } else {
      currentLine = word;
    }
  });

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.length > 0 ? lines : [''];
};

const sanitizePdfLine = (line = '') => {
  return line
    .replace(/[\r\t]/g, ' ')
    .replace(/[\f\v]/g, '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
};

const chunkLinesIntoPages = (lines) => {
  const usableHeight = PAGE_HEIGHT - TOP_MARGIN - BOTTOM_MARGIN;
  const linesPerPage = Math.max(1, Math.floor(usableHeight / PDF_LINE_HEIGHT));
  const pages = [];

  for (let i = 0; i < lines.length; i += linesPerPage) {
    pages.push(lines.slice(i, i + linesPerPage));
  }

  return pages.length > 0 ? pages : [['']];
};

const buildContentStream = (lines) => {
  const sanitizedLines = lines.map((line) => sanitizePdfLine(line || ' '));
  const commands = [
    'BT',
    '/F1 12 Tf',
    `${PDF_LINE_HEIGHT} TL`,
    `${LEFT_MARGIN} ${PAGE_HEIGHT - TOP_MARGIN} Td`,
  ];

  if (sanitizedLines.length === 0) {
    commands.push('( ) Tj');
  } else {
    sanitizedLines.forEach((line, index) => {
      if (index > 0) {
        commands.push('T*');
      }
      commands.push(`(${line.length ? line : ' '}) Tj`);
    });
  }

  commands.push('ET');
  return commands.join('\n');
};

const buildSimplePdf = (pages) => {
  const encoder = new TextEncoder();
  const pdfParts = [];
  const objectOffsets = [];
  let currentLength = 0;

  const push = (str) => {
    pdfParts.push(str);
    currentLength += encoder.encode(str).length;
  };

  const addObject = (str) => {
    objectOffsets.push(currentLength);
    push(str);
  };

  push('%PDF-1.7\n');

  const kidsRefs = pages.map((_, index) => `${4 + index * 2} 0 R`).join(' ');

  addObject('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  addObject(`2 0 obj\n<< /Type /Pages /Count ${pages.length} /Kids [${kidsRefs}] >>\nendobj\n`);
  addObject('3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n');

  pages.forEach((pageLines, index) => {
    const pageNumber = 4 + index * 2;
    const contentNumber = pageNumber + 1;
    const pageObject = `${pageNumber} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Contents ${contentNumber} 0 R /Resources << /Font << /F1 3 0 R >> >> >>\nendobj\n`;
    addObject(pageObject);

    const contentStream = buildContentStream(pageLines);
    const contentBytes = encoder.encode(contentStream);
    const contentObject = `${contentNumber} 0 obj\n<< /Length ${contentBytes.length} >>\nstream\n${contentStream}\nendstream\nendobj\n`;
    addObject(contentObject);
  });

  const xrefOffset = currentLength;
  const totalObjects = objectOffsets.length + 1;
  let xref = `xref\n0 ${totalObjects}\n0000000000 65535 f \n`;
  objectOffsets.forEach((offset) => {
    xref += `${offset.toString().padStart(10, '0')} 00000 n \n`;
  });
  push(xref);
  push(`trailer\n<< /Size ${totalObjects} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

  const pdfString = pdfParts.join('');
  return encoder.encode(pdfString);
};

const readFileAsText = async (file) => {
  if (file && typeof file.text === 'function') {
    return file.text();
  }

  if (file && typeof file.arrayBuffer === 'function') {
    const arrayBuffer = await file.arrayBuffer();
    const decoder = new TextDecoder('utf-8', { fatal: false });
    return decoder.decode(arrayBuffer);
  }

  throw new Error('Text conversion requires text() or arrayBuffer support on the provided file.');
};

const markdownToPlainText = (markdown = '') => {
  return markdown
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```/g, ''))
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\!\[[^\]]*\]\([^\)]+\)/g, '')
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, '$1')
    .replace(/#{1,6}\s*/g, '')
    .replace(/^>\s?/gm, '')
    .replace(/^[\s]*[-+*]\s+/gm, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
};

const buildPdfFromText = (textContent, file, emptyMessage) => {
  const normalizedText = (textContent || '')
    .replace(/\uFEFF/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');

  const paragraphs = normalizedText.split('\n');
  const lines = [];

  paragraphs.forEach((paragraph) => {
    if (!paragraph.trim()) {
      lines.push('');
      return;
    }
    const wrapped = wrapParagraph(paragraph, MAX_CHARS_PER_LINE);
    lines.push(...wrapped);
  });

  if (lines.length === 0) {
    lines.push(emptyMessage || 'This document contained no extractable text.');
  }

  const pages = chunkLinesIntoPages(lines);
  const pdfBytes = buildSimplePdf(pages);
  const pdfBlob = new Blob([pdfBytes], { type: 'application/pdf' });
  const pdfFileName = ensurePdfFileName(file?.name);
  const pdfFile = ensureFileInstance(pdfBlob, pdfFileName, file?.lastModified || Date.now());

  if (typeof pdfFile.arrayBuffer !== 'function') {
    const baseBuffer = pdfBytes.buffer.slice(
      pdfBytes.byteOffset,
      pdfBytes.byteOffset + pdfBytes.byteLength
    );

    Object.defineProperty(pdfFile, 'arrayBuffer', {
      configurable: true,
      enumerable: false,
      writable: true,
      value: async () => baseBuffer.slice(0),
    });
  }

  return pdfFile;
};

export const convertFileToPdfIfNeeded = async (file) => {
  if (!file) {
    return {
      file: null,
      converted: false,
      originalFileName: null,
      originalMimeType: null,
      conversion: null,
    };
  }

  if (isPdfFile(file)) {
    return {
      file,
      converted: false,
      originalFileName: file.name || null,
      originalMimeType: file.type || 'application/pdf',
      conversion: null,
    };
  }

  if (isDocxFile(file)) {
    if (typeof file.arrayBuffer !== 'function') {
      throw new Error('DOCX conversion requires arrayBuffer support on the provided file.');
    }

    try {
      const arrayBuffer = await file.arrayBuffer();
      const mammothModule = await import('mammoth');
      const { value: rawText = '' } = await mammothModule.extractRawText({ arrayBuffer });

      const convertedFile = buildPdfFromText(
        rawText,
        file,
        'This document was converted from DOCX but contained no extractable text.'
      );

      return {
        file: convertedFile,
        converted: true,
        originalFileName: file.name || null,
        originalMimeType: file.type || DOCX_MIME_TYPE,
        conversion: 'docx-to-pdf',
      };
    } catch (error) {
      console.error('Failed to convert DOCX to PDF:', error);
      throw new Error(`Failed to convert DOCX to PDF: ${error.message}`);
    }
  }

  if (isTextFile(file) || isMarkdownFile(file)) {
    if (typeof file.text !== 'function' && typeof file.arrayBuffer !== 'function') {
      throw new Error('Text conversion requires text() or arrayBuffer support on the provided file.');
    }

    try {
      const rawContent = await readFileAsText(file);
      const plainText = isMarkdownFile(file) ? markdownToPlainText(rawContent) : rawContent;
      const convertedFile = buildPdfFromText(
        plainText,
        file,
        `This document was converted from ${isMarkdownFile(file) ? 'Markdown' : 'text'} but contained no extractable content.`
      );

      return {
        file: convertedFile,
        converted: true,
        originalFileName: file.name || null,
        originalMimeType:
          file.type || (isMarkdownFile(file) ? MARKDOWN_MIME_TYPES[0] : TEXT_MIME_TYPES[0]),
        conversion: isMarkdownFile(file) ? 'markdown-to-pdf' : 'text-to-pdf',
      };
    } catch (error) {
      console.error('Failed to convert text-based file to PDF:', error);
      throw new Error(`Failed to convert ${isMarkdownFile(file) ? 'Markdown' : 'text'} file to PDF: ${error.message}`);
    }
  }

  return {
    file,
    converted: false,
    originalFileName: file.name || null,
    originalMimeType: file.type || null,
    conversion: null,
  };
};

export const convertDocxToPdfIfNeeded = convertFileToPdfIfNeeded;

export default convertFileToPdfIfNeeded;
