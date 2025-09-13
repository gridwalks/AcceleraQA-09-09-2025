// netlify/functions/support-request.js - Create Jira Service Desk request

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-user-id',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Content-Type': 'application/json',
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

  try {
    const { email, message } = JSON.parse(event.body || '{}');

    if (!email || !message) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing email or message' }),
      };
    }

    const jiraAuth = Buffer.from(`${process.env.JIRA_API_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString('base64');

    const jiraResponse = await fetch('https://acceleraqa.atlassian.net/rest/servicedeskapi/request', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${jiraAuth}`,
        'Accept': 'application/json',
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

    // Parse response body safely (Jira may return plain text on errors)
    const text = await jiraResponse.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    if (!jiraResponse.ok) {
      console.error('Jira API error', data);
      return {
        statusCode: jiraResponse.status,
        headers,
        body: JSON.stringify({ error: 'Failed to create support request', details: data }),
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
