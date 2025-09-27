# AcceleraQA - Fixed and Production Ready

AI-powered assistant for pharmaceutical quality and compliance professionals.

## 🔧 Critical Fixes Applied

### Authentication
- ✅ Fixed Auth0 SDK usage (removed React wrapper conflict)
- ✅ Centralized authentication service with proper error handling
- ✅ Secure token management without client-side storage
- ✅ Environment variable validation

### Code Quality
- ✅ Added TypeScript-style prop validation and error boundaries
- ✅ Memoized components to prevent unnecessary re-renders
- ✅ Extracted utility functions to reduce code duplication
- ✅ Proper error handling throughout the application
- ✅ Added loading states and accessibility improvements

### Performance
- ✅ Optimized message processing with useMemo
- ✅ Implemented lazy loading patterns
- ✅ Reduced bundle size with proper imports
- ✅ Added caching for expensive computations

### Security
- ✅ Fixed CSP headers in netlify.toml
- ✅ Removed unsafe-inline where possible
- ✅ Proper CORS configuration
- ✅ Secure environment variable handling

## 📁 Fixed Project Structure

```
src/
├── App.js                          # Main application with proper error handling
├── index.js                        # Simplified entry point
├── index.css                       # Global styles
│
├── components/                     # UI Components
│   ├── AuthScreen.js              # Enhanced login screen
│   ├── ChatArea.js                # Improved chat interface
│   ├── ErrorBoundary.js           # Error boundary component
│   ├── Header.js                  # Fixed header with proper Auth0 integration
│   ├── LoadingScreen.js           # Enhanced loading state
│   ├── NotebookView.js            # Optimized conversation history
│   ├── ResourcesView.js           # Enhanced resource display
│   └── Sidebar.js                 # Container component
│
├── services/                      # Business Logic
│   ├── authService.js             # Fixed Auth0 integration
│   └── openaiService.js           # Improved OpenAI API handling
│
├── utils/                         # Utility Functions
│   ├── exportUtils.js             # Enhanced export functionality
│   ├── messageUtils.js            # Message processing utilities
│   └── resourceGenerator.js       # Smart resource matching
│
└── config/                        # Configuration
    └── constants.js               # Application constants and validation
```

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Environment Setup
```bash
cp .env.example .env
# Edit .env with your actual values
```

### 3. Required Environment Variables
```bash
# OpenAI (Required)
OPENAI_API_KEY=your_openai_api_key      # For serverless functions
REACT_APP_OPENAI_API_KEY=your_openai_api_key # For client-side features

# Auth0 (Required)
REACT_APP_AUTH0_DOMAIN=your-domain.auth0.com
REACT_APP_AUTH0_CLIENT_ID=your_client_id

# Auth0 (Optional)
REACT_APP_AUTH0_AUDIENCE=your_api_audience
REACT_APP_AUTH0_ROLES_CLAIM=https://your-domain.com/roles
REACT_APP_AUTH0_ORG_CLAIM=https://your-domain.com/org

# Neon PostgreSQL (Document Metadata Persistence)
NEON_DATABASE_URL=postgres://user:password@host:port/dbname
REACT_APP_RAG_DOCS_FUNCTION=/.netlify/functions/rag-documents # optional override

# Support Requests (Email via SendGrid)
SUPPORT_REQUEST_SENDGRID_API_KEY=your_sendgrid_api_key
SUPPORT_REQUEST_FROM_EMAIL=verified_sender@example.com # optional verified sender override
SUPPORT_REQUEST_FROM_NAME="AcceleraQA Support" # optional display name when using a verified sender
SUPPORT_REQUEST_TO_EMAIL=support@acceleraqa.atlassian.net # optional override

# Feature Flags (Optional)
REACT_APP_ENABLE_AI_SUGGESTIONS=true # set to 'false' to disable AI suggestions
```

### 4. Auth0 Configuration

