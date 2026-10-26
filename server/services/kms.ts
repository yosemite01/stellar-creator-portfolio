/**
 * Key Management Service abstraction — Issue #1347
 *
 * Supports three providers selectable via `KMS_PROVIDER`:
 *   env   – environment variables (default; local dev / CI)
 *   aws   – AWS Secrets Manager with CMK envelope encryption
 *   azure – Azure Key Vault with managed-identity auth
 *
 * Security rules enforced throughout:
 *  - Secret *values* are NEVER present in thrown errors, logs, or stack traces.
 *  - Errors expose only the secret *name* and an opaque provider error code.
 *  - The in-process cache avoids redundant API round-trips per process lifetime.
 *  - Cache entries are invalidated on rotation so the next call fetches fresh.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SecretName =
  | 'STELLAR_ADMIN_SECRET'
  | 'STELLAR_FEE_ACCOUNT_SECRET'
  | 'JWT_SECRET'
  | 'ENCRYPTION_KEY'
  | 'STRIPE_SECRET_KEY'
  | 'STRIPE_WEBHOOK_SECRET'
  | 'NEXTAUTH_SECRET'
  | 'WEBHOOK_SECRET';

/** Provider identifiers understood by this module. */
export type KmsProviderName = 'env' | 'aws' | 'azure';

export interface KmsProvider {
  getSecret(name: SecretName): Promise<string>;
}

// ---------------------------------------------------------------------------
// AWS Secrets Manager provider
// ---------------------------------------------------------------------------

/**
 * Lazily imports the AWS SDK so non-AWS deployments pay zero bundle cost.
 * The CMK enforces envelope encryption; only the Secrets Manager service
 * principal and the deployer role (via kms:ViaService condition) can decrypt.
 */
async function awsGetSecret(name: SecretName): Promise<string> {
  const { SecretsManagerClient, GetSecretValueCommand } = await import(
    '@aws-sdk/client-secrets-manager'
  );

  const prefix = process.env.KMS_SECRET_PREFIX ?? 'stellar/prod';
  const secretId = `${prefix}/${name}`;
  const region = process.env.AWS_REGION ?? 'us-east-1';

  const client = new SecretsManagerClient({ region });

  let response;
  try {
    response = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
  } catch (err) {
    // Deliberately expose only the secret name and AWS error code — never the value.
    const code = (err as { name?: string }).name ?? 'UnknownError';
    throw new Error(`KMS[aws]: failed to retrieve secret "${name}" (code: ${code})`);
  }

  const value = response.SecretString;
  if (!value) {
    throw new Error(`KMS[aws]: secret "${name}" resolved but contains no string value`);
  }

  return value;
}

// ---------------------------------------------------------------------------
// Azure Key Vault provider
// ---------------------------------------------------------------------------


interface AzureSecretClient {
  getSecret(name: string): Promise<{ value?: string }>;
  setSecret(name: string, value: string): Promise<unknown>;
}

interface AzureSdk {
  SecretClient: new (vaultUrl: string, credential: unknown) => AzureSecretClient;
  DefaultAzureCredential: new () => unknown;
}

/**
 * Loads the Azure Key Vault SDK on demand. The packages are only needed
 * when KMS_PROVIDER=azure, so they are not dependencies of the app; the
 * specifiers are held in variables to keep the bundler and tsc from
 * resolving them at build time.
 */
async function loadAzureSdk(): Promise<AzureSdk> {
  const secrets = '@azure/keyvault-secrets';
  const identity = '@azure/identity';
  try {
    const [{ SecretClient }, { DefaultAzureCredential }] = await Promise.all([
      import(/* webpackIgnore: true */ /* turbopackIgnore: true */ secrets),
      import(/* webpackIgnore: true */ /* turbopackIgnore: true */ identity),
    ]);
    return { SecretClient, DefaultAzureCredential };
  } catch {
    throw new Error(
      'KMS[azure]: install @azure/keyvault-secrets and @azure/identity to use KMS_PROVIDER=azure',
    );
  }
}

