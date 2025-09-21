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

  it('prioritizes resources relevant to the latest user question', async () => {
    const messages = [
      {
        id: 'intro-assistant',
        role: 'assistant',
        resources: [
          {
            id: 'quality-manual',
            title: 'General Quality Manual',
            type: 'Guideline',
            description: 'High level company quality overview.',
          },
          {
            id: 'capa-checklist',
            title: 'CAPA Readiness Checklist',
            type: 'Guideline',
            description: 'Checklist used before closing CAPA evidence.',
          },
        ],
        timestamp: 1000,
      },
      {
        id: 'user-question',
        role: 'user',
        content: 'How do we handle CAPA evidence retention requirements?',
        resources: [
          {
            id: 'question-upload',
            title: 'CAPA Evidence Template',
            type: 'User Upload',
          },
        ],
        timestamp: 2000,
      },
      {
        id: 'assistant-answer',
        role: 'assistant',
        resources: [
          {
            id: 'answer-resource',
            title: 'CAPA Evidence SOP',
            description: 'Step-by-step CAPA evidence retention process.',
            type: 'Knowledge Base',
          },
        ],
        timestamp: 3000,
      },
      {
        id: 'assistant-newer',
        role: 'assistant',
        resources: [
          {
            id: 'new-unrelated',
            title: 'General Onboarding Guide',
            description: 'Orientation material for new hires.',
            type: 'Training',
          },
        ],
        timestamp: 4000,
      },
    ];

    await act(async () => {
      ReactDOM.render(
        <Sidebar {...baseProps} messages={messages} />,
        container
      );
    });

    const headings = Array.from(container.querySelectorAll('h4'));
    expect(headings[0].textContent).toContain('CAPA Evidence Template');
    expect(headings[1].textContent).toContain('CAPA Evidence SOP');
    expect(headings[2].textContent).toContain('General Onboarding Guide');
    expect(headings[3].textContent).toContain('CAPA Readiness Checklist');
    expect(headings[4].textContent).toContain('General Quality Manual');
  });


  it('falls back to recency when no user question is present', async () => {
    const messages = [
      {
        id: 'assistant-first',
        role: 'assistant',
        resources: [
          { id: 'older-resource', title: 'Legacy Guidance', type: 'Guideline' },
        ],
        timestamp: 1000,
      },
      {
        id: 'assistant-second',
        role: 'assistant',
        resources: [
          { id: 'newer-resource', title: 'Latest CAPA Update', type: 'Training' },
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

    const headings = Array.from(container.querySelectorAll('h4'));
    expect(headings[0].textContent).toContain('Latest CAPA Update');
    expect(headings[1].textContent).toContain('Legacy Guidance');
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