#### Create Auth0 Application:
1. Go to [Auth0 Dashboard](https://manage.auth0.com/)
2. Create new Single Page Application
3. Configure settings:

```
Allowed Callback URLs:
http://localhost:3000, https://your-app.netlify.app

Allowed Logout URLs:  
http://localhost:3000, https://your-app.netlify.app

Allowed Web Origins:
http://localhost:3000, https://your-app.netlify.app
```

**Note:** `REACT_APP_AUTH0_ROLES_CLAIM` and `REACT_APP_AUTH0_ORG_CLAIM` must match the custom claims added by your Auth0 Action/Rule.

### 5. Development
```bash
npm start
```

### 6. Production Build
```bash
npm run build
```

## 🔒 Security Features

- **Auth0 Integration**: Enterprise-grade authentication
- **CSP Headers**: Content Security Policy protection
- **Environment Validation**: Required variables checked at startup
- **Error Boundaries**: Graceful error handling
- **Input Sanitization**: XSS protection
- **Secure Redirects**: Proper SPA routing

## 📊 Performance Optimizations

- **React.memo**: Prevent unnecessary re-renders
- **useMemo**: Cache expensive calculations
- **Lazy Loading**: Components loaded on demand
- **Tree Shaking**: Optimized bundle size
- **Service Workers**: Built-in with Create React App

## 🧭 Architecture References

- [AcceleraQA Summary-Generation Pipeline Architecture](docs/summary-generation-pipeline.md): end-to-end design for the role-aware, citation-backed summarization service that powers Ask Summarize, focus lenses, and downstream integrations.
- [Front-end integration for the summary pipeline](docs/summary-pipeline-frontend.md): explains how the React client invokes the Netlify function, decodes document content, and renders summaries with guardrail diagnostics.

### Document Retrieval Flow

- **Download Source**: All document downloads are issued through `ragService.downloadDocument`, which posts to the Netlify function configured by `REACT_APP_RAG_DOCS_FUNCTION` (defaults to `/.netlify/functions/rag-documents`). The request includes the authenticated user's bearer token and user ID so the function can authorize access before streaming the file back to the browser.
- **Viewer Handling**: `ResourcesView` consumes the response metadata, creates an object URL for the returned blob, and injects the URL into the in-app document viewer. If a direct download link is provided in the metadata, the component exposes it as a fallback download option.

## 🧪 Key Features

### Authentication
- Auth0 Single Sign-On
- Secure token management
- Automatic session handling
- Logout with cleanup

### AI Integration
- OpenAI GPT-4 integration
- Pharmaceutical-specific prompts
- Document ingestion and retrieval via Netlify functions backed by Neon PostgreSQL full-text search
- Secure document metadata persistence in Neon for cross-device access
- Error handling and rate limiting
- Usage tracking

### Learning Resources
- Smart resource generation
- Topic-based recommendations
- Search and filtering
- External link handling

### Study Management
- Conversation history (30 days)
- Study note generation
- Export to Word/CSV
- Bulk selection tools

## 🌍 Deployment

### Netlify (Recommended)
1. Connect your repository
2. Set environment variables in Netlify dashboard
   - `OPENAI_API_KEY` for serverless calls to OpenAI
   - `REACT_APP_OPENAI_API_KEY` for client-side features
   - `NEON_DATABASE_URL` for the Neon PostgreSQL document store
   - `REACT_APP_RAG_BACKEND=neon` if you need to override the default locally
3. Deploy with automatic builds. Netlify will execute the Neon-backed RAG functions to serve document search and storage.

### Environment Variables in Netlify:
```bash
REACT_APP_AUTH0_DOMAIN=your-domain.auth0.com
REACT_APP_AUTH0_CLIENT_ID=your_client_id
OPENAI_API_KEY=your_openai_key
REACT_APP_OPENAI_API_KEY=your_openai_key
REACT_APP_ENABLE_AI_SUGGESTIONS=true # optional: set to 'false' to disable AI suggestions
JIRA_API_EMAIL=your_atlassian_email
JIRA_API_TOKEN=your_atlassian_api_token
JIRA_SERVICE_DESK_ID=your_service_desk_id
JIRA_REQUEST_TYPE_ID=your_request_type_id
```
> **Note:** The RAG workflow now uses the Neon-backed Netlify functions (`neon-rag-fixed`, `neon-db`, and `rag-documents`) instead of the OpenAI File Assistant. Ensure your Neon connection string has permission to create the required tables on first run.
## 🔍 Troubleshooting

### Common Issues

**1. Auth0 Login Loop**
- Check callback URLs match exactly
- Verify environment variables
- Clear browser cache

**2. OpenAI API Errors**
- Verify API key is valid
- Check billing/usage limits
- Confirm model availability

**3. Build Failures**
- Ensure all environment variables are set
- Check for missing dependencies
- Verify Node.js version (16+)

**4. Deployment Issues**
- Check netlify.toml configuration
- Verify environment variables in dashboard
- Review build logs

### Debug Mode
Set `NODE_ENV=development` to see detailed error information.

## 📈 Analytics & Monitoring

The application includes:
- Error boundary logging
- Performance monitoring hooks
- Auth0 analytics integration
- OpenAI usage tracking

## 🤝 Contributing

1. Fork the repository
2. Create feature branch
3. Make changes with tests
4. Submit pull request

## 📝 License

MIT License - see LICENSE file for details

## 🆘 Support

- Documentation: Check this README
- Auth0 Issues: [Auth0 Community](https://community.auth0.com/)
- OpenAI Issues: [OpenAI Help](https://help.openai.com/)
- App Issues: Create GitHub issue

---

**All critical issues from the code review have been addressed. The application is now production-ready with proper authentication, error handling, and security measures.**
