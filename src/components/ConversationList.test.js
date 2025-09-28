import React from 'react';
import ReactDOM from 'react-dom';
import { act } from 'react-dom/test-utils';
import ConversationList from './ConversationList';

describe('ConversationList', () => {
  it('invokes onSelect with conversation id when item clicked', async () => {
    const conversation = {
      id: 'conv1',
      userContent: 'Follow-up question',
      aiContent: 'Follow-up answer',
      timestamp: '2024-01-01T00:05:00.000Z',
      conversationCount: 2,
      threadMessages: [
        {
          id: '1-2',
          userContent: 'Hello',
          aiContent: 'Hi there',
          originalUserMessage: { id: '1', conversationId: 'conv1' },
          originalAiMessage: { id: '2', conversationId: 'conv1' },
        },
        {
          id: '3-4',
          userContent: 'Follow-up question',
          aiContent: 'Follow-up answer',
          originalUserMessage: { id: '3', conversationId: 'conv1' },
          originalAiMessage: { id: '4', conversationId: 'conv1' },
        },
      ],
    };

    const onSelect = jest.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);

    await act(async () => {
      ReactDOM.render(
        <ConversationList conversations={[conversation]} onSelect={onSelect} />,
        container
      );
    });

    const item = container.querySelector('li');
    expect(item.textContent).toContain('Hello');
    expect(item.textContent).toContain('Follow-up answer');

    await act(async () => {
      item.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onSelect).toHaveBeenCalledWith('conv1');

    document.body.removeChild(container);
  });
});
