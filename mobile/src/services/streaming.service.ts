import {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
  mediaDevices,
  RTCView,
} from 'react-native-webrtc';

export type StreamRole = 'host' | 'viewer';
export type StreamState = 'idle' | 'connecting' | 'connected' | 'error' | 'ended';

export interface StreamSession {
  roomId: string;
  role: StreamRole;
  state: StreamState;
  error?: string;
  participantCount: number;
  peerConnection: RTCPeerConnection | null;
}

export interface SignalingMessage {
  type: 'offer' | 'answer' | 'ice-candidate';
  data: any;
}

/**
 * WebRTC streaming service for creator classes
 * Implements SDP/ICE signaling flow for peer-to-peer video
 * Supports both host (streaming) and viewer (receiving) modes
 */
export class WebRTCStreamingService {
  private peerConnections: Map<string, RTCPeerConnection> = new Map();
  private signalingServerUrl: string;
  private accessToken: string;
  private roomId: string;

  constructor(signalingServerUrl: string, accessToken: string, roomId: string) {
    this.signalingServerUrl = signalingServerUrl;
    this.accessToken = accessToken;
    this.roomId = roomId;
  }

  /**
   * Initialize streaming session for host (creator)
   * Sets up local video preview and listens for viewer connections
   */
  async initializeHost(): Promise<StreamSession> {
    try {
      // Get local media stream from device camera
      const stream = await mediaDevices.getUserMedia({
        audio: true,
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        },
      });

      // Create peer connection for accepting viewer connections
      const peerConnection = new RTCPeerConnection({
        iceServers: [
          { urls: ['stun:stun.l.google.com:19302'] },
          { urls: ['stun:stun1.l.google.com:19302'] },
        ],
      });

      // Add local stream tracks to connection
      stream.getTracks().forEach((track) => {
        peerConnection.addTrack(track, stream);
      });

      // Listen for ICE candidates
      peerConnection.onicecandidate = async (event) => {
        if (event.candidate) {
          await this.sendSignalingMessage({
            type: 'ice-candidate',
            data: event.candidate,
          });
        }
      };

      // Listen for new peer connections
      peerConnection.onconnectionstatechange = () => {
        console.log(`Host peer connection state: ${peerConnection.connectionState}`);
      };

      // Signal to server that host is ready
      await this.sendSignalingMessage({
        type: 'host-ready',
        data: { role: 'host' },
      });

      return {
        roomId: this.roomId,
        role: 'host',
        state: 'connecting',
        participantCount: 0,
        peerConnection,
      };
    } catch (error) {
      console.error('Failed to initialize host:', error);
      throw error;
    }
  }

  /**
   * Initialize streaming session for viewer
   * Creates offer and establishes connection to host
   */
  async initializeViewer(): Promise<StreamSession> {
    try {
      // Create peer connection for receiving remote stream
      const peerConnection = new RTCPeerConnection({
        iceServers: [
          { urls: ['stun:stun.l.google.com:19302'] },
          { urls: ['stun:stun1.l.google.com:19302'] },
        ],
      });

      // Listen for remote stream
      peerConnection.ontrack = (event) => {
        console.log('Received remote track:', event.track.kind);
      };

      // Listen for ICE candidates
      peerConnection.onicecandidate = async (event) => {
        if (event.candidate) {
          await this.sendSignalingMessage({
            type: 'ice-candidate',
            data: event.candidate,
          });
        }
      };

      // Create and send offer
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      await this.sendSignalingMessage({
        type: 'offer',
        data: offer,
      });

      return {
        roomId: this.roomId,
        role: 'viewer',
        state: 'connecting',
        participantCount: 1,
        peerConnection,
      };
    } catch (error) {
      console.error('Failed to initialize viewer:', error);
      throw error;
    }
  }

  /**
   * Handle incoming signaling message from peer
   * Processes offer, answer, and ICE candidates
   */
  async handleSignalingMessage(message: SignalingMessage): Promise<void> {
    try {
      if (!this.peerConnections.size) {
        console.warn('No peer connections available');
        return;
      }

      const peerConnection = Array.from(this.peerConnections.values())[0];

      switch (message.type) {
        case 'offer': {
          // Viewer received offer from host
          await peerConnection.setRemoteDescription(
            new RTCSessionDescription(message.data),
          );

          // Create and send answer
          const answer = await peerConnection.createAnswer();
          await peerConnection.setLocalDescription(answer);

          await this.sendSignalingMessage({
            type: 'answer',
            data: answer,
          });
          break;
        }

        case 'answer': {
          // Host received answer from viewer
          await peerConnection.setRemoteDescription(
            new RTCSessionDescription(message.data),
          );
          break;
        }

        case 'ice-candidate': {
          // Received ICE candidate from peer
          if (message.data) {
            try {
              await peerConnection.addIceCandidate(
                new RTCIceCandidate(message.data),
              );
            } catch (error) {
              console.warn('Failed to add ICE candidate:', error);
            }
          }
          break;
        }

        default:
          console.warn('Unknown signaling message type:', message.type);
      }
    } catch (error) {
      console.error('Error handling signaling message:', error);
    }
  }

  /**
   * Stop streaming and clean up resources
   */
  async stopStreaming(): Promise<void> {
    // Stop all tracks
    for (const [, peerConnection] of this.peerConnections) {
      peerConnection.getSenders().forEach((sender) => {
        sender.track?.stop();
      });
      peerConnection.close();
    }

    this.peerConnections.clear();
  }

  /**
   * Send signaling message to peer through server
   */
  private async sendSignalingMessage(message: SignalingMessage): Promise<void> {
    try {
      const response = await fetch(`${this.signalingServerUrl}/api/signaling`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.accessToken}`,
        },
        body: JSON.stringify({
          roomId: this.roomId,
          message,
        }),
      });

      if (!response.ok) {
        throw new Error(`Signaling failed: ${response.statusText}`);
      }
    } catch (error) {
      console.error('Failed to send signaling message:', error);
    }
  }

  /**
   * Check if WebRTC is supported on device
   */
  static isWebRTCAvailable(): boolean {
    try {
      // Check if RTCPeerConnection is available
      return RTCPeerConnection !== undefined && mediaDevices !== undefined;
    } catch {
      return false;
    }
  }
}
