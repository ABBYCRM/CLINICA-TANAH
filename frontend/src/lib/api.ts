/**
 * API client — handles auth, locale, tenant override, and JSON.
 */
import { getLocale } from '../i18n';

const API_BASE = import.meta.env.VITE_API_BASE || '';
const TENANT_KEY = 'effective_tenant_id';

export function getTenantOverride(): string | null {
  return localStorage.getItem(TENANT_KEY);
}

export function setTenantOverride(id: string | null): void {
  if (id) localStorage.setItem(TENANT_KEY, id);
  else localStorage.removeItem(TENANT_KEY);
}

function authHeaders(): HeadersInit {
  const token = localStorage.getItem('auth_token');
  const tenant = getTenantOverride();
  return {
    'Content-Type': 'application/json',
    'Accept-Language': getLocale(),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(tenant ? { 'X-Tenant-Id': tenant } : {}),
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
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { error: text || res.statusText }; }
  if (!res.ok) {
    const code = body?.error || res.statusText;
    // Expired / rotated JWT — clear local session so the next navigation hits login
    if (res.status === 401 && (code === 'invalid_token' || code === 'unauthorized') && !path.includes('/auth/login')) {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('auth_user');
      // Keep React auth state in sync — otherwise Equipe/settings keep showing chrome but every call is unauthorized
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('auth:session-expired', { detail: { code } }));
      }
    }
    throw new ApiError(code, res.status, body);
  }
  return body;
}

/** Map API error codes to i18n keys under errors.* */
export function apiErrorKey(err: unknown): string {
  const code = err instanceof ApiError ? (err.body?.error || err.message) : '';
  if (code === 'invalid_token') return 'errors.invalid_token';
  if (code === 'unauthorized') return 'errors.unauthorized';
  if (code === 'forbidden' || code === 'superadmin_required') return 'errors.forbidden';
  if (code === 'not_found') return 'errors.not_found';
  if (code === 'server_error') return 'errors.server_error';
  if (code === 'nvidia_api_key_missing') return 'invoices.ocr_not_configured';
  if (code === 'nvidia_ocr_failed' || code === 'nvidia_rate_limited' || code === 'ocr_unsupported_type') return 'invoices.ocr_failed';
  if (code === 'file_too_large') return 'invoices.file_too_large';
  if (code === 'invalid_cpf') return 'errors.invalid_cpf';
  if (code === 'council_required' || code === 'council_state_required') return 'errors.council_required';
  if (code === 'below_minimum_wage') return 'payroll.below_minimum_wage';
  if (code === 'duplicate_run') return 'payroll.duplicate_run';
  if (code === 'no_employees') return 'payroll.no_employees';
  if (code === 'duplicate_email') return 'errors.duplicate_email';
  if (code === 'duplicate_cpf') return 'errors.duplicate_cpf';
  if (code === 'last_admin') return 'team.last_admin';
  if (code === 'cannot_delete_self') return 'team.cannot_delete_self';
  return 'errors.generic';
}

export const api = {
  get: (path: string) => request(path),
  post: (path: string, data: any) => request(path, { method: 'POST', body: JSON.stringify(data) }),
  put: (path: string, data: any) => request(path, { method: 'PUT', body: JSON.stringify(data) }),
  patch: (path: string, data: any) => request(path, { method: 'PATCH', body: JSON.stringify(data) }),
  del: (path: string) => request(path, { method: 'DELETE' }),
};
