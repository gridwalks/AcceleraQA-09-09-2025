export const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const MARKDOWN_MIME_TYPES = ['text/markdown', 'text/x-markdown'];
const TEXT_MIME_TYPES = ['text/plain'];
const CSV_MIME_TYPES = ['text/csv', 'application/csv', 'text/x-csv', 'application/vnd.ms-excel'];

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

const isCsvFile = (file) => {
  if (!file) return false;
  const name = toLowerCase(file.name);
  const type = toLowerCase(file.type);

  if (hasExtension(name, '.csv')) {
    return true;
  }

  return CSV_MIME_TYPES.includes(type);
};

const isXlsxFile = (file) => {
  if (!file) return false;
  const name = toLowerCase(file.name);
  const type = toLowerCase(file.type);

  return hasExtension(name, '.xlsx') || type === toLowerCase(XLSX_MIME_TYPE);
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

const decodeXmlEntities = (text = '') => {
  if (!text) {
    return '';
  }

  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCharCode(code) : '';
    })
    .replace(/&#([0-9]+);/g, (_, dec) => {
      const code = parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCharCode(code) : '';
    });
};

const extractTextNodes = (xmlSegment = '') => {
  const matches = xmlSegment.match(/<t[^>]*>[\s\S]*?<\/t>/g);

  if (!matches) {
    return '';
  }

  return matches
    .map((match) => {
      const inner = match.replace(/<t[^>]*>|<\/t>/g, '');
      return decodeXmlEntities(inner);
    })
    .join('');
};

const normalizeCellValue = (value) => {
  if (value == null) {
    return '';
  }

  const stringValue = typeof value === 'string' ? value : String(value);

  return stringValue
    .replace(/\uFEFF/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\t/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const columnLettersToIndex = (letters = '') => {
  if (!letters) {
    return 0;
  }

  let index = 0;
  for (let i = 0; i < letters.length; i += 1) {
    index *= 26;
    index += letters.charCodeAt(i) - 64;
  }
  return Math.max(0, index - 1);
};

const parseSharedStringsXml = (xml = '') => {
  if (!xml) {
    return [];
  }

  const stringItems = xml.match(/<si[\s\S]*?<\/si>/g);
  if (!stringItems) {
    return [];
  }

  return stringItems.map((item) => normalizeCellValue(extractTextNodes(item)));
};

const parseSheetXml = (xml = '', sharedStrings = []) => {
  if (!xml) {
    return [];
  }

  const sheetDataMatch = xml.match(/<sheetData[\s\S]*?<\/sheetData>/);
  const sheetData = sheetDataMatch ? sheetDataMatch[0] : xml;
  const rowMatches = sheetData.match(/<row\b[^>]*>[\s\S]*?<\/row>/g);

  if (!rowMatches) {
    return [];
  }

  const rows = [];

  rowMatches.forEach((rowXml) => {
    const cellMatches = rowXml.match(/<c\b[^>]*>[\s\S]*?<\/c>/g);
    if (!cellMatches) {
      return;
    }

    const rowValues = [];

    cellMatches.forEach((cellXml) => {
      const referenceMatch = cellXml.match(/r="([A-Z]+)(\d+)"/);
      let columnIndex = rowValues.length;

      if (referenceMatch) {
        columnIndex = columnLettersToIndex(referenceMatch[1]);
      }

      while (rowValues.length < columnIndex) {
        rowValues.push('');
      }

      const typeMatch = cellXml.match(/t="([^"']+)"/);
      const type = typeMatch ? typeMatch[1] : null;
      let cellValue = '';

      if (type === 's') {
        const valueMatch = cellXml.match(/<v>([\s\S]*?)<\/v>/);
        if (valueMatch) {
          const sharedIndex = parseInt(valueMatch[1], 10);
          if (!Number.isNaN(sharedIndex) && sharedStrings[sharedIndex] != null) {
            cellValue = sharedStrings[sharedIndex];
          }
        }
      } else if (type === 'inlineStr') {
        cellValue = extractTextNodes(cellXml);
      } else if (type === 'b') {
        const valueMatch = cellXml.match(/<v>([\s\S]*?)<\/v>/);
        cellValue = valueMatch && valueMatch[1] === '1' ? 'TRUE' : 'FALSE';
      } else {
        const valueMatch = cellXml.match(/<v>([\s\S]*?)<\/v>/);
        if (valueMatch) {
          cellValue = decodeXmlEntities(valueMatch[1]);
        } else {
          cellValue = extractTextNodes(cellXml);
        }
      }

      rowValues[columnIndex] = normalizeCellValue(cellValue);
    });

    while (rowValues.length > 0 && rowValues[rowValues.length - 1] === '') {
      rowValues.pop();
    }

    if (rowValues.length > 0) {
      rows.push(rowValues);
    }
  });

  return rows;
};

const parseWorkbookDefinition = (workbookXml = '') => {
  if (!workbookXml) {
    return [];
  }

  const sheetMatches = workbookXml.match(/<sheet\b[^>]*>/g);
  if (!sheetMatches) {
    return [];
  }

  return sheetMatches
    .map((sheetTag) => {
      const nameMatch = sheetTag.match(/name="([^"]+)"/);
      const relationshipMatch = sheetTag.match(/r:id="([^"]+)"/);

      if (!relationshipMatch) {
        return null;
      }

      return {
        name: nameMatch ? nameMatch[1] : null,
        relationshipId: relationshipMatch[1],
      };
    })
    .filter(Boolean);
};

const parseWorkbookRelationships = (relsXml = '') => {
  const relationships = new Map();

  if (!relsXml) {
    return relationships;
  }

  const relMatches = relsXml.match(/<Relationship\b[^>]*>/g);
  if (!relMatches) {
    return relationships;
  }

  relMatches.forEach((relTag) => {
    const idMatch = relTag.match(/Id="([^"]+)"/);
    const targetMatch = relTag.match(/Target="([^"]+)"/);

    if (idMatch && targetMatch) {
      relationships.set(idMatch[1], targetMatch[1]);
    }
  });

  return relationships;
};

