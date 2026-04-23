'use client';

/**
 * Re-export of useStellarWallet for authentication purposes.
 * This hook provides Stellar wallet authentication functionality.
 * 
 * @see {@link useStellarWallet}
 */

export { useStellarWallet as useStellarAuth } from './useStellarWallet';
export type { StellarWallet } from './useStellarWallet';
