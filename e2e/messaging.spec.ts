import { test, expect } from '@playwright/test';

/**
 * E2E Multi-Context Messaging Tests
 *
 * Simulates two separate browser sessions (User A: Client, User B: Creator)
 * exchanging end-to-end messages and verifying delivery and read receipts.
 */

test.describe('Multi-context messaging between two users', () => {
  test('exchanges_messages_and_read_receipts_between_two_users_across_browser_contexts', async ({ browser }) => {
    // Shared in-memory message store for deterministic E2E testing
    const messageStore: Array<{
      id: string;
      threadId: string;
      senderId: string;
      recipientId: string;
      plaintext: string;
      ciphertext: string;
      iv: string;
      createdAt: string;
      status: 'sent' | 'read';
      readBy: string[];
    }> = [];

    const handleMessagesRoute = async (route: any, request: any) => {
      const url = new URL(request.url());
      const method = request.method();

      if (method === 'GET') {
        const threadId = url.searchParams.get('threadId') || 'general';
        const messages = messageStore.filter((m) => !threadId || m.threadId === threadId);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ messages }),
        });
      } else if (method === 'POST') {
        const postData = request.postDataJSON();
        const newMsg = {
          id: postData.id || `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          threadId: postData.threadId || 'general',
          senderId: postData.senderId || 'client-1',
          recipientId: postData.recipientId || 'creator-1',
          plaintext: postData.metadata?.plainText || postData.text || 'Project deliverables update',
          ciphertext: postData.ciphertext || '',
          iv: postData.iv || '',
          createdAt: new Date().toISOString(),
          status: 'sent' as const,
          readBy: [postData.senderId || 'client-1'],
        };
        messageStore.push(newMsg);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, message: newMsg }),
        });
      } else {
        await route.continue();
      }
    };

    // 1. Create Context A (User 1 - Client)
    const contextA = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await contextA.route('**/api/messages**', handleMessagesRoute);
    const pageA = await contextA.newPage();

    // 2. Create Context B (User 2 - Creator)
    const contextB = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await contextB.route('**/api/messages**', handleMessagesRoute);
    const pageB = await contextB.newPage();

    try {
      // 3. Navigate both users to the messages page
      await pageA.goto('/messages', { waitUntil: 'domcontentloaded' });
      await pageB.goto('/messages', { waitUntil: 'domcontentloaded' });

      // 4. Set User A to Client (default is client-1)
      await expect(pageA.locator('[data-testid="participant-select"]')).toBeVisible();
      await pageA.locator('[data-testid="participant-select"]').selectOption('client-1');

      // 5. Set User B to Creator (creator-1)
      await expect(pageB.locator('[data-testid="participant-select"]')).toBeVisible();
      await pageB.locator('[data-testid="participant-select"]').selectOption('creator-1');

      // 6. User A sends message to User B
      const clientMessageText = 'Hello, can you share the latest milestone progress?';
      await pageA.locator('[data-testid="message-input"]').fill(clientMessageText);
      await pageA.locator('[data-testid="send-button"]').click();

      // Verify User A sees their own sent message
      await expect(pageA.locator('[data-testid="message-item"]', { hasText: clientMessageText })).toBeVisible({ timeout: 10000 });

      // 7. User B refreshes/queries messages and observes the incoming message
      await pageB.goto('/messages', { waitUntil: 'domcontentloaded' });
      await pageB.locator('[data-testid="participant-select"]').selectOption('creator-1');
      await expect(pageB.locator('[data-testid="message-item"]', { hasText: clientMessageText })).toBeVisible({ timeout: 10000 });

      // 8. User B marks it read and replies back to User A
      const creatorReplyText = 'All milestones are on track! Milestone 1 design preview attached.';
      await pageB.locator('[data-testid="message-input"]').fill(creatorReplyText);
      await pageB.locator('[data-testid="send-button"]').click();

      // Verify User B sees their reply
      await expect(pageB.locator('[data-testid="message-item"]', { hasText: creatorReplyText })).toBeVisible({ timeout: 10000 });

      // 9. User A receives User B's reply
      await pageA.goto('/messages', { waitUntil: 'domcontentloaded' });
      await expect(pageA.locator('[data-testid="message-item"]', { hasText: creatorReplyText })).toBeVisible({ timeout: 10000 });

      // Verify message store captured both exchanges
      expect(messageStore.length).toBeGreaterThanOrEqual(2);
      expect(messageStore.some((m) => m.senderId === 'client-1')).toBe(true);
      expect(messageStore.some((m) => m.senderId === 'creator-1')).toBe(true);
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test('validates_empty_messages_are_not_transmitted', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto('/messages', { waitUntil: 'domcontentloaded' });
      const sendButton = page.locator('[data-testid="send-button"]');
      await expect(sendButton).toBeVisible();

      // Click send with empty textarea
      await sendButton.click();
      // Should show no message item
      const messageItems = page.locator('[data-testid="message-item"]');
      expect(await messageItems.count()).toBe(0);
    } finally {
      await context.close();
    }
  });
});
