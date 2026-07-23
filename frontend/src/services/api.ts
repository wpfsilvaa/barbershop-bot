const API_BASE = '/api';

export const getApiUrl = (endpoint: string) => `${API_BASE}${endpoint}`;

export const getAuthToken = () => localStorage.getItem('token');
export const setAuthToken = (token: string | null) => {
  if (token) {
    localStorage.setItem('token', token);
  } else {
    localStorage.removeItem('token');
  }
};

export const apiRequest = async (
  endpoint: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
  body?: any,
  customHeaders: Record<string, string> = {}
) => {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...customHeaders,
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const config: RequestInit = {
    method,
    headers,
  };

  if (body) {
    config.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(`${API_BASE}${endpoint}`, config);

    if (response.status === 401 || response.status === 403) {
      // Clone response to inspect body without consuming it
      const responseClone = response.clone();
      const bodyData = await responseClone.json().catch(() => ({}));
      const isLicenseBlock = bodyData.error && (bodyData.error.includes('expirado') || bodyData.error.includes('revogado'));

      if (!isLicenseBlock) {
        // Auto logout on authentication failure (expired token)
        setAuthToken(null);
        if (!window.location.pathname.includes('/login') && !window.location.pathname.includes('/register-owner')) {
          window.location.href = '/login';
        }
      } else {
        // Force page reload, which will boot AuthProvider and trigger show the block screen via /auth/me
        if (!window.location.pathname.includes('/login') && !window.location.pathname.includes('/register-owner')) {
          window.location.reload();
          // Stop execution to prevent component logic errors
          return new Promise(() => {}); 
        }
      }
    }

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Something went wrong');
    }

    return data;
  } catch (error: any) {
    console.error(`API Request Error [${method} ${endpoint}]:`, error);
    throw error;
  }
};
