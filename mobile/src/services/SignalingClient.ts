/**
 * WebSocket signaling client matching server/signaling.ts protocol.
 * Falls back to HTTP POST + poll via app/api/signaling/route.ts.
 */

export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface SignalingConfig {
  iceServers: IceServerConfig[];
  signalingWsUrl: string;
  peerId: string;
}

export type SignalingServerMessage =
  | { type: 'joined'; peerId: string; peers: string[]; iceServers: IceServerConfig[] }
  | { type: 'peer-joined'; peerId: string }
  | { type: 'peer-left'; peerId: string }
  | { type: 'offer'; from: string; sdp: RTCSessionDescriptionInit }
  | { type: 'answer'; from: string; sdp: RTCSessionDescriptionInit }
  | { type: 'ice'; from: string; candidate: RTCIceCandidateInit }
  | { type: 'tip'; from: string; amount: string; asset: string }
  | { type: 'error'; message: string }
  | { type: 'pong'; ts: number };

export type SignalingClientMessage =
  | { type: 'join'; roomId: string; peerId: string }
  | { type: 'offer'; to: string; sdp: RTCSessionDescriptionInit }
  | { type: 'answer'; to: string; sdp: RTCSessionDescriptionInit }
  | { type: 'ice'; to: string; candidate: RTCIceCandidateInit }
  | { type: 'tip'; to: string; amount: string; asset: string }
  | { type: 'leave' };

export class SignalingClient {
  private ws: WebSocket | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastPollTs = 0;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(
    private readonly baseUrl: string,
    private readonly roomId: string,
    private readonly peerId: string,
    private readonly onMessage: (msg: SignalingServerMessage) => void,
    private readonly onConnectionChange?: (connected: boolean) => void,
  ) {}

  async connect(wsUrl: string): Promise<void> {
    if (this.disposed) return;

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          this.reconnectAttempts = 0;
          this.onConnectionChange?.(true);
          this.send({ type: 'join', roomId: this.roomId, peerId: this.peerId });
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(String(event.data)) as SignalingServerMessage;
            this.onMessage(msg);
          } catch {
            // ignore malformed messages
          }
        };

        this.ws.onclose = () => {
          this.onConnectionChange?.(false);
          if (!this.disposed) {
            this.scheduleReconnect(wsUrl);
          }
        };

        this.ws.onerror = () => {
          reject(new Error('WebSocket connection failed'));
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  startHttpPolling(): void {
    this.stopHttpPolling();
    this.pollTimer = setInterval(() => {
      void this.pollMessages();
    }, 1000);
  }

  private async pollMessages(): Promise<void> {
    try {
      const url = `${this.baseUrl}/api/signaling?roomId=${encodeURIComponent(this.roomId)}&peerId=${encodeURIComponent(this.peerId)}&since=${this.lastPollTs}`;
      const response = await fetch(url);
      if (!response.ok) return;

      const data = (await response.json()) as {
        messages?: Array<{
          type: string;
          peerId: string;
          sdp?: string;
          candidate?: RTCIceCandidateInit;
          amount?: string;
          asset?: string;
          ts: number;
        }>;
      };

      for (const entry of data.messages ?? []) {
        this.lastPollTs = Math.max(this.lastPollTs, entry.ts);
        this.dispatchHttpMessage(entry);
      }
    } catch {
      // polling is best-effort
    }
  }

  private dispatchHttpMessage(entry: {
    type: string;
    peerId: string;
    sdp?: string;
    candidate?: RTCIceCandidateInit;
    amount?: string;
    asset?: string;
  }): void {
    switch (entry.type) {
      case 'offer':
        if (entry.sdp) {
          this.onMessage({ type: 'offer', from: entry.peerId, sdp: { type: 'offer', sdp: entry.sdp } });
        }
        break;
      case 'answer':
        if (entry.sdp) {
          this.onMessage({ type: 'answer', from: entry.peerId, sdp: { type: 'answer', sdp: entry.sdp } });
        }
        break;
      case 'ice':
        if (entry.candidate) {
          this.onMessage({ type: 'ice', from: entry.peerId, candidate: entry.candidate });
        }
        break;
      case 'tip':
        this.onMessage({
          type: 'tip',
          from: entry.peerId,
          amount: entry.amount ?? '0',
          asset: entry.asset ?? 'XLM',
        });
        break;
      default:
        break;
    }
  }

  send(message: SignalingClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
      return;
    }

    void this.sendHttp(message);
  }

  private async sendHttp(message: SignalingClientMessage): Promise<void> {
    if (message.type === 'join' || message.type === 'leave') return;

    const body: Record<string, unknown> = {
      roomId: this.roomId,
      peerId: this.peerId,
      type: message.type,
    };

    if ('to' in message) body.to = message.to;
    if (message.type === 'offer' || message.type === 'answer') body.sdp = message.sdp.sdp;
    if (message.type === 'ice') body.candidate = message.candidate;
    if (message.type === 'tip') {
      body.amount = message.amount;
      body.asset = message.asset;
    }

    try {
      await fetch(`${this.baseUrl}/api/signaling`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      // best-effort fallback
    }
  }

  private scheduleReconnect(wsUrl: string): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.startHttpPolling();
      return;
    }

    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 10000);
    this.reconnectAttempts += 1;

    this.reconnectTimer = setTimeout(() => {
      void this.connect(wsUrl).catch(() => {
        this.scheduleReconnect(wsUrl);
      });
    }, delay);
  }

  disconnect(): void {
    this.disposed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.stopHttpPolling();

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.send({ type: 'leave' });
    }
    this.ws?.close();
    this.ws = null;
  }

  private stopHttpPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}

export async function fetchSignalingConfig(baseUrl: string, peerId?: string): Promise<SignalingConfig> {
  const query = peerId ? `?peerId=${encodeURIComponent(peerId)}` : '';
  const response = await fetch(`${baseUrl}/api/signaling${query}`);
  if (!response.ok) {
    throw new Error('Failed to fetch signaling configuration');
  }
  return response.json() as Promise<SignalingConfig>;
}
