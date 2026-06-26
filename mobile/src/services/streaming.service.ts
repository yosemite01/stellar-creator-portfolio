import {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
  mediaDevices,
} from 'react-native-webrtc';
import {
  SignalingClient,
  fetchSignalingConfig,
  SignalingServerMessage,
} from './SignalingClient';

export type StreamRole = 'host' | 'viewer';
export type StreamState = 'idle' | 'connecting' | 'connected' | 'error' | 'ended';

export interface StreamSession {
  roomId: string;
  role: StreamRole;
  state: StreamState;
  error?: string;
  participantCount: number;
  peerConnection: RTCPeerConnection | null;
  localStream?: MediaStream | null;
}

export interface StreamCallbacks {
  onStateChange?: (state: StreamState) => void;
  onParticipantCount?: (count: number) => void;
  onLocalStream?: (stream: MediaStream) => void;
  onRemoteStream?: (stream: MediaStream) => void;
  onTip?: (tip: { from: string; amount: string; asset: string }) => void;
  onStreamEnded?: () => void;
  onError?: (message: string) => void;
}

/**
 * WebRTC streaming service connected to app/api/signaling and server/signaling.ts.
 * Host creates offer; viewer sends answer. Supports reconnect and live tips.
 */
export class WebRTCStreamingService {
  private peerConnection: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private signaling: SignalingClient | null = null;
  private peerId = '';
  private remotePeerId: string | null = null;
  private participantCount = 0;
  private state: StreamState = 'idle';
  private role: StreamRole;
  private callbacks: StreamCallbacks;
  private wsUrl = '';
  private makingOffer = false;

  constructor(
    private readonly signalingServerUrl: string,
    private readonly roomId: string,
    role: StreamRole,
    callbacks: StreamCallbacks = {},
  ) {
    this.role = role;
    this.callbacks = callbacks;
  }

  private setState(next: StreamState): void {
    this.state = next;
    this.callbacks.onStateChange?.(next);
  }

  private setParticipantCount(count: number): void {
    this.participantCount = count;
    this.callbacks.onParticipantCount?.(count);
  }

  async start(): Promise<StreamSession> {
    try {
      this.setState('connecting');

      const config = await fetchSignalingConfig(this.signalingServerUrl);
      this.peerId = config.peerId;
      this.wsUrl = config.signalingWsUrl;

      this.peerConnection = new RTCPeerConnection({ iceServers: config.iceServers as RTCConfiguration['iceServers'] });
      this.registerPeerConnectionHandlers();

      if (this.role === 'host') {
        this.localStream = await mediaDevices.getUserMedia({
          audio: true,
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 },
          },
        });
        this.localStream.getTracks().forEach((track) => {
          this.peerConnection!.addTrack(track, this.localStream!);
        });
        this.callbacks.onLocalStream?.(this.localStream);
      } else {
        this.peerConnection.addTransceiver('video', { direction: 'recvonly' });
        this.peerConnection.addTransceiver('audio', { direction: 'recvonly' });
      }

      this.signaling = new SignalingClient(
        this.signalingServerUrl,
        this.roomId,
        this.peerId,
        (msg) => void this.handleSignalingMessage(msg),
        (connected) => {
          if (!connected && this.state !== 'ended') {
            this.setState('connecting');
          }
        },
      );

      await this.signaling.connect(this.wsUrl);
      this.signaling.startHttpPolling();

