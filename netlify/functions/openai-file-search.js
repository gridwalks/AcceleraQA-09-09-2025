const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, OpenAI-Beta',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
};

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'OPENAI_API_KEY is not set' }),
    };
  }

  const relativePath = event.path.replace(/^\/api\/rag/, '');
  const query = event.rawQuery ? `?${event.rawQuery}` : '';
  const url = `https://api.openai.com/v1${relativePath}${query}`;

  try {
    const body =
      event.body && !['GET', 'HEAD'].includes(event.httpMethod)
        ? event.isBase64Encoded
          ? Buffer.from(event.body, 'base64')
          : event.body
        : undefined;

    const res = await fetch(url, {
      method: event.httpMethod,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': event.headers['content-type'] || 'application/json',
        ...(event.headers['openai-beta'] && { 'OpenAI-Beta': event.headers['openai-beta'] }),
      },
      body,
    });

    const text = await res.text();
    return {
      statusCode: res.status,
      headers: {
        ...corsHeaders,
        'Content-Type': res.headers.get('content-type') || 'application/json',
      },
      body: text,
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
