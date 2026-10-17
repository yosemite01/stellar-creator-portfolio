import { describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '../route';

describe('/api/messages route handlers', () => {
  it('GET /api/messages returns list of messages', async () => {
    const req = new NextRequest('http://localhost:3000/api/messages?threadId=general');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.messages)).toBe(true);
  });

  it('POST /api/messages appends new message and returns ok', async () => {
    const messagePayload = {
      id: 'msg-test-1',
      threadId: 'general',
      senderId: 'client-1',
      recipientId: 'creator-1',
      ciphertext: 'test-cipher',
      iv: 'test-iv',
      metadata: { plainText: 'Test message body' },
    };

    const req = new NextRequest('http://localhost:3000/api/messages', {
      method: 'POST',
      body: JSON.stringify(messagePayload),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.message.id).toBe('msg-test-1');
  });

  it('GET /api/messages filters by query search string', async () => {
    const req = new NextRequest('http://localhost:3000/api/messages?q=deliverables');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.messages)).toBe(true);
  });
});
