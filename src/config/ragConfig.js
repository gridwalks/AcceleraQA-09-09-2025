export const RAG_BACKENDS = {
  OPENAI: 'openai',
  NEON: 'neon',
};

const backendEnv = (process.env.REACT_APP_RAG_BACKEND || '').toLowerCase();
export const RAG_BACKEND = Object.values(RAG_BACKENDS).includes(backendEnv)
  ? backendEnv
  : RAG_BACKENDS.OPENAI;

const DEFAULT_NEON_FUNCTION = '/.netlify/functions/neon-rag-fixed';
const DEFAULT_NEON_DB_FUNCTION = '/.netlify/functions/neon-db';
const DEFAULT_RAG_DOCS_FUNCTION = '/.netlify/functions/rag-documents';

export const NEON_RAG_FUNCTION = process.env.REACT_APP_NEON_RAG_FUNCTION || DEFAULT_NEON_FUNCTION;
export const NEON_DB_FUNCTION = process.env.REACT_APP_NEON_DB_FUNCTION || DEFAULT_NEON_DB_FUNCTION;
export const RAG_DOCS_FUNCTION = process.env.REACT_APP_RAG_DOCS_FUNCTION || DEFAULT_RAG_DOCS_FUNCTION;

export const isNeonBackend = () => RAG_BACKEND === RAG_BACKENDS.NEON;

export const getRagBackendLabel = () =>
  RAG_BACKEND === RAG_BACKENDS.NEON ? 'Neon PostgreSQL' : 'OpenAI File Search';

export const getRagSearchDescription = () =>
  RAG_BACKEND === RAG_BACKENDS.NEON
    ? 'Search your uploaded documents using PostgreSQL full-text search with ranking.'
    : 'Search your uploaded documents using OpenAI vector search with Assistants API.';
