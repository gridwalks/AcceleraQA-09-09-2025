// Application Constants
export const APP_CONFIG = {
  NAME: 'AcceleraQA',
  VERSION: '1.0.0',
  DESCRIPTION: 'AI-powered Quality assistant for pharmaceutical quality and compliance professionals'
};

// OpenAI Configuration
export const OPENAI_CONFIG = {
  MODEL: 'gpt-4o',
  SUGGESTIONS_MODEL: 'gpt-4.1-mini',
  MAX_TOKENS: 1200,
  TEMPERATURE: 0.7,
  SYSTEM_PROMPT: `You are AcceleraQA, an AI assistant for pharmaceutical quality, compliance, and clinical trial integrity.
You analyze regulatory texts, laws, and SOPs with accuracy, practicality, and inspection readiness.
When answering, you must always choose the correct Mode:

Mode 1: Deep Dive (Inspection-Ready Analysis)
Use when the user requests a full assessment.
Structure your output into these sections:
1.Direct Citation
Quote exact text (≤75 words).
Include reference (e.g., 21 CFR Part 11, §11.10(b)).
2.Plain-Language Interpretation
Explain meaning in practice.
Identify obligations for Sponsor, Site, Vendor, CRO.
3.Application to Context
Apply requirement to the scenario provided (e.g., CAPA, audit finding, system change).
4.Compliance Risk & Mitigation
Risk rating: High / Medium / Low.
Provide mitigation strategies (e.g., validation, audit trail review, SOP update).
5.Conclusion
Clear statement of impact (e.g., "Yes, this is regulatory-impacting under 21 CFR Part 11").
Target length: 200–300 words.

Mode 2: Quick Check (Compliance Snapshot)
Use when the user requests a concise answer.
Output format (≤150 words):
Framework / Regulation: [Name + section]
Impact: Yes / No
Why: 1–2 sentences
Mitigation (if any): 1 bullet

Universal Principles
Never fabricate sections or references. If absent, say: "Not addressed in this document."
Always prioritize patient safety, data integrity (ALCOA+), and inspection readiness.
Reference multiple frameworks if overlap exists (e.g., 21 CFR Part 11 + EMA Annex 11).
If context is unclear, ask clarifying questions before proceeding.
Use structured Markdown formatting (bold headings, numbered steps, short concluding synthesis) similar to the OODA loop breakdown style.

How to Use
When making a query, simply start like this:
Deep Dive Example:
AcceleraQA, Deep Dive: Assess whether electronic signatures in a vendor-hosted CTMS require validation under 21 CFR Part 11.
Quick Check Example:
AcceleraQA, Quick Check: Is audit trail review mandatory under EMA Annex 11?
`,
  // General system prompt for non-pharmaceutical questions
  GENERAL_SYSTEM_PROMPT: `You are a helpful AI assistant. Answer questions accurately and helpfully based on your knowledge. Provide clear, informative responses while being honest about limitations when you don't know something.`,
};
// Auth0 Configuration with enhanced validation
export const AUTH0_CONFIG = {
  DOMAIN: process.env.REACT_APP_AUTH0_DOMAIN,
  CLIENT_ID: process.env.REACT_APP_AUTH0_CLIENT_ID,
  AUDIENCE: process.env.REACT_APP_AUTH0_AUDIENCE,
  ROLES_CLAIM: process.env.REACT_APP_AUTH0_ROLES_CLAIM,
  ORG_CLAIM: process.env.REACT_APP_AUTH0_ORG_CLAIM,
  REDIRECT_URI: window.location.origin,
  LOGOUT_URI: window.location.origin,
  SCOPE: 'openid profile email offline_access'
};

// UI Constants
export const UI_CONFIG = {
  MESSAGE_HISTORY_DAYS: 30,
  MAX_DISPLAYED_CONVERSATIONS: 10,
  MAX_RESOURCES_PER_RESPONSE: 6,
  PAGINATION_SIZE: 20
};

// Feature Flags
export const FEATURE_FLAGS = {
  ENABLE_AI_SUGGESTIONS: process.env.REACT_APP_ENABLE_AI_SUGGESTIONS !== 'false'
};

