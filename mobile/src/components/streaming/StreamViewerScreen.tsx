import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { RTCView } from 'react-native-webrtc';
import { WebRTCStreamingService, StreamState } from '@/mobile/src/services/streaming.service';
import { TippingStateManager, useTipping } from '@/mobile/src/tipping/TippingService';

interface StreamViewerScreenProps {
  roomId: string;
  creatorName: string;
  signalingServerUrl: string;
  hostPeerId?: string;
  onStreamEnded?: () => void;
}

const tippingManager = new TippingStateManager(100);

/**
 * Viewer streaming UI connected to WebRTC signaling infrastructure.
 */
export const StreamViewerScreen: React.FC<StreamViewerScreenProps> = ({
  roomId,
  creatorName,
  signalingServerUrl,
  hostPeerId = 'host',
  onStreamEnded,
}) => {
  const [streamingService, setStreamingService] = useState<WebRTCStreamingService | null>(null);
  const [state, setState] = useState<StreamState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [remoteStream, setRemoteStream] = useState<{ toURL: () => string } | null>(null);
  const { sendTip, status: tipStatus } = useTipping({ stateManager: tippingManager });

  const serviceRef = useRef<WebRTCStreamingService | null>(null);

  const joinStream = useCallback(async () => {
    try {
      setError(null);
      setState('connecting');

      if (!WebRTCStreamingService.isWebRTCAvailable()) {
        setError('WebRTC is not available on this device');
        setState('error');
        return;
      }

      const service = new WebRTCStreamingService(signalingServerUrl, roomId, 'viewer', {
        onStateChange: setState,
        onRemoteStream: (stream) => setRemoteStream(stream as { toURL: () => string }),
        onStreamEnded: () => setState('ended'),
        onError: (message) => setError(message),
      });

      serviceRef.current = service;
      setStreamingService(service);
      await service.start();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join stream');
      setState('error');
    }
  }, [roomId, signalingServerUrl]);

  useEffect(() => {
    void joinStream();
    return () => {
      void serviceRef.current?.stopStreaming();
    };
  }, [joinStream]);

  const handleLeaveStream = async () => {
    try {
      await streamingService?.stopStreaming();
      onStreamEnded?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to leave stream');
    }
  };

  const handleSendTip = async () => {
    const result = await sendTip({
      fromAddress: 'viewer',
      toAddress: creatorName,
      amount: '1',
      asset: 'XLM',
      idempotencyKey: `tip-${Date.now()}`,
    });

    if (result.status === 'success') {
      streamingService?.sendTipNotification(hostPeerId, '1', 'XLM');
    }
  };

  if (state === 'ended') {
    return (
      <View style={styles.container}>
        <View style={styles.fallbackContainer}>
          <Text style={styles.fallbackTitle}>Stream Ended</Text>
          <Text style={styles.fallbackMessage}>{creatorName}'s live class has ended</Text>
          <TouchableOpacity style={styles.closeButton} onPress={onStreamEnded}>
            <Text style={styles.closeButtonText}>Return to Classes</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (state === 'error' || error) {
    return (
      <View style={styles.container}>
        <View style={styles.fallbackContainer}>
          <Text style={styles.fallbackTitle}>Unable to Join Stream</Text>
          <Text style={styles.fallbackMessage}>{error || 'Connection failed'}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => void joinStream()}>
            <Text style={styles.retryButtonText}>Reconnect</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.closeButton} onPress={onStreamEnded}>
            <Text style={styles.closeButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.videoContainer}>
        {remoteStream ? (
          <RTCView streamURL={remoteStream.toURL()} style={styles.video} objectFit="cover" />
        ) : (
          <View style={styles.videoPlaceholder}>
            <ActivityIndicator size="large" color="#fff" />
            <Text style={styles.connectionStatus}>
              {state === 'connecting' ? 'Connecting to stream...' : 'Waiting for host...'}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.creatorOverlay}>
        <Text style={styles.creatorName}>{creatorName}'s Class</Text>
        {state === 'connected' && (
          <View style={styles.liveIndicator}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>LIVE</Text>
          </View>
        )}
      </View>

      <View style={styles.actionButtons}>
        <TouchableOpacity
          style={[styles.button, styles.tipButton]}
          onPress={() => void handleSendTip()}
          disabled={tipStatus === 'submitting'}
        >
          <Text style={styles.buttonText}>{tipStatus === 'submitting' ? 'Sending...' : 'Send Tip (1 XLM)'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.button, styles.leaveButton]} onPress={() => void handleLeaveStream()}>
          <Text style={styles.buttonText}>Leave Class</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  videoContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  video: { width: '100%', height: '100%' },
  videoPlaceholder: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1a1a1a' },
  connectionStatus: { color: '#ccc', fontSize: 14, marginTop: 12 },
  creatorOverlay: { position: 'absolute', top: 20, left: 0, right: 0, paddingHorizontal: 16, zIndex: 10 },
  creatorName: { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 8 },
  liveIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ff0000',
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  liveDot: { width: 8, height: 8, backgroundColor: '#fff', borderRadius: 4, marginRight: 6 },
  liveText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  actionButtons: { position: 'absolute', bottom: 20, left: 0, right: 0, alignItems: 'center', gap: 12, zIndex: 10 },
  button: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8, minWidth: 180, alignItems: 'center' },
  tipButton: { backgroundColor: '#ffc107' },
  leaveButton: { backgroundColor: 'rgba(0, 0, 0, 0.6)', borderWidth: 1, borderColor: '#fff' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  fallbackContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 20, gap: 12 },
  fallbackTitle: { color: '#fff', fontSize: 24, fontWeight: '700', marginBottom: 12 },
  fallbackMessage: { color: '#ccc', fontSize: 16, textAlign: 'center', marginBottom: 8 },
  retryButton: { backgroundColor: '#007AFF', paddingHorizontal: 32, paddingVertical: 12, borderRadius: 8 },
  closeButton: { backgroundColor: '#333', paddingHorizontal: 32, paddingVertical: 12, borderRadius: 8 },
  retryButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  closeButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
