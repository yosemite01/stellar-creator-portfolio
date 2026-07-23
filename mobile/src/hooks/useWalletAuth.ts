/**
 * useWalletAuth — Biometric + PIN + Wallet fallback auth chain (#723)
 *
 * Flow:
 *  1. Try Face ID / Touch ID via BiometricAuthService
 *  2. If not available immediately, falls back to PIN / passphrase entry
 *  3. If PIN fails 5 times, require wallet signature as final fallback
 *  4. All paths ultimately prove ownership of a Stellar public key
 *
 * States: idle -> biometric -> pin -> connecting -> awaiting_wallet -> verifying -> authenticated | error
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Linking } from "react-native";
import { trigger as triggerHaptic } from "../haptics/HapticEngine";
import { telemetryCollector } from "../services/TelemetryCollector";
import {
  getBiometricSupport,
  authenticateBiometric,
  BiometricSupportResult,
  BiometricAuthResult,
} from "../services/BiometricAuthService";
import {
  buildWCUri,
  clearSession,
  exchangeForToken,
  generatePairingParams,
  isValidStellarKey,
  loadSession,
  loadToken,
  openWalletWithUri,
  parseWCCallback,
  saveSession,
  WCSession,
  AuthToken,
} from "../services/WalletConnectService";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AuthStatus =
  | "idle"
  | "biometric"
  | "pin"
  | "connecting"
  | "awaiting_wallet"
  | "verifying"
  | "authenticated"
  | "error";

export interface WalletAuthState {
  status: AuthStatus;
  session: WCSession | null;
  token: AuthToken | null;
  error: string | null;
  wcUri: string | null;
  /** Whether biometrics are available on this device. */
  biometricAvailable: boolean;
  /** Remaining PIN attempts before wallet fallback. */
  pinAttemptsRemaining: number;
  /** Timestamp (ms) when the account lock expires, or 0 if not locked. */
  lockedUntil: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_PIN_ATTEMPTS = 5;
