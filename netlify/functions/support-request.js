// netlify/functions/support-request.js - Create Jira Service Desk request

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-user-id',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Content-Type': 'application/json',
};

const getHeader = (eventHeaders = {}, name) => {
  const lower = name.toLowerCase();
  return (
    eventHeaders[name] ||
    eventHeaders[lower] ||
    eventHeaders[name.toUpperCase()]
  );
};

const requiredEnvVars = [
  'JIRA_API_EMAIL',
  'JIRA_API_TOKEN',
  'JIRA_SERVICE_DESK_ID',
  'JIRA_REQUEST_TYPE_ID',
];

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

  const authHeader = getHeader(event.headers, 'authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({
        error: 'Authentication required',
        details: 'Missing or invalid bearer token',
      }),
    };
  }

  const userId = getHeader(event.headers, 'x-user-id') || getHeader(event.headers, 'x-userid');
  if (!userId || userId === 'anonymous') {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        error: 'User identification required',
        details: 'User ID header is missing',
      }),
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

  const { email, message } = bodyData;

  if (!email || !message) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Missing email or message' }),
    };
  }

  try {
    const jiraAuth = Buffer.from(
      `${process.env.JIRA_API_EMAIL}:${process.env.JIRA_API_TOKEN}`
    ).toString('base64');

    const jiraResponse = await fetch('https://acceleraqa.atlassian.net/rest/servicedeskapi/request', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${jiraAuth}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        serviceDeskId: process.env.JIRA_SERVICE_DESK_ID,
        requestTypeId: process.env.JIRA_REQUEST_TYPE_ID,
        requestFieldValues: {
          summary: `Support request from ${email}`,
          description: message,
        },
        raiseOnBehalfOf: email,
      }),
    });

    const text = await jiraResponse.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    if (!jiraResponse.ok) {
      const detail =
        typeof data === 'string'
          ? data
          : data?.errorMessage || data?.message || JSON.stringify(data);

      console.error('Jira API error', { status: jiraResponse.status, detail });

      return {
        statusCode: jiraResponse.status,
        headers,
        body: JSON.stringify({
          error: 'Failed to create support request',
          details:
            jiraResponse.status === 401
              ? 'Support system authentication failed. Please contact an administrator.'
              : detail,
        }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ message: 'Support request created', key: data.key }),
    };
  } catch (error) {
    console.error('Support request error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error', message: error.message }),
    };
  }
};
