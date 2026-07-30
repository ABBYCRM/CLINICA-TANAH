/**
 * API client — handles auth, locale, and JSON.
 */
import { getLocale } from '../i18n';

const API_BASE = import.meta.env.VITE_API_BASE || '';

function authHeaders(): HeadersInit {
  const token = localStorage.getItem('auth_token');
  return {
    'Content-Type': 'application/json',
    'Accept-Language': getLocale(),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export class ApiError extends Error {
  status: number;
  body: any;
  constructor(message: string, status: number, body: any) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function request(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers: { ...authHeaders(), ...(init.headers || {}) } });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new ApiError(body?.error || res.statusText, res.status, body);
  }
  return body;
}

export const api = {
  get: (path: string) => request(path),
  post: (path: string, data: any) => request(path, { method: 'POST', body: JSON.stringify(data) }),
  put: (path: string, data: any) => request(path, { method: 'PUT', body: JSON.stringify(data) }),
  del: (path: string) => request(path, { method: 'DELETE' }),
};
