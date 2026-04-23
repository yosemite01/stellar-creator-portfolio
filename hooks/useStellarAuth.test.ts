import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useStellarAuth } from './useStellarAuth';
import albedo from '@albedo-link/intent';

// Mock albedo
vi.mock('@albedo-link/intent', () => ({
  default: {
    publicKey: vi.fn(),
  },
}));

describe('useStellarAuth', () => {
  const STORAGE_KEY = 'stellar_auth_key';

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('should initialize with null public key', () => {
    const { result } = renderHook(() => useStellarAuth());
    expect(result.current.publicKey).toBeNull();
    expect(result.current.isConnected).toBe(false);
  });

  it('should restore public key from localStorage', () => {
    const mockKey = 'GB6S45...';
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ publicKey: mockKey }));

    const { result } = renderHook(() => useStellarAuth());
    expect(result.current.publicKey).toBe(mockKey);
    expect(result.current.isConnected).toBe(true);
  });

  it('should connect successfully using albedo', async () => {
    const mockKey = 'GBH47FB7R53C4DBSL4D276F53D74B783E67B6S455643210987654321';
    (albedo.publicKey as any).mockResolvedValue({ pubkey: mockKey });

    const { result } = renderHook(() => useStellarAuth());

    await act(async () => {
      await result.current.connect();
    });

    expect(albedo.publicKey).toHaveBeenCalled();
    expect(result.current.publicKey).toBe(mockKey);
    expect(result.current.isConnected).toBe(true);
    expect(result.current.error).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toContain(mockKey);
  });

  it('should handle connection errors', async () => {
    (albedo.publicKey as any).mockRejectedValue(new Error('Connection failed'));

    const { result } = renderHook(() => useStellarAuth());

    await act(async () => {
      await result.current.connect();
    });

    expect(result.current.publicKey).toBeNull();
    expect(result.current.isConnected).toBe(false);
    expect(result.current.error).toBe('Connection failed');
  });

  it('should handle user cancellation', async () => {
    (albedo.publicKey as any).mockRejectedValue({ code: -1, message: 'User closed window' });

    const { result } = renderHook(() => useStellarAuth());

    await act(async () => {
      await result.current.connect();
    });

    expect(result.current.error).toBe('Connection cancelled by user');
  });

  it('should disconnect and clear storage', () => {
    const mockKey = 'GB6S45...';
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ publicKey: mockKey }));

    const { result } = renderHook(() => useStellarAuth());
    
    act(() => {
      result.current.disconnect();
    });

    expect(result.current.publicKey).toBeNull();
    expect(result.current.isConnected).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