// Enhanced Error Messages with troubleshooting
export const ERROR_MESSAGES = {
  API_KEY_NOT_CONFIGURED: 'OpenAI API key not configured.\n\nTROUBLESHOOTING STEPS:\n1. Check that REACT_APP_OPENAI_API_KEY or OPENAI_API_KEY is set in your environment\n2. If deploying to Netlify, add the variable in Site Settings > Environment Variables\n3. Get your API key from: https://platform.openai.com/account/api-keys\n4. Contact your administrator if you need access',

  INVALID_API_KEY: 'Invalid OpenAI API key.\n\nTROUBLESHOOTING STEPS:\n1. Verify your API key is correct and active\n2. Check your OpenAI account billing status\n3. Generate a new API key if needed: https://platform.openai.com/account/api-keys',

  RATE_LIMIT_EXCEEDED: (tokens) => 'Rate limit exceeded while sending ' + tokens + ' tokens. Please wait a few seconds before trying again.',
  
  QUOTA_EXCEEDED: 'OpenAI API quota exceeded.\n\nTROUBLESHOOTING STEPS:\n1. Check your usage: https://platform.openai.com/account/usage\n2. Review your billing: https://platform.openai.com/account/billing\n3. Upgrade your plan if needed',

  NETWORK_ERROR: 'Network error. Please check your internet connection and try again.',
  GENERIC_ERROR: 'Sorry, I encountered an error. Please try again.',

  AUTH_ERROR: 'Authentication error occurred.\n\nTROUBLESHOOTING STEPS:\n1. Check that all Auth0 environment variables are set correctly\n2. Verify your Auth0 application configuration\n3. Try signing out and signing in again\n4. Contact support if the problem persists',

  STUDY_NOTES_GENERATION_FAILED: 'Failed to generate notes. Please check your API configuration and try again.'
};

// Enhanced environment variable validation with detailed feedback
export const validateEnvironment = () => {
  const requiredVars = [
    'REACT_APP_AUTH0_DOMAIN',
    'REACT_APP_AUTH0_CLIENT_ID',
    'REACT_APP_OPENAI_API_KEY'
  ];
  
  const missing = requiredVars.filter(varName => {
    const value = process.env[varName];
    return !value || value.trim() === '' || value === 'your_value_here';
  });
  
  if (missing.length > 0) {
    console.error('CONFIGURATION ERROR: Missing required environment variables:');
    missing.forEach(varName => {
      console.error('   - ' + varName);
    });

    console.error('\nSETUP INSTRUCTIONS:');
    console.error('1. Copy .env.example to .env');
    console.error('2. Replace placeholder values with real credentials');
    console.error('3. For Netlify: Add variables in Site Settings > Environment Variables');
    console.error('4. Ensure environment variable names are correct');
    console.error('\nHELPFUL LINKS:');
      console.error('OpenAI API Keys: https://platform.openai.com/account/api-keys');
      console.error('Auth0 Dashboard: https://manage.auth0.com/');
      console.error('Netlify Environment Variables: https://docs.netlify.com/configure-builds/environment-variables/');
    
    return false;
  }
  
  // Validate Auth0 domain format
  if (AUTH0_CONFIG.DOMAIN && !AUTH0_CONFIG.DOMAIN.includes('.auth0.com')) {
      console.error('CONFIGURATION ERROR: Invalid Auth0 domain format');
    console.error('   Expected format: your-tenant.auth0.com or your-tenant.us.auth0.com');
    return false;
  }
  
  // Validate OpenAI API key format
  const apiKey = process.env.REACT_APP_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (apiKey && !apiKey.startsWith('sk-')) {
      console.error('CONFIGURATION ERROR: Invalid OpenAI API key format');
    console.error('   Expected format: sk-proj-... or sk-...');
    return false;
  }
  
    console.log('Environment validation passed');
  return true;
};

// Additional validation helper for deployment
export const validateDeploymentEnvironment = () => {
  const issues = [];
  
  // Check if we're in a build environment
  const isBuild = process.env.NODE_ENV === 'production' || process.env.CI;

  if (isBuild) {
    // Additional production checks
    if (!process.env.REACT_APP_OPENAI_API_KEY && !process.env.OPENAI_API_KEY) {
      issues.push('OpenAI API key not set for production build');
    }
    
    if (!process.env.REACT_APP_AUTH0_DOMAIN) {
      issues.push('Auth0 domain not set for production build');
    }
    
    if (!process.env.REACT_APP_AUTH0_CLIENT_ID) {
      issues.push('Auth0 client ID not set for production build');
    }
  }
  
  return {
    isValid: issues.length === 0,
    issues
  };
};

// Default Resources
export const DEFAULT_RESOURCES = [
  { title: "FDA Pharmaceutical Quality Resources Hub", type: "Portal", url: "https://www.fda.gov/drugs/pharmaceutical-quality-resources" },
  { title: "ICH Quality Guidelines Overview", type: "Guideline", url: "https://www.ich.org/page/quality-guidelines" },
  { title: "ISPE Pharmaceutical Engineering Resources", type: "Database", url: "https://www.ispe.org/pharmaceutical-engineering" }
];
