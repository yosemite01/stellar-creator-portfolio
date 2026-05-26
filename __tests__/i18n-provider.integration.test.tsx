import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { I18nProvider, useI18n } from '@/components/i18n-provider';

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

function Probe() {
  const { t, locale, isLoading } = useI18n();
  if (isLoading) return <div>loading</div>;
  return (
    <div>
      <span data-testid="loc">{locale}</span>
      <span data-testid="nav">{t('nav.home')}</span>
    </div>
  );
}

describe('I18nProvider integration', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    mockLocalesFetch();
    localStorage.clear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('loads default locale messages and translates', async () => {
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(screen.queryByTestId('nav')).toBeInTheDocument();
    });

    expect(screen.getByTestId('nav')).toHaveTextContent('Home');
    expect(screen.getByTestId('loc')).toHaveTextContent('en');
  });

  it('switches language and updates copy', async () => {
    function Switcher() {
      const { setLocale, t, isLoading } = useI18n();
      if (isLoading) return <div>loading</div>;
      return (
        <div>
          <span data-testid="nav">{t('nav.home')}</span>
          <button type="button" onClick={() => void setLocale('es')}>
            es
          </button>
        </div>
      );
    }

    render(
      <I18nProvider>
        <Switcher />
      </I18nProvider>,
    );

    await waitFor(() => screen.getByRole('button', { name: 'es' }));

    fireEvent.click(screen.getByRole('button', { name: 'es' }));

    await waitFor(() => {
      expect(screen.getByTestId('nav')).toHaveTextContent('Inicio');
    });
  });

  it('applies rtl and lang for Arabic', async () => {
    function GoAr() {
      const { setLocale, isLoading } = useI18n();
      if (isLoading) return <div>loading</div>;
      return (
        <button type="button" onClick={() => void setLocale('ar')}>
          use-ar
        </button>
      );
    }

    render(
      <I18nProvider>
        <GoAr />
      </I18nProvider>,
    );

    await waitFor(() => screen.getByRole('button', { name: 'use-ar' }));
    fireEvent.click(screen.getByRole('button', { name: 'use-ar' }));

    await waitFor(() => {
      expect(document.documentElement.getAttribute('dir')).toBe('rtl');
      expect(document.documentElement.getAttribute('lang')).toBe('ar');
    });
  });
});
