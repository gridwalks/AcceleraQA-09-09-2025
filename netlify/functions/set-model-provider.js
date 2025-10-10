const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-user-id',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
};

// Extract user ID from request
const extractUserId = (event, context) => {
  // Method 1: Direct x-user-id header (most reliable)
  if (event.headers['x-user-id']) {
    return event.headers['x-user-id'];
  }
  
  // Method 2: Case variations
  if (event.headers['X-User-ID']) {
    return event.headers['X-User-ID'];
  }
  
  // Method 3: Extract from Authorization Bearer token
  if (event.headers.authorization) {
    try {
      const authHeader = event.headers.authorization;
      if (authHeader.startsWith('Bearer ')) {
        const token = authHeader.replace('Bearer ', '');
        const parts = token.split('.');
        
        if (parts.length === 3) {
          // Standard JWT
          let payload = parts[1];
          while (payload.length % 4) {
            payload += '=';
          }
          const decoded = Buffer.from(payload, 'base64').toString('utf8');
          const parsed = JSON.parse(decoded);
          if (parsed.sub) {
            return parsed.sub;
          }
        }
      }
    } catch (error) {
      console.warn('Failed to extract user ID from JWT:', error.message);
    }
  }
  
  // Method 4: Netlify context
  if (context.clientContext?.user?.sub) {
    return context.clientContext.user.sub;
  }
  
  // Method 5: Development fallback
  if (process.env.NODE_ENV === 'development' || process.env.NETLIFY_DEV === 'true') {
    return 'dev-user-' + Date.now();
  }
  
  return null;
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
    // Extract user ID
    const userId = extractUserId(event, context);
    if (!userId) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'User authentication required' }),
      };
    }

    // For now, we'll allow any authenticated user to change model provider
    // In a production environment, you might want to check admin roles
    // by looking up the user in a database or checking JWT claims
    console.log('Model provider change requested by user:', userId);

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
