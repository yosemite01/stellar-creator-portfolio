import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Share } from 'react-native';
import { RTCView } from 'react-native-webrtc';
import { WebRTCStreamingService, StreamState } from '@/mobile/src/services/streaming.service';
import { buildUniversalLink } from '@/mobile/src/config/DeepLinkConfig';

interface StreamHostScreenProps {
  roomId: string;
  signalingServerUrl: string;
  onStreamEnded?: () => void;
}

interface TipNotification {
  id: string;
  from: string;
  amount: string;
  asset: string;
}

/**
 * Host/Creator streaming UI connected to WebRTC signaling infrastructure.
 */
export const StreamHostScreen: React.FC<StreamHostScreenProps> = ({
  roomId,
  signalingServerUrl,
  onStreamEnded,
}) => {
  const [streamingService, setStreamingService] = useState<WebRTCStreamingService | null>(null);
  const [state, setState] = useState<StreamState>('idle');
  const [participantCount, setParticipantCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<{ toURL: () => string } | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [tips, setTips] = useState<TipNotification[]>([]);
  const retryKey = useRef(0);

  const joinLink = buildUniversalLink('stream', roomId);

  const startStream = useCallback(async () => {
    try {
      setError(null);
      setState('connecting');

      if (!WebRTCStreamingService.isWebRTCAvailable()) {
        setError('WebRTC is not available on this device');
        setState('error');
        return;
      }

      const service = new WebRTCStreamingService(signalingServerUrl, roomId, 'host', {
        onStateChange: setState,
        onParticipantCount: setParticipantCount,
        onLocalStream: (stream) => setLocalStream(stream as { toURL: () => string }),
        onTip: (tip) => {
          setTips((prev) => [
            ...prev,
            { id: `${Date.now()}`, from: tip.from, amount: tip.amount, asset: tip.asset },
          ]);
        },
        onStreamEnded: () => setState('ended'),
        onError: (message) => setError(message),
      });

      setStreamingService(service);
      await service.start();
      setIsLive(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initialize stream');
      setState('error');
    }
  }, [roomId, signalingServerUrl]);

  useEffect(() => {
    return () => {
      void streamingService?.stopStreaming();
    };
  }, [streamingService]);

  const handleStopStream = async () => {
    try {
      await streamingService?.stopStreaming();
      setState('ended');
      setIsLive(false);
      onStreamEnded?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop stream');
    }
  };

  const handleShareLink = async () => {
    await Share.share({
      message: `Join my live stream: ${joinLink}`,
      url: joinLink,
    });
  };

  const handleRetry = () => {
    retryKey.current += 1;
    setError(null);
    setState('idle');
    setIsLive(false);
    void startStream();
  };

  if (state === 'ended') {
    return (
      <View style={styles.container}>
        <View style={styles.fallbackContainer}>
          <Text style={styles.fallbackTitle}>Stream Ended</Text>
          <Text style={styles.fallbackMessage}>Your live streaming session has ended</Text>
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
          <Text style={styles.fallbackTitle}>Streaming Error</Text>
          <Text style={styles.fallbackMessage}>{error || 'Unable to start stream'}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={handleRetry}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (!isLive) {
    return (
      <View style={styles.container}>
        <View style={styles.fallbackContainer}>
          <Text style={styles.fallbackTitle}>Go Live</Text>
          <Text style={styles.fallbackMessage}>Start your stream and share the join link with viewers.</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => void startStream()}>
            <Text style={styles.retryButtonText}>Start Stream</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.videoContainer}>
        {localStream ? (
          <RTCView streamURL={localStream.toURL()} style={styles.video} objectFit="cover" />
        ) : (
          <View style={styles.videoPlaceholder}>
            <Text style={styles.videoPlaceholderText}>Camera Loading...</Text>
          </View>
        )}
      </View>

      <View style={styles.controlsOverlay}>
        <View style={styles.participantBadge}>
          <Text style={styles.participantCount}>{participantCount} viewers</Text>
        </View>
        <View style={styles.statusBadge}>
          <Text style={styles.statusText}>
            {state === 'connecting' ? 'Connecting...' : 'LIVE'}
          </Text>
          {state === 'connected' && <View style={styles.liveDot} />}
        </View>
      </View>

      {tips.length > 0 && (
        <View style={styles.tipOverlay}>
          <Text style={styles.tipText}>
            Tip received: {tips[tips.length - 1].amount} {tips[tips.length - 1].asset}
          </Text>
        </View>
      )}

      <View style={styles.actionButtons}>
        <TouchableOpacity style={[styles.button, styles.shareButton]} onPress={() => void handleShareLink()}>
          <Text style={styles.buttonText}>Share Join Link</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.button, styles.stopButton]} onPress={() => void handleStopStream()}>
          <Text style={styles.buttonText}>Stop Streaming</Text>
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
  videoPlaceholderText: { color: '#fff', fontSize: 16 },
  controlsOverlay: {
    position: 'absolute',
    top: 20,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    zIndex: 10,
  },
  participantBadge: { backgroundColor: 'rgba(0, 0, 0, 0.6)', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16 },
  participantCount: { color: '#fff', fontSize: 14, fontWeight: '600' },
  statusBadge: { backgroundColor: '#ff0000', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, flexDirection: 'row', alignItems: 'center' },
  statusText: { color: '#fff', fontSize: 14, fontWeight: '700', marginRight: 6 },
  liveDot: { width: 8, height: 8, backgroundColor: '#fff', borderRadius: 4 },
  tipOverlay: {
    position: 'absolute',
    top: 80,
    alignSelf: 'center',
    backgroundColor: 'rgba(255, 193, 7, 0.9)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    zIndex: 10,
  },
  tipText: { color: '#000', fontWeight: '700', fontSize: 14 },
  actionButtons: { position: 'absolute', bottom: 20, left: 0, right: 0, alignItems: 'center', gap: 12, zIndex: 10 },
  button: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8, minWidth: 180, alignItems: 'center' },
  shareButton: { backgroundColor: '#007AFF' },
  stopButton: { backgroundColor: '#ff3b30' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  fallbackContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 20 },
  fallbackTitle: { color: '#fff', fontSize: 24, fontWeight: '700', marginBottom: 12 },
  fallbackMessage: { color: '#ccc', fontSize: 16, textAlign: 'center', marginBottom: 24 },
  retryButton: { backgroundColor: '#007AFF', paddingHorizontal: 32, paddingVertical: 12, borderRadius: 8 },
  closeButton: { backgroundColor: '#007AFF', paddingHorizontal: 32, paddingVertical: 12, borderRadius: 8 },
  retryButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  closeButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
