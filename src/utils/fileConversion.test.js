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
});
