/**
 * #603 — OTA Client
 *
 * DO NOT WIRE THIS UP AS-IS. Not currently imported by anything in the
 * app (verified) - keep it that way until the design below is fixed.
 *
 * The manifest's "signed" claim and the AES-GCM decryption here do not
 * provide the authenticity this needs:
 *   - EXPO_PUBLIC_OTA_AES_KEY is inlined into the client bundle at build
 *     time by design (that's what EXPO_PUBLIC_* means) - every installed
 *     copy of the app ships the same decryption key. Anyone who extracts
 *     it from one install can decrypt any patch, and - far worse - can
 *     encrypt their own arbitrary patch with the same key. AES-GCM's tag
 *     will verify against attacker-crafted plaintext just as validly as
 *     against a real one, because "encrypted with this key" and
 *     "actually came from the OTA server" are not the same claim once
 *     the key is public.
 *   - applyUpdate()'s only integrity check is comparing the patched
 *     bundle's SHA-256 against manifest.sha256 - a field that comes from
 *     the same unauthenticated fetch(MANIFEST_URL) response. That's
 *     circular: whoever controls (or can spoof/MITM) the manifest
 *     response controls both the payload and the "checksum" that's
 *     supposed to verify it.
 *   - Net effect if this were ever wired up: anyone who extracts the
 *     shared key from an installed client, or who can serve a
 *     replacement manifest, can push arbitrary executable JS to every
 *     device that polls for updates - a remote-code-execution path
 *     against the whole install base, not just a data-integrity bug.
 *
 * A real fix needs asymmetric signing, not a shared symmetric key: the
 * manifest itself signed server-side with a private key that never
 * leaves the server, verified client-side against a public key embedded
 * in the build (which is safe to embed - it can only verify, not sign).
 * The payload's SHA-256 must be checked against a hash carried inside
 * that signed manifest, not treated as trustworthy on its own. Given the
 * real backend signing infrastructure this needs, consider whether
 * `expo-updates` / EAS Update (which already solves exactly this
 * problem, with review from an app-platform team behind it) is a better
 * fit than maintaining bespoke OTA crypto and binary patching in-house.
 *
 * Original doc, kept for context on what this file currently does:
 *
 * Fetches a signed OTA manifest, decrypts the AES-256-GCM payload,
 * applies a differential binary patch, verifies the SHA-256 checksum,
 * then swaps the bundle. Operates without App Store review.
 *
 * Flow:
 *   1. Poll OTA_MANIFEST_URL for a new manifest
 *   2. Compare manifest.version against the running bundle version
 *   3. Download the encrypted patch blob
 *   4. Decrypt with AES-256-GCM using the pre-shared app key
 *   5. Apply bsdiff-compatible patch to the current bundle
 *   6. Verify SHA-256 of the patched bundle
 *   7. Write to the pending-bundle slot and schedule a reload
 */

import * as FileSystem from 'expo-file-system'
import * as Crypto from 'expo-crypto'
import Constants from 'expo-constants'

// ── Config ────────────────────────────────────────────────────────────────────
const MANIFEST_URL =
  process.env.EXPO_PUBLIC_OTA_MANIFEST_URL ??
  'https://ota.stellar-platform.app/manifest.json'

/** AES-256-GCM key (hex-encoded 32 bytes) injected at build time. */
const OTA_AES_KEY_HEX =
  process.env.EXPO_PUBLIC_OTA_AES_KEY ?? ''

const BUNDLE_DIR = `${FileSystem.documentDirectory}ota/`
const PENDING_BUNDLE = `${BUNDLE_DIR}pending.bundle`
const CURRENT_BUNDLE = `${BUNDLE_DIR}current.bundle`

// ── Types ─────────────────────────────────────────────────────────────────────
export interface OtaManifest {
  version: string
  patchUrl: string
  /** SHA-256 hex of the fully patched bundle */
  sha256: string
  /** AES-GCM IV (hex, 12 bytes) */
  iv: string
  /** AES-GCM auth tag (hex, 16 bytes) */
  tag: string
  /** Incremental patch size in bytes */
  patchSize: number
  /** Minimum app version this patch can be applied to */
  minBaseVersion: string
}

export type OtaStatus =
  | { type: 'up-to-date' }
  | { type: 'update-available'; manifest: OtaManifest }
  | { type: 'applied'; version: string }
  | { type: 'error'; message: string }

// ── Helpers ───────────────────────────────────────────────────────────────────

function hexToUint8(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  // expo-crypto digest expects a string; encode via base64 round-trip
  const b64 = btoa(String.fromCharCode(...data))
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    b64,
    { encoding: Crypto.CryptoEncoding.HEX },
  )
}

/**
 * Minimal bsdiff-compatible patch application.
 * In production, link the native bspatch C library via a JSI module.
 * This TypeScript implementation handles the control/diff/extra block
 * format for small patches in CI/test environments.
 */
