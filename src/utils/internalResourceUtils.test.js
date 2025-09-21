import {
  createAttachmentResources,
  createKnowledgeBaseResources,
  matchAdminResourcesToContext,
} from './internalResourceUtils';

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

describe('matchAdminResourcesToContext', () => {
  it('filters admin resources that only share a single generic token', () => {
    const adminResources = [
      {
        id: 'admin-1',
        name: 'Compliance Orientation',
        description: 'Overview of our compliance onboarding steps.',
      },
    ];

    const matches = matchAdminResourcesToContext('Tell me about compliance expectations', adminResources);
    expect(matches).toHaveLength(0);
  });

  it('returns admin resources when multiple meaningful tokens overlap', () => {
    const adminResources = [
      {
        id: 'admin-2',
        name: 'Training SOP Checklist',
        description: 'Detailed training SOP checklist for new hires.',
      },
    ];

    const matches = matchAdminResourcesToContext('Need training SOP checklist for onboarding', adminResources);
    expect(matches).toHaveLength(1);
    expect(matches[0].title).toBe('Training SOP Checklist');
  });

  it('retains admin resources when the tag matches the question keyword', () => {
    const adminResources = [
      {
        id: 'admin-3',
        name: 'Operations Guide',
        description: 'Covers day-to-day operations.',
        tag: 'QAOps',
      },
    ];

    const matches = matchAdminResourcesToContext('How does QAOps process work?', adminResources);
    expect(matches).toHaveLength(1);
    expect(matches[0].metadata.adminResourceId).toBe('admin-3');
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
