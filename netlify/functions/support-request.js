// netlify/functions/support-request.js - Send support requests via email

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-user-id',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Content-Type': 'application/json',
};

const SUPPORT_REQUEST_TO_EMAIL =
  process.env.SUPPORT_REQUEST_TO_EMAIL || 'support@acceleraqa.atlassian.net';
const SUPPORT_REQUEST_FROM_EMAIL = process.env.SUPPORT_REQUEST_FROM_EMAIL;
const SUPPORT_REQUEST_FROM_NAME = process.env.SUPPORT_REQUEST_FROM_NAME;

const SENDGRID_API_URL = 'https://api.sendgrid.com/v3/mail/send';

const requiredEnvVars = [
  'SUPPORT_REQUEST_SENDGRID_API_KEY',
  'SUPPORT_REQUEST_FROM_EMAIL',
];

const escapeHtml = (value = '') => {
  const stringValue = value == null ? '' : String(value);
  return stringValue
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

exports.handler = async (event, context) => {
  console.log('Support request function called', { method: event.httpMethod });

  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ message: 'CORS preflight successful' }),
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  const missingEnv = requiredEnvVars.filter((key) => !process.env[key]);
  if (missingEnv.length > 0) {
    console.error('Support request configuration error', { missingEnv });
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Support request configuration error',
        details: `Missing environment variables: ${missingEnv.join(', ')}`,
      }),
    };
  }

  let bodyData;
  try {
    bodyData = JSON.parse(event.body || '{}');
  } catch (parseError) {
    console.error('Invalid JSON payload', parseError);
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Invalid JSON in request body' }),
    };
  }

  const { email, message, name } = bodyData;

  if (!email || typeof email !== 'string' || !message || typeof message !== 'string') {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Missing email or message' }),
    };
  }

  const normalizedEmail = email.trim();
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!emailPattern.test(normalizedEmail)) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Invalid email address' }),
    };
  }

  try {
    const trimmedMessage = message.trim();
    if (!trimmedMessage) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Message cannot be empty' }),
      };
    }

    const safeName = typeof name === 'string' ? name.trim() : '';
    const requesterLabel = safeName
      ? `${safeName} <${normalizedEmail}>`
      : normalizedEmail;

    const plainText = `Support request from ${requesterLabel}\n\n${trimmedMessage}`;
    const htmlBody = `
      <p><strong>From:</strong> ${escapeHtml(requesterLabel)}</p>
      <p><strong>Email:</strong> ${escapeHtml(normalizedEmail)}</p>
      <hr />
      <p>${escapeHtml(trimmedMessage).replace(/\n/g, '<br />')}</p>
    `;
    const subject = `Support request from ${safeName || normalizedEmail}`;

    const sender = SUPPORT_REQUEST_FROM_NAME
      ? { email: SUPPORT_REQUEST_FROM_EMAIL, name: SUPPORT_REQUEST_FROM_NAME }
      : { email: SUPPORT_REQUEST_FROM_EMAIL };
    const replyTo = safeName

      ? { email: normalizedEmail, name: safeName }
      : { email: normalizedEmail };

    const sendgridResponse = await fetch(SENDGRID_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.SUPPORT_REQUEST_SENDGRID_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [
          {
            to: [{ email: SUPPORT_REQUEST_TO_EMAIL }],
          },
        ],
        from: sender,
        reply_to: replyTo,
        subject,
        content: [
          { type: 'text/plain', value: plainText },
          { type: 'text/html', value: htmlBody },
        ],
      }),
    });
    
    if (!sendgridResponse.ok) {
      const errorText = await sendgridResponse.text();
      let parsedDetail = errorText;

    if (!sendgridResponse.ok) {
      const errorText = await sendgridResponse.text();
      let parsedDetail = errorText;

      try {
        const parsed = JSON.parse(errorText);
        const messages =
          parsed?.errors?.map((err) => err?.message).filter(Boolean) || [];
        if (messages.length > 0) {
          parsedDetail = messages.join('; ');
        } else if (parsed?.message) {
          parsedDetail = parsed.message;
        }
      } catch (parseError) {
        // ignore JSON parse errors, we'll use the raw text instead
      }

      console.error('SendGrid API error', {
        status: sendgridResponse.status,
        body: errorText,
      });

      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({
          error: 'Failed to send support email',
          details: parsedDetail || 'Unexpected response from email provider',
        }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ message: 'Support request email sent' }),
    };
  } catch (error) {
    console.error('Support request error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Internal server error',
        message: 'Failed to send support email',
        details: error.message,
      }),
    };
  }
};
