import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { RTCView } from 'react-native-webrtc';
import { WebRTCStreamingService, StreamState } from '@/mobile/src/services/streaming.service';

interface StreamViewerScreenProps {
  roomId: string;
  creatorName: string;
  signalingServerUrl: string;
  accessToken: string;
  onStreamEnded?: () => void;
}

/**
 * Viewer streaming UI for watching creator classes
 * Displays remote video, join/leave controls, and connection status
 */
export const StreamViewerScreen: React.FC<StreamViewerScreenProps> = ({
  roomId,
  creatorName,
  signalingServerUrl,
  accessToken,
  onStreamEnded,
}) => {
  const [streamingService, setStreamingService] = useState<WebRTCStreamingService | null>(
    null,
  );
  const [state, setState] = useState<StreamState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [remoteStream, setRemoteStream] = useState<any>(null);

  // Initialize viewer streaming
  useEffect(() => {
    const initializeViewer = async () => {
      try {
        // Check WebRTC support
        if (!WebRTCStreamingService.isWebRTCAvailable()) {
          setError('WebRTC is not available on this device');
          return;
        }

        const service = new WebRTCStreamingService(signalingServerUrl, accessToken, roomId);
        setStreamingService(service);

        const session = await service.initializeViewer();
        setState(session.state);

        // Listen for remote stream
        if (session.peerConnection) {
          session.peerConnection.ontrack = (event) => {
            setRemoteStream(event.streams[0]);
            setState('connected');
          };
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to join stream');
        setState('error');
      }
    };

    initializeViewer();
  }, [roomId, signalingServerUrl, accessToken]);

  // Leave stream
  const handleLeaveStream = async () => {
    try {
      if (streamingService) {
        await streamingService.stopStreaming();
      }
      onStreamEnded?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to leave stream');
    }
  };

  // Handle stream ended gracefully
  if (state === 'ended') {
    return (
      <View style={styles.container}>
        <View style={styles.fallbackContainer}>
          <Text style={styles.fallbackTitle}>Stream Ended</Text>
          <Text style={styles.fallbackMessage}>
            {creatorName}'s live class has ended
          </Text>
          <TouchableOpacity style={styles.closeButton} onPress={onStreamEnded}>
            <Text style={styles.closeButtonText}>Return to Classes</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Handle error gracefully
  if (state === 'error' || error) {
    return (
      <View style={styles.container}>
        <View style={styles.fallbackContainer}>
          <Text style={styles.fallbackTitle}>Unable to Join Stream</Text>
          <Text style={styles.fallbackMessage}>{error || 'Connection failed'}</Text>
          <Text style={styles.fallbackSubtitle}>
            The stream may have ended or your connection was lost. Please try again.
          </Text>
          <TouchableOpacity style={styles.closeButton} onPress={onStreamEnded}>
            <Text style={styles.closeButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Remote video view */}
      <View style={styles.videoContainer}>
        {remoteStream ? (
          <RTCView
            streamURL={remoteStream.toURL()}
            style={styles.video}
            objectFit="cover"
          />
        ) : (
          <View style={styles.videoPlaceholder}>
            <ActivityIndicator size="large" color="#fff" />
            <Text style={styles.connectionStatus}>
              {state === 'connecting' ? 'Connecting to stream...' : 'Waiting for host...'}
            </Text>
          </View>
        )}
      </View>

      {/* Creator info overlay */}
      <View style={styles.creatorOverlay}>
        <Text style={styles.creatorName}>{creatorName}'s Class</Text>
        {state === 'connected' && (
          <View style={styles.liveIndicator}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>LIVE</Text>
          </View>
        )}
      </View>

      {/* Action buttons */}
      <View style={styles.actionButtons}>
        <TouchableOpacity
          style={[styles.button, styles.leaveButton]}
          onPress={handleLeaveStream}
        >
          <Text style={styles.buttonText}>Leave Class</Text>
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
  connectionStatus: {
    color: '#ccc',
    fontSize: 14,
    marginTop: 12,
  },
  creatorOverlay: {
    position: 'absolute',
    top: 20,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    zIndex: 10,
  },
  creatorName: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  liveIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ff0000',
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  liveDot: {
    width: 8,
    height: 8,
    backgroundColor: '#fff',
    borderRadius: 4,
    marginRight: 6,
  },
  liveText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
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
  leaveButton: {
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderWidth: 1,
    borderColor: '#fff',
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
  closeButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 8,
  },
  closeButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
