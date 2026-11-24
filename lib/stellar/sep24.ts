/**
 * lib/stellar/sep24.ts
 *
 * SEP-24 interactive deposit/withdraw client (Issue #1393).
 *
 * Both SEP-24 components were TODO stubs: `components/payments/sep24-flow.tsx`
 * only tracked UI state, and `components/payments/sep24-payment-form.tsx` logged the form
 * payload and returned. Neither ever contacted an anchor.
 *
 * SEP-24 is a three-part protocol and this module covers all three:
 *
 *   1. **Discovery** — read the anchor's `TRANSFER_SERVER` from its
 *      `stellar.toml`, so a caller supplies a domain rather than hard-coding
 *      an endpoint that can move.
 *   2. **Initiation** — `POST /transactions/{deposit,withdraw}/interactive`,
 *      which returns a URL the user completes in a popup.
 *   3. **Polling** — `GET /transaction?id=…` until the status is terminal.
 *
 * The third part is the one that is easy to skip and impossible to omit: the
 * anchor does its work out of band, so the popup closing tells you nothing
 * about whether the transfer happened.
 *
 * @see https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0024.md
 */

/** Terminal and non-terminal statuses SEP-24 defines for a transaction. */
export type Sep24Status =
  | 'incomplete'
  | 'pending_user_transfer_start'
  | 'pending_user_transfer_complete'
  | 'pending_external'
  | 'pending_anchor'
  | 'pending_stellar'
  | 'pending_trust'
  | 'pending_user'
  | 'completed'
  | 'refunded'
  | 'expired'
  | 'no_market'
  | 'too_small'
  | 'too_large'
  | 'error';

/**
 * Statuses after which polling must stop.
 *
 * `refunded`, `expired` and the `too_small`/`too_large`/`no_market` rejections
 * are terminal too. Treating only `completed` and `error` as terminal is the
 * bug that leaves a flow spinning forever on a transfer the anchor has already
 * given up on.
 */
const TERMINAL_STATUSES: ReadonlySet<Sep24Status> = new Set<Sep24Status>([
  'completed',
  'refunded',
  'expired',
  'no_market',
  'too_small',
  'too_large',
  'error',
]);

export function isTerminalStatus(status: Sep24Status): boolean {
  return TERMINAL_STATUSES.has(status);
}

/** True when a terminal status means the transfer succeeded. */
export function isSuccessStatus(status: Sep24Status): boolean {
  return status === 'completed';
}

/**
 * Human-readable instructions for a status, so the form can render a clear
 * message instead of a raw protocol token. `pending_user_transfer_start` is
 * the one that most needs this: the anchor is waiting on the user to send
 * funds out of band, and without instructions the flow looks stuck.
 */
export function describeStatus(status: Sep24Status): string {
  switch (status) {
    case 'incomplete':
      return 'The anchor needs more information to continue.';
    case 'pending_user_transfer_start':
      return 'Send the funds to the anchor using the instructions in the anchor window to continue.';
    case 'pending_user_transfer_complete':
      return 'Waiting for the anchor to confirm receipt of your funds.';
    case 'pending_external':
      return 'Waiting for the external payment network to confirm the transfer.';
    case 'pending_anchor':
      return 'The anchor is processing your transaction.';
    case 'pending_stellar':
      return 'Waiting for the Stellar network to confirm the transaction.';
    case 'pending_trust':
      return 'Add a trustline for the asset to continue.';
    case 'pending_user':
      return 'The anchor is waiting on you to complete a step in the anchor window.';
    case 'completed':
      return 'Transaction completed.';
    case 'refunded':
      return 'The transaction was refunded by the anchor.';
    case 'expired':
      return 'The transaction expired before it was completed.';
    case 'no_market':
      return 'The anchor has no market for this asset pair.';
    case 'too_small':
      return 'The amount is below the anchor\u2019s minimum.';
    case 'too_large':
      return 'The amount is above the anchor\u2019s maximum.';
    case 'error':
      return 'The anchor reported an error for this transaction.';
    default:
      return 'Unknown transaction status.';
  }
}

export interface Sep24Transaction {
  id: string;
  kind: 'deposit' | 'withdrawal';
  status: Sep24Status;
  amount_in?: string;
  amount_out?: string;
  amount_fee?: string;
  stellar_transaction_id?: string;
  external_transaction_id?: string;
  message?: string;
  started_at?: string;
  completed_at?: string;
  refunded?: boolean;
  more_info_url?: string;
}

export interface InteractiveResponse {
  /** Always "interactive_customer_info_needed" for SEP-24. */
  type: string;
  /** The URL to open for the user to complete the flow. */
  url: string;
  /** Anchor's transaction id, used for polling. */
  id: string;
}

/** Raised for any anchor-side failure, carrying the status code. */
export class Sep24Error extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'Sep24Error';
  }
}

const DEFAULT_TIMEOUT_MS = 15_000;

/** `fetch` with a timeout, so a hung anchor cannot hang the caller forever. */
async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reads `TRANSFER_SERVER` out of an anchor's `stellar.toml`.
 *
 * Parsed with a targeted regex rather than a TOML library: this needs exactly
 * one top-level key, and adding a parser dependency to read one line is not a
 * trade worth making. `TRANSFER_SERVER_SEP0024` wins when present — SEP-24
 * defines it as the override for anchors that run separate SEP-6 and SEP-24
 * endpoints, and picking the wrong one sends the request to an API that speaks
 * a different protocol.
 */