const normalizeSheetTarget = (target = '') => {
  if (!target) {
    return null;
  }

  let normalized = target;

  while (normalized.startsWith('../')) {
    normalized = normalized.slice(3);
  }

  normalized = normalized.replace(/^\.\//, '').replace(/^\//, '');

  if (!normalized.startsWith('xl/')) {
    normalized = `xl/${normalized}`;
  }

  return normalized;
};

const loadXlsxSheets = async (file) => {
  const jszipModule = await import('jszip');
  const JSZipClass = jszipModule.default || jszipModule;

  const arrayBuffer = await file.arrayBuffer();
  const zip = await JSZipClass.loadAsync(arrayBuffer);

  const workbookXmlFile = zip.file('xl/workbook.xml');
  if (!workbookXmlFile) {
    throw new Error('Workbook definition is missing.');
  }

  const workbookXml = await workbookXmlFile.async('string');
  const sheetDefinitions = parseWorkbookDefinition(workbookXml);

  if (sheetDefinitions.length === 0) {
    throw new Error('No worksheets were found in the Excel file.');
  }

  const relationshipsXml = await zip.file('xl/_rels/workbook.xml.rels')?.async('string');
  const relationships = parseWorkbookRelationships(relationshipsXml);

  const sharedStringsXml = await zip.file('xl/sharedStrings.xml')?.async('string');
  const sharedStrings = sharedStringsXml ? parseSharedStringsXml(sharedStringsXml) : [];

  const sheets = [];

  for (let index = 0; index < sheetDefinitions.length; index += 1) {
    const definition = sheetDefinitions[index];
    const target = normalizeSheetTarget(
      relationships.get(definition.relationshipId) || `worksheets/sheet${index + 1}.xml`
    );

    if (!target) {
      continue;
    }

    const sheetFile = zip.file(target);
    if (!sheetFile) {
      continue;
    }

    const sheetXml = await sheetFile.async('string');
    const rows = parseSheetXml(sheetXml, sharedStrings);

    sheets.push({
      name: definition.name || `Sheet ${index + 1}`,
      rows,
    });
  }

  return sheets;
};

const convertSheetsToText = (sheets = []) => {
  if (!Array.isArray(sheets) || sheets.length === 0) {
    return '';
  }

  const lines = [];

  sheets.forEach((sheet, index) => {
    const rows = Array.isArray(sheet?.rows) ? sheet.rows : [];
    const formattedRows = rows
      .map((row) => (Array.isArray(row) ? row : []))
      .map((row) => row.map((cell) => normalizeCellValue(cell)))
      .map((row) => row.join(' | '))
      .filter((line) => line.trim().length > 0);

    if (formattedRows.length === 0) {
      return;
    }

    if (lines.length > 0) {
      lines.push('');
    }

    const sheetName = typeof sheet?.name === 'string' && sheet.name.trim().length > 0
      ? sheet.name.trim()
      : `Sheet ${index + 1}`;

    lines.push(`Sheet: ${sheetName}`);
    lines.push(...formattedRows);
  });

  return lines.join('\n').trim();
};

const parseCsvContent = (content = '') => {
  const rows = [];
  let currentRow = [];
  let currentValue = '';
  let inQuotes = false;

  const pushValue = () => {
    currentRow.push(currentValue);
    currentValue = '';
  };

  const finalizeRow = () => {
    pushValue();
    const normalizedRow = currentRow.map((value) => normalizeCellValue(value));
    if (normalizedRow.some((value) => value.length > 0)) {
      rows.push(normalizedRow);
    }
    currentRow = [];
  };

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];

    if (char === '"') {
      if (inQuotes && content[index + 1] === '"') {
        currentValue += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      pushValue();
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      finalizeRow();
      if (char === '\r' && content[index + 1] === '\n') {
        index += 1;
      }
      continue;
    }

    currentValue += char;
  }

  pushValue();
  const normalizedRow = currentRow.map((value) => normalizeCellValue(value));
  if (normalizedRow.some((value) => value.length > 0)) {
    rows.push(normalizedRow);
  }

  return rows;
};

