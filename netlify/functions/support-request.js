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

const requiredEnvVars = ['SUPPORT_REQUEST_SENDGRID_API_KEY'];
const parseSendGridError = async (response) => {
  const rawBody = await response.text();
  let detail = rawBody?.trim() || '';
  let parsedErrors = [];

  if (rawBody) {
    try {
      const parsed = JSON.parse(rawBody);
      if (parsed) {
        parsedErrors = Array.isArray(parsed.errors) ? parsed.errors : [];
        const errorMessages = parsedErrors
          .map((error) => (typeof error?.message === 'string' ? error.message.trim() : ''))
          .filter(Boolean);

        if (!detail && errorMessages.length > 0) {
          detail = errorMessages.join('; ');
        }

        if (!detail && typeof parsed.message === 'string') {
          detail = parsed.message.trim();
        }
      }
    } catch (parseError) {
      // Ignore JSON parse errors, we will fall back to the raw response body
    }
  }

  if (!detail && response.statusText) {
    detail = response.statusText;
  }

  return { detail, parsedErrors, rawBody };
};

const sendEmailWithSender = async ({
  sender,
  replyTo,
  subject,
  plainText,
  htmlBody,
}) => {
  const payload = {
    personalizations: [
      {
        to: [{ email: SUPPORT_REQUEST_TO_EMAIL }],
      },
    ],
    from: sender,
    subject,
    content: [
      { type: 'text/plain', value: plainText },
      { type: 'text/html', value: htmlBody },
    ],
  };

  if (replyTo) {
    payload.reply_to = replyTo;
  }

  const response = await fetch(SENDGRID_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.SUPPORT_REQUEST_SENDGRID_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (response.ok) {
    return { ok: true, status: response.status };
  }

  const { detail, parsedErrors, rawBody } = await parseSendGridError(response);

  return {
    ok: false,
    status: response.status,
    statusText: response.statusText,
    detail,
    parsedErrors,
    rawBody,
  };
};

const shouldRetryWithVerifiedSender = (result) => {
  if (!result) {
    return false;
  }

  if (result.status === 401 || result.status === 403) {
    return true;
  }

  const normalizedDetail = typeof result.detail === 'string' ? result.detail.toLowerCase() : '';

  if (normalizedDetail.includes('verified sender') || normalizedDetail.includes('sender identity')) {
    return true;
  }

  if (Array.isArray(result.parsedErrors) && result.parsedErrors.length > 0) {
    return result.parsedErrors.some((error) => {
      if (!error || typeof error !== 'object') {
        return false;
      }

      const field = typeof error.field === 'string' ? error.field.toLowerCase() : '';
      const message = typeof error.message === 'string' ? error.message.toLowerCase() : '';

      return field === 'from' || message.includes('verified sender') || message.includes('sender identity');
    });
  }

  return false;
};

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

    const hasVerifiedSender = Boolean(SUPPORT_REQUEST_FROM_EMAIL);
    const requesterSender = safeName
      ? { email: normalizedEmail, name: safeName }
      : { email: normalizedEmail };
    const verifiedSender = hasVerifiedSender
      ? SUPPORT_REQUEST_FROM_NAME
        ? { email: SUPPORT_REQUEST_FROM_EMAIL, name: SUPPORT_REQUEST_FROM_NAME }
        : { email: SUPPORT_REQUEST_FROM_EMAIL }
      : null;
    const requesterReplyTo = safeName
      ? { email: normalizedEmail, name: safeName }
      : { email: normalizedEmail };

    const firstAttempt = await sendEmailWithSender({
      sender: requesterSender,
      subject,
      plainText,
      htmlBody,
    });

    if (firstAttempt.ok) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ message: 'Support request email sent' }),

      };
    }

    let finalResult = firstAttempt;
    let usedFallbackSender = false;

    if (verifiedSender && shouldRetryWithVerifiedSender(firstAttempt)) {
      console.warn('Retrying support email with verified sender due to SendGrid rejection', {
        status: firstAttempt.status,
        detail: firstAttempt.detail,
      });

      const fallbackAttempt = await sendEmailWithSender({
        sender: verifiedSender,
        replyTo: requesterReplyTo,
        subject,
        plainText,
        htmlBody,
      });

      if (fallbackAttempt.ok) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            message: 'Support request email sent',
            usedVerifiedSenderFallback: true,
          }),
        };
      }

      usedFallbackSender = true;
      finalResult = fallbackAttempt;
    }

    const detailMessage =
      finalResult.detail?.trim() ||
      finalResult.statusText ||
      `Email provider error (status ${finalResult.status})`;

    console.error('SendGrid API error', {
      status: finalResult.status,
      detail: finalResult.detail,
      statusText: finalResult.statusText,
      rawBody: finalResult.rawBody,
      attemptedFallback: usedFallbackSender,
    });

    const statusForClient =
      finalResult.status >= 400 && finalResult.status < 500
        ? finalResult.status
        : 500;

    return {
      statusCode: statusForClient,
      headers,
      body: JSON.stringify({
        error: 'Failed to send support email',
        details: detailMessage,
        providerStatus: finalResult.status,
        providerStatusText: finalResult.statusText,
        usedVerifiedSenderFallback: usedFallbackSender && verifiedSender ? true : undefined,
      }),
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
