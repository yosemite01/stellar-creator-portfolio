import React, { useCallback } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useUIStore } from '../store';
import { useTheme } from '../theme/ThemeProvider';
import {
  playAudioAsync,
  pauseAudioAsync,
} from '../services/AudioPlaybackService';
import { FontSize, FontWeight, Radius, Shadow, Spacing } from '../theme/tokens';

export function MiniPlayer() {
  const { colors } = useTheme();
  const currentTrack = useUIStore((s) => s.currentTrack);
  const isPlaying = useUIStore((s) => s.isAudioPlaying);

  const onTogglePlayPause = useCallback(async () => {
    if (isPlaying) {
      await pauseAudioAsync();
    } else {
      await playAudioAsync();
    }
  }, [isPlaying]);

  if (!currentTrack) {
    return null;
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
      <View style={styles.content}>
        <View style={styles.trackInfo}>
          <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
            {currentTrack.title}
          </Text>
          <Text style={[styles.creator, { color: colors.textSecondary }]} numberOfLines={1}>
            {currentTrack.creator}
          </Text>
        </View>
        <Pressable
          style={[styles.playButton, Shadow.sm, { backgroundColor: colors.primary }]}
          onPress={onTogglePlayPause}
        >
          <Text style={[styles.playButtonText, { color: colors.textInverse }]}>
            {isPlaying ? '⏸' : '▶'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderTopWidth: 1,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.sm,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  trackInfo: {
    flex: 1,
  },
  title: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
  },
  creator: {
    fontSize: FontSize.xs,
    marginTop: 2,
  },
  playButton: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playButtonText: {
    fontSize: FontSize.lg,
  },
});