const convertCsvRowsToText = (rows) => {
  if (!Array.isArray(rows) || rows.length === 0) {
    return '';
  }

  return rows
    .map((row) => (Array.isArray(row) ? row : []))
    .map((row) => row.join(' | '))
    .filter((line) => line.trim().length > 0)
    .join('\n')
    .trim();
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

  if (isCsvFile(file)) {
    if (typeof file.text !== 'function' && typeof file.arrayBuffer !== 'function') {
      throw new Error('CSV conversion requires text() or arrayBuffer support on the provided file.');
    }

    try {
      const rawContent = await readFileAsText(file);
      const sanitized = rawContent.replace(/^\uFEFF/, '');
      const rows = parseCsvContent(sanitized);
      const textContent = convertCsvRowsToText(rows);
      const convertedFile = buildPdfFromText(
        textContent,
        file,
        'This spreadsheet was converted from CSV but contained no extractable cells.'
      );

      return {
        file: convertedFile,
        converted: true,
        originalFileName: file.name || null,
        originalMimeType: file.type || CSV_MIME_TYPES[0],
        conversion: 'csv-to-pdf',
      };
    } catch (error) {
      console.error('Failed to convert CSV to PDF:', error);
      throw new Error(`Failed to convert CSV file to PDF: ${error.message}`);
    }
  }

  if (isXlsxFile(file)) {
    if (typeof file.arrayBuffer !== 'function') {
      throw new Error('Excel conversion requires arrayBuffer support on the provided file.');
    }

    try {
      const sheets = await loadXlsxSheets(file);
      const textContent = convertSheetsToText(sheets);
      const convertedFile = buildPdfFromText(
        textContent,
        file,
        'This spreadsheet was converted from Excel but contained no extractable cells.'
      );

      return {
        file: convertedFile,
        converted: true,
        originalFileName: file.name || null,
        originalMimeType: file.type || XLSX_MIME_TYPE,
        conversion: 'xlsx-to-pdf',
      };
    } catch (error) {
      console.error('Failed to convert XLSX to PDF:', error);
      throw new Error(`Failed to convert Excel file to PDF: ${error.message}`);
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
