// Browser client for the Quire API. Calls go to /api/*, which Next rewrites to the Fastify server.

const API_PREFIX = '/api';
const CSRF_HEADER = 'x-quire-csrf';
const MUTATING = new Set(['POST', 'PATCH', 'DELETE']);
const REQUEST_TIMEOUT_MS = 30_000;
// Routes that create the session, so there's no CSRF token yet.
const SESSIONLESS = new Set(['/auth/signup', '/auth/login']);

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

let csrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

async function ensureCsrf(): Promise<string> {
  if (csrfToken) return csrfToken;
  const me = await send<{ csrfToken: string }>('GET', '/auth/me');
  csrfToken = me.csrfToken;
  return me.csrfToken;
}

async function readError(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as { error?: string; message?: string };
    return new ApiError(response.status, body.error ?? 'error', body.message ?? response.statusText);
  } catch {
    return new ApiError(response.status, 'error', response.statusText || 'Request failed');
  }
}

async function send<T>(method: string, path: string, body?: BodyInit, contentType?: string): Promise<T> {
  const headers: Record<string, string> = {};
  if (contentType) headers['content-type'] = contentType;
  if (MUTATING.has(method) && !SESSIONLESS.has(path)) headers[CSRF_HEADER] = await ensureCsrf();
  const response = await fetch(`${API_PREFIX}${path}`, {
    method,
    headers,
    body,
    credentials: 'same-origin',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw await readError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  get: <T>(path: string) => send<T>('GET', path),
  post: <T>(path: string, body: unknown = {}) => send<T>('POST', path, JSON.stringify(body), 'application/json'),
  patch: <T>(path: string, body: unknown) => send<T>('PATCH', path, JSON.stringify(body), 'application/json'),
  delete: <T>(path: string) => send<T>('DELETE', path),
  upload: <T>(path: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return send<T>('POST', path, form);
  },
};

export const downloadUrl = (path: string): string => `${API_PREFIX}${path}`;

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong';
}
