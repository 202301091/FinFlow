import { getOrSetTransferIdempotencyKey, clearTransferIdempotencyKey } from './idempotency';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';

// Token & Auth Storage helpers
export const getToken = () => {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('finflow_token');
};

export const setToken = (token) => {
  if (typeof window === 'undefined') return;
  if (token) {
    localStorage.setItem('finflow_token', token);
  } else {
    localStorage.removeItem('finflow_token');
  }
};

export const removeToken = () => {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('finflow_token');
  localStorage.removeItem('finflow_user');
};

export const getUser = () => {
  if (typeof window === 'undefined') return null;
  const user = localStorage.getItem('finflow_user');
  try {
    return user ? JSON.parse(user) : null;
  } catch {
    return null;
  }
};

export const setUser = (user) => {
  if (typeof window === 'undefined') return;
  if (user) {
    localStorage.setItem('finflow_user', JSON.stringify(user));
    window.dispatchEvent(new CustomEvent('finflow:user-updated', { detail: user }));
    if (typeof user.hasPin === 'boolean') {
      window.dispatchEvent(new CustomEvent('finflow:pin-updated', { detail: { hasPin: user.hasPin } }));
    }
  } else {
    localStorage.removeItem('finflow_user');
    window.dispatchEvent(new CustomEvent('finflow:user-updated', { detail: null }));
  }
};

export const isAuthenticated = () => {
  return !!getToken();
};

/**
 * Core request wrapper
 */
async function request(endpoint, options = {}) {
  const url = `${API_BASE_URL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  const token = getToken();
  if (token && !headers['Authorization']) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Ensure Idempotency-Key header is always attached for transfer endpoints to prevent duplicate charges
  if (endpoint.includes('/transfer') && !headers['Idempotency-Key'] && !headers['idempotency-key']) {
    let bodyObj = null;
    try {
      bodyObj = typeof options.body === 'string' ? JSON.parse(options.body) : options.body;
    } catch {}
    headers['Idempotency-Key'] = getOrSetTransferIdempotencyKey(
      bodyObj?.senderAccountId,
      bodyObj?.receiverAccountId,
      bodyObj?.amount
    );
  }

  const config = {
    ...options,
    headers,
  };

  if (config.body && typeof config.body === 'object' && !(config.body instanceof FormData)) {
    config.body = JSON.stringify(config.body);
  }

  let response;
  try {
    response = await fetch(url, config);
  } catch (err) {
    throw new Error('Network error. Unable to reach FinFlow server.');
  }

  let data = null;
  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    try {
      data = await response.json();
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    const errorMessage = data?.message || data?.errors?.[0] || `Request failed with status ${response.status}`;
    const error = new Error(errorMessage);
    error.statusCode = response.status;
    error.data = data;
    throw error;
  }

  // On transfer success, clear the persistent idempotency key from storage
  if (endpoint.includes('/transfer')) {
    let bodyObj = null;
    try {
      bodyObj = typeof config.body === 'string' ? JSON.parse(config.body) : config.body;
    } catch {}
    clearTransferIdempotencyKey(
      bodyObj?.senderAccountId,
      bodyObj?.receiverAccountId,
      bodyObj?.amount
    );
  }

  return data;
}

// Convenient HTTP methods
export const api = {
  get: (endpoint, options = {}) => request(endpoint, { ...options, method: 'GET' }),
  post: (endpoint, body, options = {}) => request(endpoint, { ...options, method: 'POST', body }),
  put: (endpoint, body, options = {}) => request(endpoint, { ...options, method: 'PUT', body }),
  patch: (endpoint, body, options = {}) => request(endpoint, { ...options, method: 'PATCH', body }),
  delete: (endpoint, options = {}) => request(endpoint, { ...options, method: 'DELETE' }),
};

/**
 * Notification API helpers
 */
export const getNotificationStreamUrl = () => {
  const token = getToken();
  return `${API_BASE_URL}/notifications/stream?token=${encodeURIComponent(token || '')}`;
};

export const getNotifications = async ({ page = 1, limit = 20, unreadOnly = false } = {}) => {
  const query = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    unreadOnly: String(unreadOnly),
  }).toString();
  return api.get(`/notifications?${query}`);
};

export const markNotificationRead = async (notificationId) => {
  return api.patch(`/notifications/${notificationId}/read`);
};

export const markAllNotificationsRead = async () => {
  return api.patch('/notifications/read-all');
};

/**
 * Transaction API helpers (supports scalable keyset cursor pagination)
 */
export const getTransactions = async ({ cursor = null, page = null, limit = 10, accountId = null } = {}) => {
  const params = new URLSearchParams();
  if (cursor) {
    params.set('cursor', cursor);
  } else if (page !== null && page !== undefined) {
    params.set('page', String(page));
  } else {
    // Default to keyset cursor pagination starting from most recent
    params.set('cursor', 'START');
  }

  if (limit) params.set('limit', String(limit));
  if (accountId) params.set('accountId', accountId);

  return api.get(`/transactions?${params.toString()}`);
};

export default api;
