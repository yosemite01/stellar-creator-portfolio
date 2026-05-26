import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { I18nProvider } from '@/components/i18n-provider';
import { LanguageSwitcher } from '@/components/language-switcher';

function mockLocalesFetch() {
  const dir = join(process.cwd(), 'public/locales');
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const u = typeof input === 'string' ? input : input.toString();
    const m = u.match(/\/(en|es|fr|de|ar)\.json(?:\?|$)/);
    if (!m) {
      return new Response('not found', { status: 404 });
    }
    const code = m[1];
    const body = readFileSync(join(dir, `${code}.json`), 'utf8');
    return new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
}

describe('LanguageSwitcher', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    mockLocalesFetch();
    localStorage.clear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('renders an accessible control after translations load (Radix menu tested via integration)', async () => {
    render(
      <I18nProvider>
        <LanguageSwitcher />
      </I18nProvider>,
    );

    const trigger = await waitFor(() =>
      screen.getByRole('button', { name: /change language/i }),
    );
    await waitFor(() => expect(trigger).not.toBeDisabled());
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
  });
});
