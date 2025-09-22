import React, { useState } from 'react';
import { X, Send } from 'lucide-react';

const SupportRequestOverlay = ({ user, onClose }) => {
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    const trimmedMessage = message.trim();
    if (!trimmedMessage || submitting) {
      return;
    }

    setSubmitting(true);

    try {
      const requesterEmail = user?.email || '';
      const requesterName = user?.name || '';

      if (!requesterEmail) {
        throw new Error('A valid email address is required to submit a support request.');
      }

      const response = await fetch('/.netlify/functions/support-request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: requesterEmail,
          name: requesterName,
          message: trimmedMessage,
        }),
      });

      if (response.ok) {
        alert('Support request email sent to AcceleraQA support.');
        setMessage('');
        onClose();
        return;
      }

      let errorDetail = 'An unknown error occurred.';

      try {
        const errorData = await response.json();
        errorDetail =
          errorData?.details ||
          errorData?.error ||
          errorData?.message ||
          errorDetail;
      } catch (parseError) {
        const text = await response.text();
        if (text) {
          errorDetail = text;
        }
      }

      console.error('Support request failed', errorDetail);
      alert(`Failed to send support request: ${errorDetail}`);
    } catch (error) {
      console.error('Support request error:', error);
      const message = error?.message || 'Failed to send support request email';
      alert(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">Support Request</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            aria-label="Close support request"
          >
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>
        <div className="p-6">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Describe your issue..."
            className="w-full h-32 border border-gray-300 rounded-md p-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="mt-4 flex justify-end">
            <button
              onClick={handleSubmit}
              disabled={submitting || !message.trim()}
              className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
              <span>{submitting ? 'Submitting...' : 'Submit'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SupportRequestOverlay;
