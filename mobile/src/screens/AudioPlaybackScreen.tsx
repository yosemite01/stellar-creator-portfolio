import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import {
  loadAudioAsync,
  loadAndPlayAsync,
  initializeAudioPlayerAsync,
  pauseAudioAsync,
  playAudioAsync,
  seekAudioAsync,
  setAudioPlaybackStatusListener,
  stopAudioAsync,
  unloadAudioAsync,
} from '../services/AudioPlaybackService';
import { FontSize, FontWeight, Radius, Shadow, Spacing } from '../theme/tokens';

const SAMPLE_TRACK = {
  uri: 'https://storage.googleapis.com/expo-samples/reef.mp3',
};

export function AudioPlaybackScreen() {
  const { colors, isDark } = useTheme();
  const [isReady, setIsReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [statusMessage, setStatusMessage] = useState('Initializing audio session…');

  const statusText = useMemo(() => {
    if (!isReady) return 'Preparing playback session';
    if (isPlaying) return 'Playing in background with lock-screen support';
    return 'Paused — lock-screen controls remain available';
  }, [isReady, isPlaying]);

  useEffect(() => {
    async function setup() {
      await initializeAudioPlayerAsync();
      const status = await loadAudioAsync(SAMPLE_TRACK);
      if (status) {
        setIsReady(true);
        setDuration(status.durationMillis ?? 0);
      }
      setStatusMessage('Ready for playback');
    }

    setup().catch(() => setStatusMessage('Unable to initialize audio session'));

    setAudioPlaybackStatusListener((status) => {
      setIsPlaying(Boolean(status.isPlaying));
      setProgress(status.positionMillis && status.durationMillis
        ? Math.round((status.positionMillis / status.durationMillis) * 100)
        : 0);
    });

    return () => {
      setAudioPlaybackStatusListener(() => {});
      unloadAudioAsync().catch(() => {});
    };
  }, []);

  const onPlayPause = useCallback(async () => {
    if (!isReady) {
      return;
    }

    if (isPlaying) {
      await pauseAudioAsync();
      setStatusMessage('Paused');
    } else {
      await playAudioAsync();
      setStatusMessage('Playing');
    }
  }, [isReady, isPlaying]);

  const onStop = useCallback(async () => {
    await stopAudioAsync();
    setStatusMessage('Stopped');
    setProgress(0);
  }, []);

  const onSkipForward = useCallback(async () => {
    if (!duration) {
      return;
    }
    await seekAudioAsync(Math.min(duration, Math.round((progress / 100) * duration) + 10_000));
  }, [duration, progress]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}> 
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      <View style={[styles.container, { backgroundColor: colors.surface }]}> 
        <Text style={[styles.header, { color: colors.text }]}>Mobile Audio Playback</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>Native background audio with lock-screen ready playback state.</Text>
        <View style={[styles.card, { backgroundColor: colors.surfaceElevated, borderColor: colors.border }]}> 
          <Text style={[styles.trackTitle, { color: colors.text }]}>Stellar Creator Sample Track</Text>
          <Text style={[styles.trackMeta, { color: colors.textSecondary }]}>Secure streaming + buffer-ready playback</Text>
          <View style={styles.statusBadge}> 
            <Text style={[styles.statusText, { color: colors.primary }]}>{statusText}</Text>
          </View>
          <View style={styles.progressRow}> 
            <View style={[styles.progressBar, { backgroundColor: colors.border }]}> 
              <View style={[styles.progressFill, { width: `${progress}%`, backgroundColor: colors.primary }]} />
            </View>
            <Text style={[styles.progressLabel, { color: colors.textSecondary }]}>{progress}%</Text>
          </View>
        </View>
        <View style={styles.controls}> 
          <Pressable style={[styles.controlButton, Shadow.sm, { backgroundColor: colors.primary }]} onPress={onPlayPause}> 
            <Text style={[styles.controlText, { color: colors.textInverse }]}>{isPlaying ? 'Pause' : 'Play'}</Text>
          </Pressable> 
          <Pressable style={[styles.controlButton, Shadow.sm, { backgroundColor: colors.surface }]} onPress={onStop}> 
            <Text style={[styles.controlText, { color: colors.text }]}>Stop</Text>
          </Pressable> 
          <Pressable style={[styles.controlButton, Shadow.sm, { backgroundColor: colors.surface }]} onPress={onSkipForward}> 
            <Text style={[styles.controlText, { color: colors.text }]}>+10s</Text>
          </Pressable> 
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  container: {
    flex: 1,
    padding: Spacing.base,
  },
  header: {
    fontSize: FontSize['3xl'],
    fontWeight: FontWeight.extrabold,
    marginBottom: Spacing.sm,
  },
  subtitle: {
    fontSize: FontSize.base,
    lineHeight: 22,
    marginBottom: Spacing.lg,
  },
  card: {
    borderRadius: Radius.xl,
    borderWidth: 1,
    padding: Spacing.base,
    marginBottom: Spacing.xl,
  },
  trackTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    marginBottom: Spacing.xs,
  },
  trackMeta: {
    fontSize: FontSize.sm,
    marginBottom: Spacing.md,
  },
  statusBadge: {
    marginVertical: Spacing.sm,
  },
  statusText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.medium,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  progressBar: {
    flex: 1,
    height: 10,
    borderRadius: Radius.full,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: Radius.full,
  },
  progressLabel: {
    fontSize: FontSize.sm,
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  controlButton: {
    flex: 1,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.lg,
    alignItems: 'center',
  },
  controlText: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
  },
});