      return this.getSession();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start stream';
      this.setState('error');
      this.callbacks.onError?.(message);
      throw error;
    }
  }

  private registerPeerConnectionHandlers(): void {
    if (!this.peerConnection) return;

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate && this.remotePeerId && this.signaling) {
        this.signaling.send({
          type: 'ice',
          to: this.remotePeerId,
          candidate: event.candidate.toJSON(),
        });
      }
    };

    this.peerConnection.ontrack = (event) => {
      if (event.streams[0]) {
        this.callbacks.onRemoteStream?.(event.streams[0]);
        this.setState('connected');
      }
    };

    this.peerConnection.onconnectionstatechange = () => {
      const pcState = this.peerConnection?.connectionState;
      if (pcState === 'connected') {
        this.setState('connected');
      } else if (pcState === 'failed' || pcState === 'disconnected') {
        void this.attemptReconnect();
      }
    };
  }

  private async handleSignalingMessage(message: SignalingServerMessage): Promise<void> {
    switch (message.type) {
      case 'joined': {
        this.setParticipantCount(message.peers.length);
        if (this.role === 'host') {
          for (const peer of message.peers) {
            await this.createAndSendOffer(peer);
          }
        }
        break;
      }
      case 'peer-joined': {
        this.setParticipantCount(this.participantCount + 1);
        if (this.role === 'host') {
          await this.createAndSendOffer(message.peerId);
        }
        break;
      }
      case 'peer-left': {
        this.setParticipantCount(Math.max(0, this.participantCount - 1));
        if (this.role === 'viewer') {
          this.setState('ended');
          this.callbacks.onStreamEnded?.();
        }
        break;
      }
      case 'offer': {
        if (this.role !== 'viewer' || !this.peerConnection) return;
        this.remotePeerId = message.from;
        await this.peerConnection.setRemoteDescription(new RTCSessionDescription(message.sdp));
        const answer = await this.peerConnection.createAnswer();
        await this.peerConnection.setLocalDescription(answer);
        this.signaling?.send({ type: 'answer', to: message.from, sdp: answer });
        break;
      }
      case 'answer': {
        if (this.role !== 'host' || !this.peerConnection) return;
        await this.peerConnection.setRemoteDescription(new RTCSessionDescription(message.sdp));
        break;
      }
      case 'ice': {
        if (!this.peerConnection || !message.candidate) return;
        try {
          await this.peerConnection.addIceCandidate(new RTCIceCandidate(message.candidate));
        } catch {
          // ICE candidates can arrive before remote description is set
        }
        break;
      }
      case 'tip': {
        if (this.role === 'host') {
          this.callbacks.onTip?.({
            from: message.from,
            amount: message.amount,
            asset: message.asset,
          });
        }
        break;
      }
      case 'error': {
        this.callbacks.onError?.(message.message);
        break;
      }
      default:
        break;
    }
  }

  private async createAndSendOffer(peerId: string): Promise<void> {
    if (!this.peerConnection || this.makingOffer) return;
    this.makingOffer = true;
    this.remotePeerId = peerId;

    try {
      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);
      this.signaling?.send({ type: 'offer', to: peerId, sdp: offer });
    } finally {
      this.makingOffer = false;
    }
  }

  sendTipNotification(toPeerId: string, amount: string, asset: string): void {
    this.signaling?.send({ type: 'tip', to: toPeerId, amount, asset });
  }

  private async attemptReconnect(): Promise<void> {
    if (this.state === 'ended' || !this.signaling) return;

    this.setState('connecting');
    this.peerConnection?.close();
    this.peerConnection = new RTCPeerConnection({
      iceServers: (await fetchSignalingConfig(this.signalingServerUrl, this.peerId)).iceServers as RTCConfiguration['iceServers'],
    });
    this.registerPeerConnectionHandlers();

    if (this.role === 'host' && this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        this.peerConnection!.addTrack(track, this.localStream!);
      });
    } else if (this.role === 'viewer') {
      this.peerConnection.addTransceiver('video', { direction: 'recvonly' });
      this.peerConnection.addTransceiver('audio', { direction: 'recvonly' });
    }

    try {
      await this.signaling.connect(this.wsUrl);
    } catch {
      this.callbacks.onError?.('Reconnection failed');
    }
  }

  async stopStreaming(): Promise<void> {
    this.setState('ended');
    this.signaling?.disconnect();
    this.signaling = null;

    this.localStream?.getTracks().forEach((track) => track.stop());
    this.localStream = null;

    this.peerConnection?.getSenders().forEach((sender) => sender.track?.stop());
    this.peerConnection?.close();
    this.peerConnection = null;
  }

  getSession(): StreamSession {
    return {
      roomId: this.roomId,
      role: this.role,
      state: this.state,
      participantCount: this.participantCount,
      peerConnection: this.peerConnection,
      localStream: this.localStream,
    };
  }

  static isWebRTCAvailable(): boolean {
    try {
      return RTCPeerConnection !== undefined && mediaDevices !== undefined;
    } catch {
      return false;
    }
  }
}
