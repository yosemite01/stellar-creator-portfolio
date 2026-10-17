import { NextRequest, NextResponse } from 'next/server';

export interface CreateRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url?: string;
  body?: unknown;
  headers?: Record<string, string>;
  searchParams?: Record<string, string>;
}

export function createApiRequest({
  method = 'GET',
  url = 'http://localhost:3000/api/test',
  body,
  headers = {},
  searchParams,
}: CreateRequestOptions = {}): NextRequest {
  const reqUrl = new URL(url);
  if (searchParams) {
    for (const [k, v] of Object.entries(searchParams)) {
      reqUrl.searchParams.set(k, v);
    }
  }

  const reqHeaders = new Headers();
  reqHeaders.set('Content-Type', 'application/json');
  for (const [k, v] of Object.entries(headers)) {
    reqHeaders.set(k, v);
  }

  const init: RequestInit = {
    method,
    headers: reqHeaders,
  };

  if (body !== undefined && method !== 'GET') {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }

  return new NextRequest(reqUrl.toString(), init);
}

export interface MockUser {
  id?: string;
  name?: string;
  email?: string;
  role?: 'USER' | 'CREATOR' | 'CLIENT' | 'ADMIN';
  [key: string]: unknown;
}

export function createMockSession(overrides: MockUser = {}) {
  return {
    user: {
      id: overrides.id || 'mock-user-id',
      name: overrides.name || 'Mock User',
      email: overrides.email || 'user@example.com',
      role: overrides.role || 'CREATOR',
      ...overrides,
    },
    expires: new Date(Date.now() + 86400000).toISOString(),
  };
}

export function createAdminSession(overrides: MockUser = {}) {
  return createMockSession({
    id: 'mock-admin-id',
    name: 'Mock Admin',
    email: 'admin@example.com',
    role: 'ADMIN',
    ...overrides,
  });
}