export async function discoverTransferServer(homeDomain: string): Promise<string> {
  const domain = homeDomain.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const tomlUrl = `https://${domain}/.well-known/stellar.toml`;

  const response = await fetchWithTimeout(tomlUrl);
  if (!response.ok) {
    throw new Sep24Error(
      `Could not read stellar.toml from ${domain}`,
      response.status,
    );
  }

  const toml = await response.text();
  const read = (key: string) =>
    toml.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]+)"`, 'm'))?.[1];

  const transferServer = read('TRANSFER_SERVER_SEP0024') ?? read('TRANSFER_SERVER');
  if (!transferServer) {
    throw new Sep24Error(`${domain} does not advertise a SEP-24 TRANSFER_SERVER`);
  }

  return transferServer.replace(/\/+$/, '');
}

export interface StartInteractiveParams {
  transferServer: string;
  kind: 'deposit' | 'withdraw';
  assetCode: string;
  account: string;
  /** SEP-10 JWT. SEP-24 requires authentication for interactive endpoints. */
  authToken: string;
  amount?: string;
  lang?: string;
  /** Extra anchor-specific fields, passed through untouched. */
  extra?: Record<string, string>;
}

/**
 * Requests the interactive URL from the anchor.
 *
 * Sent as JSON. SEP-24 permits both JSON and multipart; JSON is used here
 * because multipart exists for file uploads (KYC documents), which the
 * interactive flow handles in its own popup rather than through this call.
 */
export async function startInteractiveFlow(
  params: StartInteractiveParams,
): Promise<InteractiveResponse> {
  const { transferServer, kind, assetCode, account, authToken, amount, lang, extra } =
    params;

  const endpoint = `${transferServer}/transactions/${kind}/interactive`;

  const body: Record<string, string> = {
    asset_code: assetCode,
    account,
    ...(amount ? { amount } : {}),
    ...(lang ? { lang } : {}),
    ...extra,
  };

  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    // Anchors put the reason in an `error` field; surfacing it beats a bare
    // status code, since "asset not supported" and "KYC required" need
    // completely different responses from the user.
    let detail = `Anchor rejected the ${kind} request (${response.status})`;
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload.error) detail = payload.error;
    } catch {
      // Non-JSON error body — keep the status-code message.
    }
    throw new Sep24Error(detail, response.status);
  }

  const payload = (await response.json()) as Partial<InteractiveResponse>;
  if (!payload.url || !payload.id) {
    throw new Sep24Error('Anchor response is missing `url` or `id`');
  }

  return { type: payload.type ?? 'interactive_customer_info_needed', url: payload.url, id: payload.id };
}

/** Fetches one transaction's current state. */
export async function fetchTransaction(params: {
  transferServer: string;
  id: string;
  authToken: string;
}): Promise<Sep24Transaction> {
  const url = `${params.transferServer}/transaction?id=${encodeURIComponent(params.id)}`;

  const response = await fetchWithTimeout(url, {
    headers: { Authorization: `Bearer ${params.authToken}` },
  });

  if (!response.ok) {
    throw new Sep24Error(
      `Could not read transaction ${params.id} (${response.status})`,
      response.status,
    );
  }

  const payload = (await response.json()) as { transaction?: Sep24Transaction };
  if (!payload.transaction) {
    throw new Sep24Error('Anchor response is missing `transaction`');
  }

  return payload.transaction;
}

export interface PollOptions {
  transferServer: string;
  id: string;
  authToken: string;
  /** Called on every poll, including the first. */
  onUpdate?: (transaction: Sep24Transaction) => void;
  /** Milliseconds between polls. Defaults to 3s. */
  intervalMs?: number;
  /** Abort signal so a closed popup can stop the loop. */
  signal?: AbortSignal;
}

/**
 * Polls a transaction until it reaches a terminal status.
 *
 * Resolves with the final transaction. Rejects only on transport errors or
 * abort — a terminal-but-failed status (e.g. `expired`) resolves, so the
 * caller can render the anchor's own reason rather than a generic failure.
 */
export async function pollTransaction(
  options: PollOptions,
): Promise<Sep24Transaction> {
  const { transferServer, id, authToken, onUpdate, intervalMs = 3_000, signal } =
    options;

  for (;;) {
    if (signal?.aborted) {
      throw new Sep24Error('Polling aborted');
    }

    const transaction = await fetchTransaction({ transferServer, id, authToken });
    onUpdate?.(transaction);

    if (isTerminalStatus(transaction.status)) {
      return transaction;
    }

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, intervalMs);
      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(new Sep24Error('Polling aborted'));
        },
        { once: true },
      );
    });
  }
}

/**
 * Polls until the transaction reaches a terminal status. Kept as the name the
 * SEP-24 flow component uses; see {@link pollTransaction}.
 */
export const pollUntilTerminal = pollTransaction;

/**
 * Opens the anchor's interactive URL in a popup. `closed` resolves once the
 * user closes it. Throws if the browser blocked the popup.
 */
export function openInteractiveWindow(url: string): { closed: Promise<void> } {
  const popup = window.open(url, 'sep24-interactive', 'width=500,height=700');

  if (!popup) {
    throw new Sep24Error('The anchor window was blocked. Allow popups and try again.');
  }

  const closed = new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      if (popup.closed) {
        clearInterval(timer);
        resolve();
      }
    }, 500);
  });

  return { closed };
}
