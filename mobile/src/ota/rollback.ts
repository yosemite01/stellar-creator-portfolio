/**
 * #603 — OTA Rollback Manager
 *
 * Tracks consecutive crash counts in AsyncStorage.
 * After MAX_CRASH_COUNT crashes the app auto-rolls back to the last
 * known-good bundle, preventing a crash-loop from bricking the install.
 *
 * Integration:
 *   Call `recordLaunch()` early in your root component (before any async work).
 *   Call `recordStableLaunch()` once the app has been running for STABLE_MS.
 */

import AsyncStorage from '@react-native-async-storage/async-storage'
import * as FileSystem from 'expo-file-system'

const CRASH_COUNT_KEY = '@ota/crash_count'
const LAST_GOOD_VERSION_KEY = '@ota/last_good_version'
const MAX_CRASH_COUNT = 3
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

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Call once at app startup (before any async work).
 * Increments the crash counter and triggers rollback if the threshold is hit.
 *
 * Returns `true` if a rollback was performed (app should reload).
 */
export async function recordLaunch(): Promise<boolean> {
  const count = await getCrashCount()
  const next = count + 1
  await setCrashCount(next)

  if (next >= MAX_CRASH_COUNT) {
    console.warn(
      `[OTA Rollback] ${next} consecutive crashes detected – rolling back`,
    )
    await rollback()
    return true
  }

  return false
}

/**
 * Call once the app has been running stably for STABLE_MS.
 * Resets the crash counter and backs up the current bundle.
 */
export async function recordStableLaunch(version: string): Promise<void> {
  await resetCrashCount()
  await AsyncStorage.setItem(LAST_GOOD_VERSION_KEY, version)

  // Back up the current bundle so rollback has something to restore
  const info = await FileSystem.getInfoAsync(CURRENT_BUNDLE)
  if (info.exists) {
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