/**
 * Lazily imports the Azure SDK so non-Azure deployments pay zero bundle cost.
 * Uses DefaultAzureCredential which honours managed identity in production
 * and falls back to env-var credentials (`AZURE_CLIENT_ID`, `AZURE_TENANT_ID`,
 * `AZURE_CLIENT_SECRET`) for CI / local use.
 *
 * Required env vars when KMS_PROVIDER=azure:
 *   AZURE_KEYVAULT_URL  – e.g. https://my-vault.vault.azure.net
 */
async function azureGetSecret(name: SecretName): Promise<string> {
  const vaultUrl = process.env.AZURE_KEYVAULT_URL;
  if (!vaultUrl) {
    throw new Error(
      'KMS[azure]: AZURE_KEYVAULT_URL is not set — required when KMS_PROVIDER=azure',
    );
  }

  // Dynamic imports keep Azure packages out of non-Azure bundles.
  const { SecretClient, DefaultAzureCredential } = await loadAzureSdk();

  // Azure secret names may not contain underscores — map to hyphens.
  const secretName = name.replace(/_/g, '-').toLowerCase();

  const client = new SecretClient(vaultUrl, new DefaultAzureCredential());

  let secret;
  try {
    secret = await client.getSecret(secretName);
  } catch (err) {
    // Expose only the normalised secret name and opaque error code.
    const code = (err as { code?: string }).code ?? 'UnknownError';
    throw new Error(`KMS[azure]: failed to retrieve secret "${name}" (code: ${code})`);
  }

  const value = secret.value;
  if (!value) {
    throw new Error(`KMS[azure]: secret "${name}" resolved but contains no value`);
  }

  return value;
}

// ---------------------------------------------------------------------------
// Environment-variable fallback provider (local / CI)
// ---------------------------------------------------------------------------

