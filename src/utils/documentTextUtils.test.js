import { decodeDocumentContent } from './documentTextUtils';

describe('decodeDocumentContent', () => {
  it('decodes UTF-8 text payloads without warnings', () => {
    const payload = {
      content: Buffer.from('Quality system overview').toString('base64'),
      contentType: 'text/plain',
    };

    const result = decodeDocumentContent(payload);
    expect(result.text).toBe('Quality system overview');
    expect(result.warnings).toEqual([]);
  });

  it('sanitizes binary payloads and surfaces a lossy warning', () => {
    const binarySample = '\u0000PDF-1.4 Sample Content\u0000';
    const payload = {
      content: Buffer.from(binarySample, 'utf8').toString('base64'),
      contentType: 'application/pdf',
    };

    const result = decodeDocumentContent(payload);
    expect(result.text).toContain('PDF-1.4');
    expect(result.warnings[0]).toMatch(/lossy/i);
  });

  it('throws when payload is missing content', () => {
    expect(() => decodeDocumentContent({ contentType: 'text/plain' })).toThrow(
      'Document download payload is missing base64 content'
    );
  });
});
