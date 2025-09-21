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

  it('uses document description from metadata when available', () => {
    const sources = [
      {
        documentId: 'doc-3',
        metadata: {
          documentMetadata: {
            description: 'Defines the quality system requirements for the organization.',
          },
        },
      },
    ];

    const resources = createKnowledgeBaseResources(sources);
    expect(resources).toHaveLength(1);
    expect(resources[0].description).toBe(
      'Defines the quality system requirements for the organization.'
    );
  });

  it('falls back to generic label when no title available', () => {
    const sources = [
      {
        documentId: 'doc-2',
        filename: 'Deviation_Guide.pdf',
      },
    ];

    const resources = createKnowledgeBaseResources(sources);
    expect(resources).toHaveLength(1);
    expect(resources[0].title).toBe('Referenced document 1');
    expect(resources[0].metadata.documentTitle).toBe('Referenced document 1');
    expect(resources[0].description).toBe('Referenced from your uploaded knowledge base.');
  });
});