function envGetSecret(name: SecretName): string {
  const value = process.env[name];
  if (!value) {
    // No value emitted in the error — only the name.
    throw new Error(`KMS[env]: secret "${name}" is not set in environment variables`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// In-process cache
// ---------------------------------------------------------------------------

const cache = new Map<SecretName, string>();

// ---------------------------------------------------------------------------
// Provider resolution
// ---------------------------------------------------------------------------

function resolveProvider(): KmsProviderName {
  const raw = (process.env.KMS_PROVIDER ?? 'env').toLowerCase();
  if (raw === 'aws' || raw === 'azure' || raw === 'env') return raw;
  // Unknown provider — default to env and warn (without leaking config values).
  console.warn(`KMS: unknown KMS_PROVIDER "${raw}", falling back to "env"`);
  return 'env';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Retrieve a managed secret by name.
 *
 * Routes to the active provider (aws | azure | env) determined by `KMS_PROVIDER`.
 * Results are cached per process to minimise API round-trips.
 *
 * @param name - The logical secret name (see `SecretName` union).
 * @returns The plaintext secret value.
 * @throws An error exposing only the secret *name* and an opaque error code.
 */
export async function getSecret(name: SecretName): Promise<string> {
  const cached = cache.get(name);
  if (cached !== undefined) return cached;

  const provider = resolveProvider();

  let value: string;
  switch (provider) {
    case 'aws':
      value = await awsGetSecret(name);
      break;
    case 'azure':
      value = await azureGetSecret(name);
      break;
    default:
      value = envGetSecret(name);
  }

  cache.set(name, value);
  return value;
}

/**
 * Rotate a secret: clear the cache entry so the next call fetches a fresh value.
 *
 * Call this after triggering rotation in Secrets Manager or Key Vault.
 * Does not make any network calls itself — rotation must be initiated
 * out-of-band via the provider console or CLI.
 */
export function invalidateSecret(name: SecretName): void {
  cache.delete(name);
}

/**
 * Invalidate all cached secrets simultaneously.
 *
 * Use when a full key rotation has been completed across all secrets, e.g.
 * after a suspected credential compromise.
 */
export function invalidateAllSecrets(): void {
  cache.clear();
}

/**
 * Validate that all required secrets are resolvable at process startup.
 *
 * Aggregates failures so operators receive a single error listing every
 * missing secret name rather than discovering them one at a time.
 *
 * @throws An error listing the *names* of unresolvable secrets only.
 */
export async function validateSecrets(required: SecretName[]): Promise<void> {
  const missing: string[] = [];

  await Promise.all(
    required.map(async (name) => {
      try {
        await getSecret(name);
      } catch {
        // Record the name only — never capture the error message which might
        // contain partial secret data from upstream providers.
        missing.push(name);
      }
    }),
  );

  if (missing.length > 0) {
    throw new Error(
      `KMS: the following required secrets could not be resolved: ${missing.join(', ')}`,
    );
  }
}

/**
 * Provision (create or update) a secret value in the active remote provider.
 *
 * Supported only for `aws` and `azure` providers.  The `env` provider is
 * read-only from this module's perspective — set environment variables
 * through your process manager instead.
 *
 * @param name  - Logical secret name.
 * @param value - New plaintext value to store.  Must be non-empty.
 * @throws If the active provider is `env`, or if the remote update fails.
 */
export async function provisionSecret(name: SecretName, value: string): Promise<void> {
  if (!value) {
    throw new Error(`KMS: refusing to provision an empty value for secret "${name}"`);
  }

  const provider = resolveProvider();

  if (provider === 'aws') {
    const { SecretsManagerClient, PutSecretValueCommand } = await import(
      '@aws-sdk/client-secrets-manager'
    );
    const prefix = process.env.KMS_SECRET_PREFIX ?? 'stellar/prod';
    const secretId = `${prefix}/${name}`;
    const region = process.env.AWS_REGION ?? 'us-east-1';
    const client = new SecretsManagerClient({ region });

    try {
      await client.send(new PutSecretValueCommand({ SecretId: secretId, SecretString: value }));
    } catch (err) {
      const code = (err as { name?: string }).name ?? 'UnknownError';
      throw new Error(`KMS[aws]: failed to provision secret "${name}" (code: ${code})`);
    }

    // Invalidate cache so the next read fetches the newly written value.
    invalidateSecret(name);
    return;
  }

  if (provider === 'azure') {
    const vaultUrl = process.env.AZURE_KEYVAULT_URL;
    if (!vaultUrl) {
      throw new Error('KMS[azure]: AZURE_KEYVAULT_URL must be set to provision secrets');
    }
    const { SecretClient, DefaultAzureCredential } = await loadAzureSdk();

    const secretName = name.replace(/_/g, '-').toLowerCase();
    const client = new SecretClient(vaultUrl, new DefaultAzureCredential());

    try {
      await client.setSecret(secretName, value);
    } catch (err) {
      const code = (err as { code?: string }).code ?? 'UnknownError';
      throw new Error(`KMS[azure]: failed to provision secret "${name}" (code: ${code})`);
    }

    invalidateSecret(name);
    return;
  }

  throw new Error(
    'KMS[env]: provisionSecret is not supported for the "env" provider — ' +
      'set the variable directly in your environment or process manager',
  );
}

/**
 * Rotate a deployer key by:
 *  1. Generating a new value via the provided `generator` callback.
 *  2. Provisioning it in the active remote provider.
 *  3. Invalidating the local cache entry.
 *
 * The generator is called with no arguments and must return a non-empty string.
 * This is intentionally generic — use it with a Stellar keypair generator,
 * `crypto.randomBytes`, or any deterministic rotation strategy.
 *
 * @example
 * ```ts
 * import { Keypair } from '@stellar/stellar-sdk';
 * await rotateSecret('STELLAR_ADMIN_SECRET', () => Keypair.random().secret());
 * ```
 */
export async function rotateSecret(
  name: SecretName,
  generator: () => string | Promise<string>,
): Promise<void> {
  const newValue = await generator();
  await provisionSecret(name, newValue);
}
