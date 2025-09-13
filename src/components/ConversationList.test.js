import React from 'react';
import ReactDOM from 'react-dom';
import { act } from 'react-dom/test-utils';
import ConversationList from './ConversationList';

describe('ConversationList', () => {
  it('invokes onSelect with conversation id when item clicked', async () => {
    const conversation = {
      id: '1-2',
      userContent: 'Hello',
      aiContent: 'Hi there',
      originalUserMessage: { conversationId: 'conv1' },
      originalAiMessage: { conversationId: 'conv1' }
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
    await act(async () => {
      item.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onSelect).toHaveBeenCalledWith('conv1');

    document.body.removeChild(container);
  });
});
