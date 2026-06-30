/**
 * #745 — OTA Rollback Manager
 *
 * Snapshots the current bundle hash before an update is applied, runs a
 * smoke test after the update loads, and automatically reverts to the last
 * known-good bundle if the smoke test fails three times consecutively.
 *
 * Integration:
 *   1. Call `snapshotCurrentBundle(hash)` immediately before applying an update.
 *   2. Call `armStabilityTimer(version)` in your root component.
 *   3. The timer calls `recordStableLaunch()` after STABLE_MS — resetting the
 *      failure counter and backing up the bundle.
 *   4. Optionally call `runSmokeTest(router)` after the new bundle loads to
 *      check HomeScreen reachability; the manager handles rollback automatically.
 */

import AsyncStorage from '@react-native-async-storage/async-storage'
import * as FileSystem from 'expo-file-system'
import * as Updates from 'expo-updates'

import { TelemetryCollector } from '../services/TelemetryCollector'
import { SentryErrorTracker } from '../services/SentryErrorTracker'
import { ROUTES } from '../constants/routes'

// ── Constants ─────────────────────────────────────────────────────────────────

const CRASH_COUNT_KEY = '@ota/crash_count'
const LAST_GOOD_VERSION_KEY = '@ota/last_good_version'
const BUNDLE_HASH_KEY = '@ota/bundle_hash_snapshot'
const SMOKE_FAIL_KEY = '@ota/smoke_fail_count'

const MAX_CRASH_COUNT = 3
const MAX_SMOKE_FAILURES = 3
/** App must run for this long without crashing to be considered stable (ms). */
const STABLE_MS = 10_000

const BUNDLE_DIR = `${FileSystem.documentDirectory}ota/`
const CURRENT_BUNDLE = `${BUNDLE_DIR}current.bundle`
const BACKUP_BUNDLE = `${BUNDLE_DIR}backup.bundle`

// ── Internal helpers ──────────────────────────────────────────────────────────

async function getCrashCount(): Promise<number> {
  const raw = await AsyncStorage.getItem(CRASH_COUNT_KEY)
  return raw ? parseInt(raw, 10) : 0
}

async function setCrashCount(n: number): Promise<void> {
  await AsyncStorage.setItem(CRASH_COUNT_KEY, String(n))
}

async function resetCrashCount(): Promise<void> {
  await AsyncStorage.removeItem(CRASH_COUNT_KEY)
}

async function getSmokeFailCount(): Promise<number> {
  const raw = await AsyncStorage.getItem(SMOKE_FAIL_KEY)
  return raw ? parseInt(raw, 10) : 0
}

async function setSmokeFailCount(n: number): Promise<void> {
  await AsyncStorage.setItem(SMOKE_FAIL_KEY, String(n))
}

