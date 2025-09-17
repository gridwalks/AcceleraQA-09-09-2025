import { TextEncoder, TextDecoder } from 'util';
import { convertFileToPdfIfNeeded } from './fileConversion';

global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

const createPdfFile = () => ({
  name: 'example.pdf',
  type: 'application/pdf',
  lastModified: Date.now(),
});

const createTextFile = (name, type, content) => ({
  name,
  type,
  lastModified: Date.now(),
  text: async () => content,
});

const createXlsxTestFile = async () => {
  const { default: JSZip } = await import('jszip');

  const zip = new JSZip();

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>`;

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId0" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Data" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;

  const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>`;

  const sharedStringsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="3" uniqueCount="3">
  <si><t>Name</t></si>
  <si><t>Value</t></si>
  <si><t>Metric</t></si>
</sst>`;

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="s"><v>0</v></c>
      <c r="B1" t="s"><v>1</v></c>
    </row>
    <row r="2">
      <c r="A2" t="s"><v>2</v></c>
      <c r="B2"><v>42</v></c>
    </row>
  </sheetData>
</worksheet>`;

  zip.file('[Content_Types].xml', contentTypesXml);
  zip.folder('_rels').file('.rels', rootRelsXml);

  const xlFolder = zip.folder('xl');
  xlFolder.file('workbook.xml', workbookXml);
  xlFolder.folder('_rels').file('workbook.xml.rels', workbookRelsXml);
  xlFolder.file('sharedStrings.xml', sharedStringsXml);
  xlFolder.folder('worksheets').file('sheet1.xml', sheetXml);

  const arrayBuffer = await zip.generateAsync({ type: 'arraybuffer' });

  return {
    name: 'metrics.xlsx',
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    lastModified: Date.now(),
    arrayBuffer: async () => arrayBuffer.slice(0),
  };
};

describe('convertFileToPdfIfNeeded', () => {
  it('returns the original PDF without conversion', async () => {
    const pdfFile = createPdfFile();

    const result = await convertFileToPdfIfNeeded(pdfFile);

    expect(result.converted).toBe(false);
    expect(result.file).toBe(pdfFile);
    expect(result.originalFileName).toBe('example.pdf');
    expect(result.originalMimeType).toBe('application/pdf');
  });

  it('converts plain text files to PDF', async () => {
    const textFile = createTextFile('guidance.txt', 'text/plain', 'Quality guidance improves compliance.');

    const result = await convertFileToPdfIfNeeded(textFile);

    expect(result.converted).toBe(true);
    expect(result.conversion).toBe('text-to-pdf');
    expect(result.file.type).toBe('application/pdf');
    expect(result.file.name).toBe('guidance.pdf');
    expect(result.originalFileName).toBe('guidance.txt');
    expect(result.originalMimeType).toBe('text/plain');
    expect(typeof result.file.arrayBuffer).toBe('function');

    const buffer = await result.file.arrayBuffer();
    expect(buffer.byteLength).toBeGreaterThan(0);
  });

  it('converts markdown files to PDF', async () => {
    const markdownFile = createTextFile('notes.md', 'text/markdown', '# Heading\n\n* bullet item\n');

    const result = await convertFileToPdfIfNeeded(markdownFile);

    expect(result.converted).toBe(true);
    expect(result.conversion).toBe('markdown-to-pdf');
    expect(result.file.type).toBe('application/pdf');
    expect(result.file.name).toBe('notes.pdf');
  });

  it('converts CSV files to PDF', async () => {
    const csvFile = createTextFile('report.csv', 'text/csv', 'Name,Value\nAlpha,10\nBeta,20');

    const result = await convertFileToPdfIfNeeded(csvFile);

    expect(result.converted).toBe(true);
    expect(result.conversion).toBe('csv-to-pdf');
    expect(result.file.type).toBe('application/pdf');
    expect(result.file.name).toBe('report.pdf');
    expect(result.originalFileName).toBe('report.csv');
    expect(result.originalMimeType).toBe('text/csv');

    const buffer = await result.file.arrayBuffer();
    expect(buffer.byteLength).toBeGreaterThan(0);
  });

  it('converts XLSX files to PDF', async () => {
    const xlsxFile = await createXlsxTestFile();

    const result = await convertFileToPdfIfNeeded(xlsxFile);

    expect(result.converted).toBe(true);
    expect(result.conversion).toBe('xlsx-to-pdf');
    expect(result.file.type).toBe('application/pdf');
    expect(result.file.name).toBe('metrics.pdf');
    expect(result.originalFileName).toBe('metrics.xlsx');
    expect(result.originalMimeType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

    const buffer = await result.file.arrayBuffer();
    expect(buffer.byteLength).toBeGreaterThan(0);
  });
});
