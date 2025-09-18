import { createAttachmentResources, createKnowledgeBaseResources } from './internalResourceUtils';

describe('createAttachmentResources', () => {
  it('prefers attachment metadata title when available', () => {
    const attachments = [
      {
        finalFileName: 'Quality_Event_SOP.pdf',
        originalFileName: 'Quality_Event_SOP.pdf',
        metadata: { title: 'Quality Event SOP' },
        converted: false,
      },
    ];

    const resources = createAttachmentResources(attachments);
    expect(resources).toHaveLength(1);
    expect(resources[0].title).toBe('Quality Event SOP');
    expect(resources[0].metadata.documentTitle).toBe('Quality Event SOP');
  });
});

describe('createKnowledgeBaseResources', () => {
  it('uses metadata title when present', () => {
    const sources = [
      {
        documentId: 'doc-1',
        filename: 'Quality_Event_SOP.pdf',
        metadata: { title: 'Quality Event SOP' },
        text: 'Quality event handling overview.',
      },
    ];

    const resources = createKnowledgeBaseResources(sources);
    expect(resources).toHaveLength(1);
    expect(resources[0].title).toBe('Quality Event SOP');
    expect(resources[0].metadata.documentTitle).toBe('Quality Event SOP');
  });

  it('falls back to filename when no title available', () => {
    const sources = [
      {
        documentId: 'doc-2',
        filename: 'Deviation_Guide.pdf',
        text: 'Deviation handling guidance.',
      },
    ];

    const resources = createKnowledgeBaseResources(sources);
    expect(resources).toHaveLength(1);
    expect(resources[0].title).toBe('Deviation_Guide.pdf');
    expect(resources[0].metadata.documentTitle).toBe('Deviation_Guide.pdf');
  });
});
