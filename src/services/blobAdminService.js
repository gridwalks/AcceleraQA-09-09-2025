// src/services/blobAdminService.js - Admin-facing helper for Netlify Blob inventory
import authService from './authService';

const ADMIN_BLOB_FUNCTION =
  process.env.REACT_APP_ADMIN_BLOB_FUNCTION || '/.netlify/functions/admin-blob-list';

const sanitizeQueryParam = (value) => {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim();
};

const buildQueryString = (params = {}) => {
  const entries = Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== '');
  if (entries.length === 0) {
    return '';
  }

  const searchParams = new URLSearchParams();
  entries.forEach(([key, value]) => {
    searchParams.set(key, String(value));
  });
  return `?${searchParams.toString()}`;
};

const normalizeRoles = (roles = []) =>
  Array.isArray(roles)
    ? roles
        .map((role) => (typeof role === 'string' ? role.trim() : ''))
        .filter(Boolean)
    : [];

async function listBlobs({ user, prefix, limit } = {}) {
  const currentUser = user || (await authService.getUser());
  const userId = currentUser?.sub || (await authService.getUserId());

  if (!userId) {
    throw new Error('Administrator authentication is required to list Netlify blobs.');
  }

  let token;
  try {
    token = await authService.getToken();
  } catch (error) {
    throw new Error(`Authentication failed: ${error.message}`);
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'x-user-id': userId,
  };

  const roles = normalizeRoles(currentUser?.roles);
  if (roles.length > 0) {
    headers['x-user-roles'] = roles.join(',');
  }

  if (typeof currentUser?.organization === 'string' && currentUser.organization.trim()) {
    headers['x-user-organization'] = currentUser.organization.trim();
  }

  const numericLimit = Number(limit);
  const queryString = buildQueryString({
    prefix: sanitizeQueryParam(prefix),
    limit: Number.isFinite(numericLimit) && numericLimit > 0 ? Math.floor(numericLimit) : undefined,
  });

  const endpoint = ADMIN_BLOB_FUNCTION;
  let response;
  try {
    response = await fetch(`${endpoint}${queryString}`, {
      method: 'GET',
      headers,
    });
  } catch (error) {
    throw new Error('Unable to reach Netlify blob inventory service.');
  }

  let data;
  try {
    data = await response.json();
  } catch (error) {
    throw new Error('Failed to parse Netlify blob inventory response.');
  }

  if (!response.ok) {
    const message = typeof data?.error === 'string' ? data.error : data?.message;
    throw new Error(message || `Request failed with status ${response.status}`);
  }

  return data;
}

const blobAdminService = {
  listBlobs,
};

export default blobAdminService;