function applyBsdiffPatch(original: Uint8Array, patch: Uint8Array): Uint8Array {
  const view = new DataView(patch.buffer, patch.byteOffset)
  let pos = 0

  function readLE64(): number {
    const lo = view.getUint32(pos, true)
    const hi = view.getUint32(pos + 4, true)
    pos += 8
    // Safe for bundle sizes < 2 GB
    return hi * 0x100000000 + lo
  }

  // bsdiff header: magic(8) + ctrl_len(8) + diff_len(8) + new_size(8)
  pos = 8 // skip magic
  const ctrlLen = readLE64()
  const diffLen = readLE64()
  const newSize = readLE64()

  const ctrlBlock = patch.slice(pos, pos + ctrlLen)
  const diffBlock = patch.slice(pos + ctrlLen, pos + ctrlLen + diffLen)
  const extraBlock = patch.slice(pos + ctrlLen + diffLen)

  const output = new Uint8Array(newSize)
  let oldPos = 0
  let newPos = 0
  let ctrlPos = 0
  let diffPos = 0
  let extraPos = 0

  const ctrlView = new DataView(ctrlBlock.buffer, ctrlBlock.byteOffset)

  while (newPos < newSize) {
    // Read control triple: (x, y, z)
    const x = new DataView(ctrlBlock.buffer, ctrlBlock.byteOffset + ctrlPos).getInt32(0, true); ctrlPos += 4
    const y = new DataView(ctrlBlock.buffer, ctrlBlock.byteOffset + ctrlPos).getInt32(0, true); ctrlPos += 4
    const z = new DataView(ctrlBlock.buffer, ctrlBlock.byteOffset + ctrlPos).getInt32(0, true); ctrlPos += 4
    void ctrlView // suppress unused warning

    // Add diff bytes to old bytes
    for (let i = 0; i < x; i++) {
      const oldByte = oldPos + i < original.length ? original[oldPos + i] : 0
      output[newPos + i] = (oldByte + diffBlock[diffPos + i]) & 0xff
    }
    newPos += x; oldPos += x; diffPos += x

    // Copy extra bytes
    for (let i = 0; i < y; i++) {
      output[newPos + i] = extraBlock[extraPos + i]
    }
    newPos += y; extraPos += y

    // Adjust old position
    oldPos += z
  }

  return output
}

// ── AES-256-GCM decryption (Web Crypto API – available in Hermes/JSC) ─────────
async function decryptAesGcm(
  ciphertext: Uint8Array,
  keyHex: string,
  ivHex: string,
  tagHex: string,
): Promise<Uint8Array> {
  const keyBytes = hexToUint8(keyHex)
  const iv = hexToUint8(ivHex)
  const tag = hexToUint8(tagHex)

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  )

  // Append auth tag to ciphertext (Web Crypto expects tag appended)
  const withTag = new Uint8Array(ciphertext.length + tag.length)
  withTag.set(ciphertext)
  withTag.set(tag, ciphertext.length)

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    withTag,
  )

  return new Uint8Array(plaintext)
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Fetch and parse the remote OTA manifest. */
export async function fetchManifest(): Promise<OtaManifest> {
  const res = await fetch(MANIFEST_URL, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Manifest fetch failed: ${res.status}`)
  return res.json() as Promise<OtaManifest>
}

/** Return the currently running bundle version from Expo Constants. */
export function currentVersion(): string {
  return (Constants.expoConfig?.version ?? '0.0.0')
}

/**
 * Check for an available update.
 * Returns `up-to-date` if the manifest version matches the running version.
 */
export async function checkForUpdate(): Promise<OtaStatus> {
  try {
    const manifest = await fetchManifest()
    if (manifest.version === currentVersion()) return { type: 'up-to-date' }
    return { type: 'update-available', manifest }
  } catch (err) {
    return { type: 'error', message: String(err) }
  }
}

/**
 * Download, decrypt, patch, verify, and stage the update.
 * Call `reloadAsync()` (from expo-updates) after this returns `applied`.
 */
export async function applyUpdate(manifest: OtaManifest): Promise<OtaStatus> {
  try {
    // Ensure OTA directory exists
    await FileSystem.makeDirectoryAsync(BUNDLE_DIR, { intermediates: true })

    // 1. Download encrypted patch
    const patchPath = `${BUNDLE_DIR}patch.enc`
    const download = await FileSystem.downloadAsync(manifest.patchUrl, patchPath)
    if (download.status !== 200) throw new Error(`Patch download failed: ${download.status}`)

    // 2. Read current bundle (or empty if first install)
    let currentBytes = new Uint8Array(0)
    const currentInfo = await FileSystem.getInfoAsync(CURRENT_BUNDLE)
    if (currentInfo.exists) {
      const b64 = await FileSystem.readAsStringAsync(CURRENT_BUNDLE, {
        encoding: FileSystem.EncodingType.Base64,
      })
      currentBytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    }

    // 3. Read encrypted patch
    const encB64 = await FileSystem.readAsStringAsync(patchPath, {
      encoding: FileSystem.EncodingType.Base64,
    })
    const encBytes = Uint8Array.from(atob(encB64), (c) => c.charCodeAt(0))

    // 4. Decrypt
    const patchBytes = await decryptAesGcm(
      encBytes,
      OTA_AES_KEY_HEX,
      manifest.iv,
      manifest.tag,
    )

    // 5. Apply differential patch
    const patchedBundle = applyBsdiffPatch(currentBytes, patchBytes)

    // 6. Verify SHA-256
    const actualHash = await sha256Hex(patchedBundle)
    if (actualHash !== manifest.sha256) {
      throw new Error(
        `SHA-256 mismatch: expected ${manifest.sha256}, got ${actualHash}`,
      )
    }

    // 7. Write pending bundle
    const patchedB64 = btoa(String.fromCharCode(...patchedBundle))
    await FileSystem.writeAsStringAsync(PENDING_BUNDLE, patchedB64, {
      encoding: FileSystem.EncodingType.Base64,
    })

    // Clean up temp patch file
    await FileSystem.deleteAsync(patchPath, { idempotent: true })

    return { type: 'applied', version: manifest.version }
  } catch (err) {
    return { type: 'error', message: String(err) }
  }
}

/**
 * Promote the pending bundle to current.
 * Call this after a successful reload confirms the new bundle is stable.
 */
export async function promotePendingBundle(): Promise<void> {
  const info = await FileSystem.getInfoAsync(PENDING_BUNDLE)
  if (!info.exists) return
  await FileSystem.moveAsync({ from: PENDING_BUNDLE, to: CURRENT_BUNDLE })
}