async function resetSmokeFailCount(): Promise<void> {
  await AsyncStorage.removeItem(SMOKE_FAIL_KEY)
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Snapshot the current bundle hash to AsyncStorage before applying an OTA
 * update.  Call this immediately before `applyUpdate()` so the rollback
 * manager can identify the pre-update state.
 */
export async function snapshotCurrentBundle(hash: string): Promise<void> {
  await AsyncStorage.setItem(BUNDLE_HASH_KEY, hash)

  // Also back up the current bundle file so we can restore it on rollback.
  const info = await FileSystem.getInfoAsync(CURRENT_BUNDLE)
  if (info.exists) {
    await FileSystem.makeDirectoryAsync(BUNDLE_DIR, { intermediates: true })
    await FileSystem.copyAsync({ from: CURRENT_BUNDLE, to: BACKUP_BUNDLE })
  }
}

/**
 * Run a lightweight smoke test: attempt to navigate to HomeScreen and confirm
 * the route resolves without error.
 *
 * Pass the Expo Router `router` object (from `useRouter()`).
 * Returns `true` if the navigation call succeeded, `false` otherwise.
 */
export async function runSmokeTest(
  router: { navigate: (route: string) => void },
): Promise<boolean> {
  try {
    router.navigate(ROUTES.APP.HOME)
    return true
  } catch {
    return false
  }
}

/**
 * Record the outcome of a smoke test after a new bundle loads.
 *
 * - On pass: resets the consecutive failure counter.
 * - On fail: increments the counter; triggers rollback when MAX_SMOKE_FAILURES
 *   consecutive failures are reached.
 *
 * @param passed      Whether the smoke test passed.
 * @param bundleVersion  The newly applied bundle version string.
 */
export async function recordSmokeTestResult(
  passed: boolean,
  bundleVersion: string,
): Promise<void> {
  if (passed) {
    await resetSmokeFailCount()
    return
  }

  const count = await getSmokeFailCount()
  const next = count + 1
  await setSmokeFailCount(next)

  if (next >= MAX_SMOKE_FAILURES) {
    await triggerRollback(bundleVersion, `smoke test failed ${next} times consecutively`)
  }
}

/**
 * Revert to the last known-good bundle, report the event to telemetry and
 * Sentry, then reload the app via `Updates.reloadAsync()`.
 *
 * Called automatically by `recordSmokeTestResult` when the threshold is
 * reached; may also be called manually.
 */
export async function triggerRollback(
  bundleVersion: string,
  reason: string,
): Promise<void> {
  const previousHash = await AsyncStorage.getItem(BUNDLE_HASH_KEY)

  // Restore backup bundle to the current slot.
  const backupInfo = await FileSystem.getInfoAsync(BACKUP_BUNDLE)
  if (backupInfo.exists) {
    await FileSystem.copyAsync({ from: BACKUP_BUNDLE, to: CURRENT_BUNDLE })
  } else {
    console.warn('[OTA Rollback] No backup bundle found — reload may use built-in bundle')
  }

  await resetSmokeFailCount()
  await resetCrashCount()

  // Report to telemetry.
  TelemetryCollector.getInstance().logEvent({
    name: 'ota_rollback',
    category: 'ota',
    value: { bundleVersion, reason, previousHash: previousHash ?? 'unknown' },
  })

  // Notify the dev team via Sentry.
  SentryErrorTracker.getInstance().captureMessage(
    `[OTA] Rollback triggered for bundle ${bundleVersion}: ${reason}`,
    'error',
  )

  // Reload the app so it picks up the restored bundle.
  await Updates.reloadAsync()
}

/**
 * Call once at app startup (before any async work).
 * Increments the crash counter and triggers rollback if the threshold is hit.
 *
 * Returns `true` if a rollback was performed (app will reload).
 */
export async function recordLaunch(): Promise<boolean> {
  const count = await getCrashCount()
  const next = count + 1
  await setCrashCount(next)

  if (next >= MAX_CRASH_COUNT) {
    console.warn(
      `[OTA Rollback] ${next} consecutive crashes detected – rolling back`,
    )
    const version = (await AsyncStorage.getItem(LAST_GOOD_VERSION_KEY)) ?? 'unknown'
    await triggerRollback(version, `${next} consecutive crashes`)
    return true
  }

  return false
}

/**
 * Call once the app has been running stably for STABLE_MS.
 * Resets crash and smoke-test failure counters, then backs up the current bundle.
 */
export async function recordStableLaunch(version: string): Promise<void> {
  await resetCrashCount()
  await resetSmokeFailCount()
  await AsyncStorage.setItem(LAST_GOOD_VERSION_KEY, version)

  const info = await FileSystem.getInfoAsync(CURRENT_BUNDLE)
  if (info.exists) {
    await FileSystem.makeDirectoryAsync(BUNDLE_DIR, { intermediates: true })
    await FileSystem.copyAsync({ from: CURRENT_BUNDLE, to: BACKUP_BUNDLE })
  }
}

/**
 * Restore the backup bundle to the current slot.
 * The caller is responsible for triggering a reload after this returns.
 */
export async function rollback(): Promise<void> {
  const backupInfo = await FileSystem.getInfoAsync(BACKUP_BUNDLE)
  if (!backupInfo.exists) {
    console.warn('[OTA Rollback] No backup bundle found – cannot roll back')
    return
  }

  await FileSystem.copyAsync({ from: BACKUP_BUNDLE, to: CURRENT_BUNDLE })
  await resetCrashCount()
  console.log('[OTA Rollback] Rolled back to last known-good bundle')
}

/** Returns the version string of the last known-good bundle, or null. */
export async function lastGoodVersion(): Promise<string | null> {
  return AsyncStorage.getItem(LAST_GOOD_VERSION_KEY)
}

/** Arm the stability timer. Call at the top of your root component. */
export function armStabilityTimer(version: string): () => void {
  const timer = setTimeout(() => {
    recordStableLaunch(version).catch(console.error)
  }, STABLE_MS)
  return () => clearTimeout(timer)
}
