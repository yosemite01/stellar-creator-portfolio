# 📌 Issue Preview: Mobile secure key management with Keychain/Keystore and biometrics

**Labels:** `mobile`, `security`, `wallet`, `hard`

**Issue:** #1787 · **Size:** L · **Pinned commit:** `dd8420b`

---

### Description
Wallet secret seeds and auth tokens on mobile need hardware-backed storage, and reading a
signing key must require a biometric (or device passcode) check that the OS enforces, not just
the app. If a device is stolen, an attacker should not be able to sign a transaction or pull a
seed out of storage.

### Current Behavior (as found in code)

| Location | What it does today | Problem |
|---|---|---|
| [MultiAccountService.ts](../../mobile/src/services/MultiAccountService.ts#L89-L124) | Stores the Stellar secret seed in SecureStore under `keystore_<publicKey>` with **no options** | No `requireAuthentication`, no `keychainAccessible` setting. Any code in the process can read the seed whenever the device is unlocked. The field is called `encryptedSecret`, but the value is the plaintext seed (the file's own comment says so). |
| [MultiAccountService.ts](../../mobile/src/services/MultiAccountService.ts#L196-L233) `switchAccount` | Runs a JS-level `authenticateBiometric()` and then copies the seed into the module variable `decryptedActiveSecret` | The biometric result is a boolean the app checks. It is not tied to the key, so a hooked or patched JS bundle skips it. The seed then stays in JS memory until the next switch or remove. |
| [MultiAccountService.ts](../../mobile/src/services/MultiAccountService.ts#L265-L294) `signTransaction` | Prompts for biometrics, then returns `` `signed:${pk}:${xdr}` `` | A stub: nothing is actually signed. |
| [BiometricAuthService.ts](../../mobile/src/services/BiometricAuthService.ts#L25-L32) | Loads `expo-local-authentication` with a dynamic import | The package is **not in `mobile/package.json`**, so the import always fails. On a real build every biometric-gated call (add, switch, remove, sign) fails with "Missing biometric support library". |
| [key-store.ts](../../mobile/src/messaging/key-store.ts#L35-L38) | Signal identity keys with `WHEN_UNLOCKED_THIS_DEVICE_ONLY` | The comment says "require device authentication", but `requireAuthentication` is not set. Correct that it is device-only, but it has no auth gate. |
| [authStore.ts](../../mobile/src/store/authStore.ts#L49-L60), [WalletConnectService.ts](../../mobile/src/services/WalletConnectService.ts#L226) | Session JWT in SecureStore with default options | Acceptable for a bearer token, but it should state its accessibility class explicitly and be `THIS_DEVICE_ONLY` so it is never restored from a backup onto another phone. |
| `mobile/src/context` | No security or wallet context | There is no app-level lock state, no "keys invalidated" UX, and no wipe hook. |

### Design note

#### Secret classes
| Class | Examples | Store options | Gate |
|---|---|---|---|
| **S1: signing keys** | Stellar secret seeds | `requireAuthentication: true`, `keychainAccessible: WHEN_PASSCODE_SET_THIS_DEVICE_ONLY` | The OS prompts for biometrics on every read |
| **S2: E2E messaging keys** | Signal identity and pre-keys | `WHEN_UNLOCKED_THIS_DEVICE_ONLY` (unchanged) | None. Messaging must work in the background, so prompting on every message would break it. |
| **S3: session tokens** | Backend JWT, WalletConnect token | `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` | None. Revocable server-side. |

Only S1 gets `requireAuthentication`. Putting S2 or S3 behind a biometric prompt would break
background fetch and push handling.

#### Module layout
- `mobile/src/services/security/SecureKeyStore.ts` is the only module that imports
  `expo-secure-store` for S1. API:
  - `putSigningKey(publicKey, secret): Promise<void>`
  - `withSigningKey<T>(publicKey, prompt, fn: (secret) => Promise<T>): Promise<T>` reads the
    seed (the OS shows the prompt), runs `fn`, and drops the reference. The seed never goes
    into a module-level variable.
  - `deleteSigningKey(publicKey)` and `wipeAll()`
  - `getKeyStatus(publicKey): 'ok' | 'invalidated' | 'missing'`
- `MultiAccountService` keeps account metadata in AsyncStorage. `switchAccount` only changes
  `activePublicKey` and no longer loads the secret. `signTransaction` calls
  `withSigningKey(active, …, secret => Keypair.fromSecret(secret).sign(tx))` using
  `@stellar/stellar-sdk`, which replaces the stub.
- `mobile/src/context/SecurityContext.tsx` exposes `{ locked, keysInvalidated, wipe() }` and
  shows a "Your biometrics changed. Re-import your wallet" screen.

#### Biometric gate for signing
- The gate is the OS prompt that `SecureStore.getItemAsync(key, { requireAuthentication: true,
  authenticationPrompt })` triggers. The JS `authenticateBiometric()` pre-check stays only as
  a UX hint (for example, hiding the "sign" button when nothing is enrolled). It is not the
  security boundary.
- Add `expo-local-authentication` to `mobile/package.json` (this fixes the always-fails bug
  described above).
- The prompt text includes the amount and destination, so a user can tell what they are
  approving.
- Every signature gets a prompt. No auth-validity window, so one unlock cannot be reused for
  several signatures.

#### Wipe on enrollment change
- iOS: with `requireAuthentication`, the item is bound to the *current* biometric set, so
  adding or removing a fingerprint or face makes the item unreadable.
- Android: the Keystore key is created with biometric-enrollment invalidation, so a read fails
  with a key-invalidated error.
- Both platforms: `SecureKeyStore` maps that error to `getKeyStatus() === 'invalidated'`,
  deletes the dead item, emits `security.key_invalidated`, and `SecurityContext` sends the
  user to re-import. A wallet that cannot be recovered without the seed must warn the user
  **at creation** to back the seed up. The app cannot recover it after an enrollment change.
- Verify both platforms' invalidation behaviour against the pinned `expo-secure-store`
  version. Bump the version if invalidation is not on by default.

#### Events (telemetry, no secret material)
`security.key_stored`, `security.key_read`, `security.sign_prompt_{shown,ok,cancelled,failed}`,
`security.key_invalidated`, `security.wipe`. These go through `telemetryCollector` with the
public key hashed.

#### Failure modes
| Failure | Behaviour |
|---|---|
| No passcode or biometrics on device | Refuse to create or import a signing key, and explain why. Do not fall back to an unprotected store. |
| User cancels prompt | `signTransaction` rejects with `SigningCancelledError`. Tipping and payment flows roll back (see #1789). |
| Key invalidated | Status becomes `invalidated` and the user is sent to re-import. Never retry in a loop. |
| SecureStore throws for other reasons | Show the error. Never swallow it (today `storeEncryptedKey` swallows errors with `catch {}`, so `addAccount` reports success without having stored anything). |
| Concurrent sign | The existing `signingLock` stays. The second caller gets a clear error. |

#### Migration
On first launch after upgrade, for each `keystore_<pk>` entry with no options: read it,
rewrite it under `signing_key_v2_<pk>` with S1 options (one prompt per account), delete the
old entry, and emit `security.key_migrated`. If the migration is cancelled, keep the old
entry and try again on the next launch.

### Threat model (to include in the PR)
| Threat | Mitigated? |
|---|---|
| Stolen **locked** phone | Yes. S1 items need the passcode or biometrics, and the Keychain/Keystore enforces it. |
| Stolen **unlocked** phone (attacker holds it) | Partly. Each signature needs a fresh biometric prompt. The attacker can still read S2 and S3 (messages, session), so session tokens should stay short-lived. |
| Backup or iCloud restore to another device | Yes. `THIS_DEVICE_ONLY` on all classes. |
| Malicious or patched JS bundle (for example via OTA) | Partly. It cannot skip the OS prompt, but it could show a misleading prompt or swap the transaction. Keep OTA code signing on. |
| Rooted or jailbroken device with runtime hooking | No (out of scope). Document it. Optional root detection telemetry. |
| Seed lingering in JS memory | Reduced. It is only in scope inside `withSigningKey`. JS strings cannot be zeroed, so document this. |

Note on "hardware-backed": Android Keystore keys are TEE- or StrongBox-backed where the device
supports it. On iOS, Keychain items are encrypted with keys protected by the Secure Enclave,
but the seed itself is not generated inside the Enclave, because Ed25519 is not supported
there. The README must say this honestly.

### Files Involved
- `mobile/src/services/security/SecureKeyStore.ts` (new)
- [mobile/src/services/MultiAccountService.ts](../../mobile/src/services/MultiAccountService.ts)
- [mobile/src/services/BiometricAuthService.ts](../../mobile/src/services/BiometricAuthService.ts)
- `mobile/src/context/SecurityContext.tsx` (new), [mobile/src/context/index.ts](../../mobile/src/context/index.ts)
- [mobile/src/store/authStore.ts](../../mobile/src/store/authStore.ts), [mobile/src/services/WalletConnectService.ts](../../mobile/src/services/WalletConnectService.ts) (explicit accessibility class)
- [mobile/src/messaging/key-store.ts](../../mobile/src/messaging/key-store.ts) (fix the misleading comment)
- [mobile/package.json](../../mobile/package.json) (`expo-local-authentication`, `@stellar/stellar-sdk`)
- [mobile/README.md](../../mobile/README.md) (security section and threat model link)

### Test plan (Jest, `jest-expo`, mocked `expo-secure-store` and `expo-local-authentication`)
- **Main path:** `putSigningKey` passes `requireAuthentication: true` and
  `WHEN_PASSCODE_SET_THIS_DEVICE_ONLY`. `signTransaction` returns a real signed XDR that
  verifies against the public key.
- **Edge cases:**
  - The mock store throws a key-invalidated error, so the status becomes `invalidated`, the
    item is deleted, the event is emitted, and the call rejects.
  - The user cancels the prompt, so the call rejects with `SigningCancelledError` and
    `signingLock` is released.
  - Two concurrent `signTransaction` calls: the second rejects.
  - The device has no passcode, so `putSigningKey` refuses.
- **Negative (privileged path):** `switchAccount` never reads S1. Assert that `getItemAsync`
  is not called with `signing_key_v2_*`.
- **Regressions:**
  - `addAccount` rejects when SecureStore `setItemAsync` throws (today it silently succeeds).
  - Biometric support works when `expo-local-authentication` is installed (today the dynamic
    import always fails).
- **Migration:** a legacy `keystore_<pk>` entry is rewritten with S1 options and the old entry
  is deleted.

### Action Items
- [ ] Design note and threat model in the PR description
- [ ] `SecureKeyStore` with `requireAuthentication` for signing keys
- [ ] Real signing via `@stellar/stellar-sdk` inside `withSigningKey`, with the OS biometric gate
- [ ] Wipe on enrollment change, plus `SecurityContext` re-import UX
- [ ] Migration from unprotected `keystore_*` entries
- [ ] Add `expo-local-authentication` dependency
- [ ] Explicit accessibility classes for S2 and S3
- [ ] Update `mobile/README.md`
- [ ] Tests above. `pnpm typecheck && pnpm lint && pnpm test` green.

### Deferred / out of scope
- Root or jailbreak detection (separate issue)
- Hardware wallet or MPC signing
- Seed backup and export UX (needs its own issue, because enrollment-change wipe makes backups
  mandatory)
