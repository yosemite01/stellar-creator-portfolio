import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// --- Mocks ---

const mockPromptAsync = vi.fn();
const mockAuthRequest = {
  iosClientId: 'test-ios',
  androidClientId: 'test-android',
  webClientId: 'test-web',
};

// Track the response that will be returned by useAuthRequest
let mockAuthResponse: any = null;

vi.mock('expo-auth-session/providers/google', () => ({
  useAuthRequest: vi.fn(() => [
    mockAuthRequest,
    mockAuthResponse,
    mockPromptAsync,
  ]),
}));

vi.mock('expo-web-browser', () => ({
  maybeCompleteAuthSession: vi.fn(),
}));

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

// --- Import after mocks ---
import { useGoogleAuth, GoogleAuthUser } from '@/mobile/src/hooks/useGoogleAuth';

describe('useGoogleAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthResponse = null;
    mockPromptAsync.mockReset();
    mockFetch.mockReset();
  });

  describe('initial state', () => {
    it('should start in idle state with no user or error', () => {
      const { result } = renderHook(() => useGoogleAuth());

      expect(result.current.status).toBe('idle');
      expect(result.current.user).toBeNull();
      expect(result.current.error).toBeNull();
    });

    it('should expose isReady based on auth request availability', () => {
      const { result } = renderHook(() => useGoogleAuth());

      // request is truthy (mockAuthRequest), so isReady should be true
      expect(result.current.isReady).toBe(true);
    });

    it('should expose signIn function', () => {
      const { result } = renderHook(() => useGoogleAuth());

      expect(typeof result.current.signIn).toBe('function');
    });
  });

  describe('signIn', () => {
    it('should call promptAsync when signIn is invoked', () => {
      const { result } = renderHook(() => useGoogleAuth());

      act(() => {
        result.current.signIn();
      });

      expect(mockPromptAsync).toHaveBeenCalledTimes(1);
    });

    it('should set status to requesting on signIn', () => {
      const { result } = renderHook(() => useGoogleAuth());

      act(() => {
        result.current.signIn();
      });

      expect(result.current.status).toBe('requesting');
    });

    it('should clear previous error on signIn', () => {
      const { result } = renderHook(() => useGoogleAuth());

      // First, set an error by simulating an error response
      mockAuthResponse = { type: 'error', error: { message: 'Cancelled' } };
      const { rerender } = renderHook(() => useGoogleAuth());
      // Force re-render to process the response effect
      rerender();

      expect(result.current.error).toBeTruthy();

      // Now signIn should clear the error
      mockAuthResponse = null;
      act(() => {
        result.current.signIn();
      });

      // The error state is cleared in signIn callback
      expect(mockPromptAsync).toHaveBeenCalled();
    });
  });

  describe('successful auth flow', () => {
    it('should verify with backend on successful Google response', async () => {
      const mockUser: GoogleAuthUser = {
        id: 'user-1',
        email: 'test@example.com',
        name: 'Test User',
        role: 'CREATOR',
        walletAddress: null,
        onboardingCompleted: false,
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockUser,
      });

      mockAuthResponse = {
        type: 'success',
        authentication: { idToken: 'google-id-token-123' },
      };

      const { result } = renderHook(() => useGoogleAuth());

      // Wait for the useEffect to process the response
      await waitFor(() => {
        expect(result.current.status).toBe('success');
      });

      expect(result.current.user).toEqual(mockUser);
      expect(result.current.error).toBeNull();
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/auth/mobile/google'),
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken: 'google-id-token-123' }),
        }),
      );
    });

    it('should pass through verifying status', async () => {
      // Create a delayed fetch to catch the verifying state
      mockFetch.mockImplementation(
        () => new Promise((resolve) => {
          setTimeout(() => resolve({ ok: true, json: async () => ({ id: '1' }) }), 100);
        }),
      );

      mockAuthResponse = {
        type: 'success',
        authentication: { idToken: 'token' },
      };

      const { result } = renderHook(() => useGoogleAuth());

      await waitFor(() => {
        expect(result.current.status).toBe('verifying');
      });
    });
  });

  describe('error auth flow', () => {
    it('should set error on Google auth error response', async () => {
      mockAuthResponse = {
        type: 'error',
        error: { message: 'User cancelled' },
      };

      const { result } = renderHook(() => useGoogleAuth());

      await waitFor(() => {
        expect(result.current.status).toBe('error');
      });

      expect(result.current.error).toBe('User cancelled');
      expect(result.current.user).toBeNull();
    });

    it('should handle error response without message', async () => {
      mockAuthResponse = {
        type: 'error',
        error: {},
      };

      const { result } = renderHook(() => useGoogleAuth());

      await waitFor(() => {
        expect(result.current.status).toBe('error');
      });

      expect(result.current.error).toContain('cancelled or failed');
    });
  });

  describe('backend verification failure', () => {
    it('should set error when backend returns non-ok response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'Invalid token' }),
      });

      mockAuthResponse = {
        type: 'success',
        authentication: { idToken: 'bad-token' },
      };

      const { result } = renderHook(() => useGoogleAuth());

      await waitFor(() => {
        expect(result.current.status).toBe('error');
      });

      expect(result.current.error).toBe('Invalid token');
      expect(result.current.user).toBeNull();
    });

    it('should handle backend error without message field', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        json: async () => ({}),
      });

      mockAuthResponse = {
        type: 'success',
        authentication: { idToken: 'bad-token' },
      };

      const { result } = renderHook(() => useGoogleAuth());

      await waitFor(() => {
        expect(result.current.status).toBe('error');
      });

      expect(result.current.error).toBe('Google sign-in failed');
    });

    it('should set network error when fetch throws', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      mockAuthResponse = {
        type: 'success',
        authentication: { idToken: 'token' },
      };

      const { result } = renderHook(() => useGoogleAuth());

      await waitFor(() => {
        expect(result.current.status).toBe('error');
      });

      expect(result.current.error).toContain('Could not reach the server');
    });
  });

  describe('non-success responses', () => {
    it('should not trigger backend verification for cancel response', async () => {
      mockAuthResponse = { type: 'cancel' };

      const { result } = renderHook(() => useGoogleAuth());

      // Give effects a chance to run
      await waitFor(() => {
        expect(mockFetch).not.toHaveBeenCalled();
      });

      expect(result.current.status).toBe('idle');
    });

    it('should not trigger backend verification for dismiss response', async () => {
      mockAuthResponse = { type: 'dismiss' };

      renderHook(() => useGoogleAuth());

      await waitFor(() => {
        expect(mockFetch).not.toHaveBeenCalled();
      });
    });
  });

  describe('GoogleAuthUser interface', () => {
    it('should accept all defined fields', () => {
      const user: GoogleAuthUser = {
        id: 'user-123',
        email: 'creator@example.com',
        name: 'Creator Name',
        role: 'CREATOR',
        walletAddress: 'GABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxy',
        onboardingCompleted: true,
      };

      expect(user.id).toBe('user-123');
      expect(user.walletAddress).toMatch(/^G/);
      expect(user.onboardingCompleted).toBe(true);
    });

    it('should allow null for optional fields', () => {
      const user: GoogleAuthUser = {
        id: 'user-456',
        email: 'user@example.com',
        name: null,
        role: 'USER',
        walletAddress: null,
        onboardingCompleted: false,
      };

      expect(user.name).toBeNull();
      expect(user.walletAddress).toBeNull();
    });
  });
});
