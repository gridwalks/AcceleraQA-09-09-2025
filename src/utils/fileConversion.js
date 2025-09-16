export const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const MAX_CHARS_PER_LINE = 90;
const PDF_LINE_HEIGHT = 16;
const PAGE_WIDTH = 612; // 8.5 inches * 72 dpi
const PAGE_HEIGHT = 792; // 11 inches * 72 dpi
const LEFT_MARGIN = 72;
const TOP_MARGIN = 72;
const BOTTOM_MARGIN = 72;

const isDocxFile = (file) => {
  if (!file) return false;
  const name = typeof file.name === 'string' ? file.name.toLowerCase() : '';
  const type = typeof file.type === 'string' ? file.type.toLowerCase() : '';
  return name.endsWith('.docx') || type === DOCX_MIME_TYPE;
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
  const sanitizedLines = lines.map(line => sanitizePdfLine(line || ' '));
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

export const convertDocxToPdfIfNeeded = async (file) => {
  if (!isDocxFile(file)) {
    return {
      file,
      converted: false,
      originalFileName: file?.name || null,
      originalMimeType: file?.type || null,
    };
  }

  if (typeof file.arrayBuffer !== 'function') {
    throw new Error('DOCX conversion requires arrayBuffer support on the provided file.');
  }

  try {
    const arrayBuffer = await file.arrayBuffer();
    const mammothModule = await import('mammoth');
    const { value: rawText = '' } = await mammothModule.extractRawText({ arrayBuffer });

    const normalizedText = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
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
      lines.push('This document was converted from DOCX but contained no extractable text.');
    }

    const pages = chunkLinesIntoPages(lines);
    const pdfBytes = buildSimplePdf(pages);
    const pdfBlob = new Blob([pdfBytes], { type: 'application/pdf' });
    const pdfFileName = (file.name || 'document.docx').replace(/\.docx$/i, '.pdf');
    const convertedFile = ensureFileInstance(pdfBlob, pdfFileName, file.lastModified || Date.now());

    return {
      file: convertedFile,
      converted: true,
      originalFileName: file.name || null,
      originalMimeType: file.type || DOCX_MIME_TYPE,
    };
  } catch (error) {
    console.error('Failed to convert DOCX to PDF:', error);
    throw new Error(`Failed to convert DOCX to PDF: ${error.message}`);
  }
};

export default convertDocxToPdfIfNeeded;
