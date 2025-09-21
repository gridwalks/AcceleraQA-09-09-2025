import React from 'react';
import ReactDOM from 'react-dom';
import { act } from 'react-dom/test-utils';
import Sidebar from './Sidebar';

jest.mock('../config/featureFlags', () => ({
  FEATURE_FLAGS: { ENABLE_AI_SUGGESTIONS: false },
  default: { ENABLE_AI_SUGGESTIONS: false },
}));

jest.mock('../services/learningSuggestionsService', () => ({
  getLearningSuggestions: jest.fn().mockResolvedValue([]),
  refreshSuggestions: jest.fn().mockResolvedValue([]),
}));

jest.mock('../services/ragService', () => ({
  downloadDocument: jest.fn(),
}));

describe('Sidebar resource extraction', () => {
  let container;
  const baseProps = {
    thirtyDayMessages: [],
    user: null,
    learningSuggestions: [],
    isLoadingSuggestions: false,
    onSuggestionsUpdate: () => {},
    onAddResource: () => {},
    onConversationSelect: () => {},
  };

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (container) {
      ReactDOM.unmountComponentAtNode(container);
      document.body.removeChild(container);
      container = null;
    }
  });

  it('places the newest resources at the top when continuing a chat', async () => {
    const initialMessages = [
      {
        id: 'msg-1',
        role: 'assistant',
        resources: [
          { id: 'old-resource', title: 'Legacy Guidance', type: 'Guideline' },
        ],
        timestamp: 1000,
      },
    ];

    await act(async () => {
      ReactDOM.render(
        <Sidebar {...baseProps} messages={initialMessages} />,
        container
      );
    });

    const initialHeadings = Array.from(container.querySelectorAll('h4'));
    expect(initialHeadings[0].textContent).toContain('Legacy Guidance');

    const updatedMessages = [
      ...initialMessages,
      {
        id: 'msg-2',
        role: 'assistant',
        resources: [
          { id: 'new-resource', title: 'Latest CAPA Update', type: 'Training' },
        ],
        timestamp: 2000,
      },
    ];

    await act(async () => {
      ReactDOM.render(
        <Sidebar {...baseProps} messages={updatedMessages} />,
        container
      );
    });

    const updatedHeadings = Array.from(container.querySelectorAll('h4'));
    expect(updatedHeadings[0].textContent).toContain('Latest CAPA Update');
    expect(updatedHeadings[1].textContent).toContain('Legacy Guidance');
  });

  it('prioritizes question-related resources based on relevance scoring', async () => {
    const messages = [
      {
        id: 'msg-legacy',
        role: 'assistant',
        content: 'Historical reference shared earlier.',
        resources: [
          {
            id: 'resource-legacy',
            title: 'Legacy Process Overview',
            type: 'Guideline',
            description: 'Archived manufacturing process guidance.',
          },
        ],
        timestamp: 500,
      },
      {
        id: 'msg-question',
        role: 'user',
        content: 'Can you share the CAPA procedure steps for recent audits?',
        resources: [
          {
            id: 'resource-upload',
            title: 'CAPA Procedure Attachment',
            type: 'User Upload',
            description: 'CAPA procedure steps shared by the user.',
          },
        ],
        timestamp: 1000,
      },
      {
        id: 'msg-answer',
        role: 'assistant',
        content: 'Here is the procedure you requested.',
        resources: [
          {
            id: 'resource-capa',
            title: 'CAPA Process Guide',
            type: 'Guide',
            description: 'Comprehensive CAPA procedure steps for audits.',
          },
        ],
        timestamp: 1500,
      },
      {
        id: 'msg-unrelated',
        role: 'assistant',
        content: 'Unrelated update about finances.',
        resources: [
          {
            id: 'resource-finance',
            title: 'Annual Financial Report',
            type: 'Report',
            description: 'Latest financial performance overview.',
          },
        ],
        timestamp: 2000,
      },
    ];

    await act(async () => {
      ReactDOM.render(
        <Sidebar {...baseProps} messages={messages} />,
        container
      );
    });

    const headings = Array.from(container.querySelectorAll('h4')).map((heading) =>
      heading.textContent.trim()
    );

    expect(headings[0]).toContain('CAPA Procedure Attachment');
    expect(headings[1]).toContain('CAPA Process Guide');
    expect(headings[2]).toContain('Annual Financial Report');
    expect(headings[3]).toContain('Legacy Process Overview');
  });

  it('derives a display title for resources that are missing one', async () => {
    const messages = [
      {
        id: 'msg-3',
        role: 'assistant',
        resources: [
          {
            id: 'resource-without-title',
            type: 'Guideline',
            metadata: { documentTitle: 'Process Validation Playbook' },
          },
        ],
        timestamp: 3000,
      },
    ];

    await act(async () => {
      ReactDOM.render(
        <Sidebar {...baseProps} messages={messages} />,
        container
      );
    });

    const headings = Array.from(container.querySelectorAll('h4'));
    expect(headings[0].textContent).toContain('Process Validation Playbook');
  });
});
