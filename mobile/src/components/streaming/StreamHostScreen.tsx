import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { RTCView } from 'react-native-webrtc';
import { WebRTCStreamingService, StreamState } from '@/mobile/src/services/streaming.service';

interface StreamHostScreenProps {
  roomId: string;
  signalingServerUrl: string;
  accessToken: string;
  onStreamEnded?: () => void;
}

/**
 * Host/Creator streaming UI for live classes
 * Shows local video preview, stream controls, and participant count
 */
export const StreamHostScreen: React.FC<StreamHostScreenProps> = ({
  roomId,
  signalingServerUrl,
  accessToken,
  onStreamEnded,
}) => {
  const [streamingService, setStreamingService] = useState<WebRTCStreamingService | null>(
    null,
  );
  const [state, setState] = useState<StreamState>('idle');
  const [participantCount, setParticipantCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<any>(null);

  // Initialize streaming service and start stream
  useEffect(() => {
    const initializeStream = async () => {
      try {
        // Check WebRTC support
        if (!WebRTCStreamingService.isWebRTCAvailable()) {
          setError('WebRTC is not available on this device');
          return;
        }

        const service = new WebRTCStreamingService(signalingServerUrl, accessToken, roomId);
        setStreamingService(service);

        const session = await service.initializeHost();
        setState(session.state);
        setParticipantCount(session.participantCount);
        setLocalStream(session.peerConnection?.getLocalStreams()[0]);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to initialize stream');
        setState('error');
      }
    };

    initializeStream();
  }, [roomId, signalingServerUrl, accessToken]);

  // Stop stream
  const handleStopStream = async () => {
    try {
      if (streamingService) {
        await streamingService.stopStreaming();
      }
      setState('ended');
      onStreamEnded?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop stream');
    }
  };

  // Handle stream ended state with graceful fallback
  if (state === 'ended') {
    return (
      <View style={styles.container}>
        <View style={styles.fallbackContainer}>
          <Text style={styles.fallbackTitle}>Stream Ended</Text>
          <Text style={styles.fallbackMessage}>
            Your live streaming session has ended
          </Text>
          <TouchableOpacity style={styles.closeButton} onPress={onStreamEnded}>
            <Text style={styles.closeButtonText}>Return to Classes</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Handle error state with graceful fallback
  if (state === 'error' || error) {
    return (
      <View style={styles.container}>
        <View style={styles.fallbackContainer}>
          <Text style={styles.fallbackTitle}>Streaming Error</Text>
          <Text style={styles.fallbackMessage}>{error || 'Unable to start stream'}</Text>
          <Text style={styles.fallbackSubtitle}>
            Please check your connection and try again
          </Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => window.location.reload()}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Local video preview */}
      <View style={styles.videoContainer}>
        {localStream && (
          <RTCView
            streamURL={localStream.toURL()}
            style={styles.video}
            objectFit="cover"
          />
        )}
        {!localStream && (
          <View style={styles.videoPlaceholder}>
            <Text style={styles.videoPlaceholderText}>Camera Loading...</Text>
          </View>
        )}
      </View>

      {/* Stream controls overlay */}
      <View style={styles.controlsOverlay}>
        {/* Participant count */}
        <View style={styles.participantBadge}>
          <Text style={styles.participantCount}>{participantCount} viewers</Text>
        </View>

        {/* Stream status */}
        <View style={styles.statusBadge}>
          <Text style={styles.statusText}>
            {state === 'connecting' ? 'Connecting...' : 'LIVE'}
          </Text>
          {state === 'connected' && <View style={styles.liveDot} />}
        </View>
      </View>

      {/* Action buttons */}
      <View style={styles.actionButtons}>
        <TouchableOpacity
          style={[styles.button, styles.stopButton]}
          onPress={handleStopStream}
        >
          <Text style={styles.buttonText}>Stop Streaming</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  videoContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  video: {
    width: '100%',
    height: '100%',
  },
  videoPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
  },
  videoPlaceholderText: {
    color: '#fff',
    fontSize: 16,
  },
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
  participantBadge: {
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
  },
  participantCount: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  statusBadge: {
    backgroundColor: '#ff0000',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    marginRight: 6,
  },
  liveDot: {
    width: 8,
    height: 8,
    backgroundColor: '#fff',
    borderRadius: 4,
  },
  actionButtons: {
    position: 'absolute',
    bottom: 20,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 10,
  },
  button: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    minWidth: 150,
    alignItems: 'center',
  },
  stopButton: {
    backgroundColor: '#ff3b30',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  fallbackContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  fallbackTitle: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 12,
  },
  fallbackMessage: {
    color: '#ccc',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 8,
  },
  fallbackSubtitle: {
    color: '#999',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 24,
  },
  retryButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 8,
  },
  closeButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  closeButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