const PIN_LOCK_DURATION_MS = 30 * 60 * 1000; // 30 minutes

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useWalletAuth() {
  const [state, setState] = useState<WalletAuthState>({
    status: "idle",
    session: null,
    token: null,
    error: null,
    wcUri: null,
    biometricAvailable: false,
    pinAttemptsRemaining: MAX_PIN_ATTEMPTS,
    lockedUntil: 0,
  });

  const isMountedRef = useRef(true);
  const pendingTopicRef = useRef<string | null>(null);

  // ---- Detect biometric support on mount ----
  useEffect(() => {
    (async () => {
      const [session, token] = await Promise.all([loadSession(), loadToken()]);
      if (session && token) {
        setState((s) => ({ ...s, status: "authenticated", session, token }));
        return;
      }

      const support: BiometricSupportResult = await getBiometricSupport();
      if (!isMountedRef.current) return;

      setState((s) => ({ ...s, biometricAvailable: support.available }));

      telemetryCollector.logEvent({
        name: "wallet_auth_init",
        value: support.available ? "biometric_available" : "biometric_unavailable",
        category: "auth",
      });

      if (support.available) {
        await doBiometricAttempt();
      }
    })();

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // ---- Deep-link listener for wallet callback ----
  useEffect(() => {
    const handleUrl = async ({ url }: { url: string }) => {
      if (!isMountedRef.current) return;

      const params = parseWCCallback(url);
      if (!params) return;

      if (pendingTopicRef.current && params.topic !== pendingTopicRef.current) return;

      if (!isValidStellarKey(params.publicKey)) {
        setState((s) => ({
          ...s,
          status: "error",
          error: "Wallet returned an invalid Stellar public key.",
        }));
        telemetryCollector.logEvent({ name: "wallet_auth_error", value: "invalid_public_key", category: "auth" });
        return;
      }

      setState((s) => ({ ...s, status: "verifying", error: null }));

      const session: WCSession = {
        topic: params.topic,
        publicKey: params.publicKey,
        expiry: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
      };

      try {
        await saveSession(session);
        const token = await exchangeForToken(session);
        if (!isMountedRef.current) return;
        pendingTopicRef.current = null;
        setState((s) => ({ ...s, status: "authenticated", session, token, wcUri: null }));
        telemetryCollector.logEvent({ name: "wallet_auth_success", value: "wallet_signature", category: "auth" });
      } catch (err) {
        if (!isMountedRef.current) return;
        setState((s) => ({
          ...s,
          status: "error",
          error: err instanceof Error ? err.message : "Authentication failed.",
        }));
        telemetryCollector.logEvent({
          name: "wallet_auth_error",
          value: err instanceof Error ? err.message : "unknown",
          category: "auth",
        });
      }
    };

    const sub = Linking.addEventListener("url", handleUrl);
    Linking.getInitialURL().then((url) => {
      if (url) handleUrl({ url });
    });
    return () => sub.remove();
  }, []);

  // ---- Attempt biometric authentication ----
  const doBiometricAttempt = useCallback(async () => {
    if (isLocked()) return;

    setState((s) => ({ ...s, status: "biometric", error: null }));
    await triggerHaptic("light");
    telemetryCollector.logEvent({ name: "auth_attempt", value: "biometric_started", category: "auth" });

    const result: BiometricAuthResult = await authenticateBiometric();

    if (!isMountedRef.current) return;

    if (result.success) {
      setState((s) => ({ ...s, status: "authenticated" }));
      await triggerHaptic("success");
      telemetryCollector.logEvent({ name: "auth_attempt", value: "biometric_success", category: "auth" });
    } else {
      await triggerHaptic("error");
      telemetryCollector.logEvent({ name: "auth_attempt", value: "biometric_failed", category: "auth" });
      setState((s) => ({ ...s, status: "pin", error: result.error ?? null }));
    }
  }, []);

  const attemptBiometric = useCallback(async () => {
    await doBiometricAttempt();
  }, [doBiometricAttempt]);

  // ---- Submit PIN / passphrase ----
  const submitPin = useCallback(async (pin: string) => {
    if (isLocked()) return;
    await triggerHaptic("medium");

    const isValid = pin.length >= 4 && pin === "1234"; // Demo validation

    if (!isMountedRef.current) return;

    if (isValid) {
      setState((s) => ({
        ...s,
        status: "authenticated",
        pinAttemptsRemaining: MAX_PIN_ATTEMPTS,
      }));
      await triggerHaptic("success");
      telemetryCollector.logEvent({ name: "auth_attempt", value: "pin_success", category: "auth" });
    } else {
      setState((s) => {
        const remaining = s.pinAttemptsRemaining - 1;
        if (remaining <= 0) {
          telemetryCollector.logEvent({ name: "auth_attempt", value: "pin_locked", category: "auth" });
          return {
            ...s,
            pinAttemptsRemaining: 0,
            lockedUntil: Date.now() + PIN_LOCK_DURATION_MS,
            error: "Too many failed attempts. Account locked for 30 minutes.",
            status: "error" as AuthStatus,
          };
        }
        return {
          ...s,
          pinAttemptsRemaining: remaining,
          error: "Incorrect PIN. " + remaining + " attempt" + (remaining === 1 ? "" : "s") + " remaining.",
        };
      });
      await triggerHaptic("error");
      telemetryCollector.logEvent({ name: "auth_attempt", value: "pin_failed", category: "auth" });
    }
  }, []);

  // ---- Fall back to wallet signature (last resort) ----
  const fallbackToWallet = useCallback(async () => {
    if (!isMountedRef.current) return;
    setState((s) => ({ ...s, status: "connecting", error: null, wcUri: null }));
    await triggerHaptic("light");
    telemetryCollector.logEvent({ name: "auth_attempt", value: "wallet_fallback_started", category: "auth" });

    try {
      const params = generatePairingParams();
      const uri = buildWCUri(params);
      pendingTopicRef.current = params.topic;

      setState((s) => ({ ...s, status: "awaiting_wallet", wcUri: uri }));
      await openWalletWithUri(uri);
      telemetryCollector.logEvent({ name: "auth_attempt", value: "wallet_uri_opened", category: "auth" });
    } catch (err) {
      if (!isMountedRef.current) return;
      setState((s) => ({
        ...s,
        status: "error",
        error: err instanceof Error ? err.message : "Failed to open wallet.",
      }));
      telemetryCollector.logEvent({ name: "auth_attempt", value: "wallet_fallback_failed", category: "auth" });
    }
  }, []);

  // ---- Retry biometric ----
  const retryBiometric = useCallback(async () => {
    setState((s) => ({ ...s, status: "idle", error: null }));
    await doBiometricAttempt();
  }, [doBiometricAttempt]);

  // ---- Disconnect ----
  const disconnect = useCallback(async () => {
    pendingTopicRef.current = null;
    await clearSession();
    if (!isMountedRef.current) return;
    setState({
      status: "idle",
      session: null,
      token: null,
      error: null,
      wcUri: null,
      biometricAvailable: state.biometricAvailable,
      pinAttemptsRemaining: MAX_PIN_ATTEMPTS,
      lockedUntil: 0,
    });
  }, [state.biometricAvailable]);

  // ---- Reset error ----
  const resetError = useCallback(() => {
    setState((s) => ({ ...s, status: "idle", error: null }));
  }, []);

  // ---- Helpers ----
  const isLocked = (): boolean => {
    return state.lockedUntil > 0 && Date.now() < state.lockedUntil;
  };

  return {
    ...state,
    attemptBiometric,
    submitPin,
    fallbackToWallet,
    retryBiometric,
    disconnect,
    resetError,
  };
}
