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
  } else {
    localStorage.removeItem('finflow_user');
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

  return data;
}

// Convenient HTTP methods
export const api = {
  get: (endpoint, options = {}) => request(endpoint, { ...options, method: 'GET' }),
  post: (endpoint, body, options = {}) => request(endpoint, { ...options, method: 'POST', body }),
  put: (endpoint, body, options = {}) => request(endpoint, { ...options, method: 'PUT', body }),
  delete: (endpoint, options = {}) => request(endpoint, { ...options, method: 'DELETE' }),
};

export default api;
