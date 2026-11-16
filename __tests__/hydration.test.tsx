import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';
import {
  HydrationSafe,
  useBrowserOnly,
  useClientOnly,
  useMounted,
  SafeDate,
  SafeNumber,
} from '@/lib/hydration/hydration-safe';

describe('Hydration Safety Suite (Issue #1826)', () => {
  describe('HydrationSafe component', () => {
    it('renders children safely after mount without crashing', () => {
      render(
        <HydrationSafe fallback={<div>Loading placeholder...</div>}>
          <div data-testid="actual-content">Interactive Content</div>
        </HydrationSafe>,
      );

      expect(screen.getByTestId('actual-content')).toBeDefined();
      expect(screen.getByText('Interactive Content')).toBeDefined();
    });
  });

  describe('useClientOnly hook', () => {
    function TestClientOnly() {
      const isClient = useClientOnly();
      return <div data-testid="client-status">{isClient ? 'client' : 'server'}</div>;
    }

    it('identifies client execution after mount', () => {
      render(<TestClientOnly />);
      expect(screen.getByTestId('client-status').textContent).toBe('client');
    });
  });

  describe('useBrowserOnly hook', () => {
    function TestBrowserOnly() {
      const windowWidth = useBrowserOnly(() => (typeof window !== 'undefined' ? 1024 : 0), 0);
      return <div data-testid="width-display">{windowWidth}</div>;
    }

    it('returns browser value after mount and falls back safely', () => {
      render(<TestBrowserOnly />);
      expect(screen.getByTestId('width-display').textContent).toBe('1024');
    });

    it('catches browser evaluation errors without throwing', () => {
      function TestErrorBrowser() {
        const val = useBrowserOnly(() => {
          throw new Error('Access denied');
        }, 'safe-fallback');
        return <div data-testid="error-val">{val}</div>;
      }

      render(<TestErrorBrowser />);
      expect(screen.getByTestId('error-val').textContent).toBe('safe-fallback');
    });
  });

  describe('SafeDate component', () => {
    const testDate = new Date('2026-06-15T12:00:00.000Z');

    it('renders time tag with dateTime and suppressHydrationWarning', () => {
      const { container } = render(<SafeDate date={testDate} format="iso" />);
      const timeElem = container.querySelector('time');
      expect(timeElem).not.toBeNull();
      expect(timeElem?.getAttribute('datetime')).toBe('2026-06-15T12:00:00.000Z');
      expect(timeElem?.textContent).toBe('2026-06-15');
    });

    it('handles date strings and timestamps gracefully', () => {
      const { container } = render(<SafeDate date="2026-01-01T00:00:00.000Z" format="iso" />);
      expect(container.querySelector('time')?.textContent).toBe('2026-01-01');
    });
  });

  describe('SafeNumber component', () => {
    it('formats currency with suppressHydrationWarning', () => {
      const { container } = render(<SafeNumber value={2500} style="currency" />);
      const span = container.querySelector('span');
      expect(span).not.toBeNull();
      expect(span?.textContent).toContain('2,500');
    });

    it('formats plain decimal numbers', () => {
      const { container } = render(<SafeNumber value={1000000} style="decimal" />);
      expect(container.querySelector('span')?.textContent).toContain('1,000,000');
    });
  });

  describe('useMounted hook', () => {
    function TestMounted() {
      const mounted = useMounted();
      return <div data-testid="mounted-state">{mounted ? 'mounted' : 'unmounted'}</div>;
    }

    it('reports mounted true after effect', () => {
      render(<TestMounted />);
      expect(screen.getByTestId('mounted-state').textContent).toBe('mounted');
    });
  });
});
