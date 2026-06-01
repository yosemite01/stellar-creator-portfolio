// SafetyNet (Android) + DeviceCheck (iOS) HSM attestation
// Blocks jailbroken/rooted environments before large transactions
export type AttestationPlatform = 'ios' | 'android' | 'unknown';

export interface AttestationResult {
  isValid: boolean;
  platform: AttestationPlatform;
  token: string | null;
  error?: string;
}

function detectPlatform(): AttestationPlatform {
  const p = (globalThis as any).__PLATFORM__;
  return p === 'ios' || p === 'android' ? p : 'unknown';
}

async function runDeviceCheck(): Promise<AttestationResult> {
  const bridge = (globalThis as any).DeviceCheckBridge;
  if (!bridge?.generateToken) {
    return { isValid: false, platform: 'ios', token: null, error: 'DeviceCheck unavailable' };
  }
  try {
    const token: string = await bridge.generateToken();
    return { isValid: true, platform: 'ios', token };
  } catch (err) {
    return { isValid: false, platform: 'ios', token: null, error: String(err) };
  }
}

async function runSafetyNet(nonce: string): Promise<AttestationResult> {
  const bridge = (globalThis as any).SafetyNetBridge;
  if (!bridge?.attest) {
    return { isValid: false, platform: 'android', token: null, error: 'SafetyNet unavailable' };
  }
  try {
    const jws: string = await bridge.attest(nonce);
    return { isValid: true, platform: 'android', token: jws };
  } catch (err) {
    return { isValid: false, platform: 'android', token: null, error: String(err) };
  }
}

// Call before any large transaction. Returns isValid=false for
// jailbroken/rooted devices or platforms that cannot be attested.
export async function attestDevice(nonce: string): Promise<AttestationResult> {
  const platform = detectPlatform();
  if (platform === 'ios')     return runDeviceCheck();
  if (platform === 'android') return runSafetyNet(nonce);
  return { isValid: false, platform: 'unknown', token: null, error: 'Unsupported platform' };
}

// Backend enforcement: throws if attestation fails
export async function requireAttestation(nonce: string): Promise<void> {
  const result = await attestDevice(nonce);
  if (!result.isValid) {
    throw new Error(`Device attestation failed: ${result.error ?? 'unknown'}`);
  }
}
