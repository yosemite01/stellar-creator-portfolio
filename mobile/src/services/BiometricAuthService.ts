import { Platform } from "react-native";
import { telemetryCollector } from "./TelemetryCollector";

const AUTH_MODULE = "expo-local-authentication";

/** Structured result for biometric support check (#723). */
export interface BiometricSupportResult {
  /** Whether the device has biometric hardware AND at least one credential enrolled. */
  available: boolean;
  /** Whether a biometric credential is enrolled (fingerprint / face). */
  enrolled: boolean;
  /** Human-readable list of available biometric methods. */
  methods: string[];
  /** Error message if the check itself failed. */
  error?: string;
}

/** Structured result for a biometric authentication attempt (#723). */
export interface BiometricAuthResult {
  success: boolean;
  error?: string;
}

async function loadAuthenticationModule() {
  try {
    const moduleName = AUTH_MODULE;
    return await import(moduleName);
  } catch {
    return null;
  }
}

/**
 * Check biometric support, returning a structured result with `available`,
 * `enrolled`, and `error` fields (#723).
 */
export async function getBiometricSupport(): Promise<BiometricSupportResult> {
  const LocalAuthentication = await loadAuthenticationModule();
  if (!LocalAuthentication) {
    const result: BiometricSupportResult = {
      available: false,
      enrolled: false,
      methods: [],
      error:
        "Biometric authentication support is unavailable. Install expo-local-authentication.",
    };
    telemetryCollector.logEvent({
      name: "biometric_support",
      value: JSON.stringify(result),
      category: "auth",
    });
    return result;
  }

  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const isEnrolled = await LocalAuthentication.isEnrolledAsync();
    const supportedTypes =
      await LocalAuthentication.supportedAuthenticationTypesAsync();

    const methods = hasHardware
      ? supportedTypes.map((type: number) => {
          if (type === LocalAuthentication.AuthenticationType.FACE_ID)
            return "Face ID";
          if (type === LocalAuthentication.AuthenticationType.FINGERPRINT)
            return "Touch ID";
          if (type === LocalAuthentication.AuthenticationType.IRIS) return "Iris";
          return "Biometric";
        })
      : [];

    const result: BiometricSupportResult = {
      available: hasHardware && isEnrolled,
      enrolled: isEnrolled,
      methods,
      error: !hasHardware
        ? "No biometric hardware on this device."
        : !isEnrolled
          ? "No biometric credential enrolled."
          : undefined,
    };

    telemetryCollector.logEvent({
      name: "biometric_support",
      value: JSON.stringify(result),
      category: "auth",
    });
    return result;
  } catch (error) {
    const result: BiometricSupportResult = {
      available: false,
      enrolled: false,
      methods: [],
      error:
        error instanceof Error
          ? error.message
          : "Failed to detect biometric capabilities.",
    };
    telemetryCollector.logEvent({
      name: "biometric_support",
      value: result.error,
      category: "auth",
    });
    return result;
  }
}

/**
 * Authenticate using Face ID / Touch ID. Returns a structured result.
 * Logs the outcome to TelemetryCollector (#723).
 */
export async function authenticateBiometric(): Promise<BiometricAuthResult> {
  const LocalAuthentication = await loadAuthenticationModule();
  if (!LocalAuthentication) {
    const result: BiometricAuthResult = {
      success: false,
      error:
        "Missing biometric support library. Please install expo-local-authentication.",
    };
    telemetryCollector.logEvent({
      name: "biometric_auth",
      value: result.error,
      category: "auth",
    });
    return result;
  }

  try {
    const authResult = await LocalAuthentication.authenticateAsync({
      promptMessage: "Authenticate to access Stellar",
      cancelLabel: "Cancel",
      fallbackLabel: "Use passcode",
      disableDeviceFallback: false,
    });

    const result: BiometricAuthResult = {
      success: authResult.success,
      error: authResult.success
        ? undefined
        : (authResult.error ?? "Authentication failed"),
    };

    telemetryCollector.logEvent({
      name: "biometric_auth",
      value: result.success ? "success" : "failed",
      category: "auth",
    });
    return result;
  } catch (error) {
    const result: BiometricAuthResult = {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Authentication failed unexpectedly.",
    };
    telemetryCollector.logEvent({
      name: "biometric_auth",
      value: result.error,
      category: "auth",
    });
    return result;
  }
}
