import { getToken, getTokenInfo } from '../lib/auth-helper.js';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-user-id',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
};

// Check if user has admin role
const hasAdminRole = (user) => {
  if (!user || !user.roles) return false;
  return user.roles.includes('admin') || user.roles.includes('administrator');
};

export const handler = async (event, context) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ message: 'CORS preflight' }),
    };
  }

  try {
    // Get user from token
    const token = await getToken(event);
    if (!token) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Authentication required' }),
      };
    }

    const tokenInfo = getTokenInfo(token);
    if (!hasAdminRole(tokenInfo)) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Admin privileges required' }),
      };
    }

    if (event.httpMethod === 'GET') {
      // Return current model provider configuration
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          currentProvider: 'openai', // Default, will be updated when we add persistence
          availableProviders: ['openai', 'groq'],
          models: {
            openai: 'gpt-4o',
            groq: 'llama-3.3-70b-versatile'
          }
        }),
      };
    }

    if (event.httpMethod === 'POST') {
      // Set model provider
      let requestData;
      try {
        requestData = JSON.parse(event.body || '{}');
      } catch (parseError) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Invalid JSON in request body' }),
        };
      }

      const { provider } = requestData;
      
      if (!provider || !['openai', 'groq'].includes(provider)) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Invalid provider. Must be "openai" or "groq"' }),
        };
      }

      // For now, we'll just return success
      // In a real implementation, you might want to store this in a database
      // or use a configuration service
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: `Model provider set to ${provider}`,
          provider,
          model: provider === 'openai' ? 'gpt-4o' : 'llama-3.3-70b-versatile'
        }),
      };
    }

    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };

  } catch (error) {
    console.error('Set model provider error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Internal server error',
        message: error.message
      }),
    };
  }
};
