/**
 * PortfolioUploadScreen — Issue 5
 * "Provide mobile capable File Upload logic directly communicating
 *  externally to Buckets"
 *
 * Features:
 *  - Animated dashed-border empty state with pulsing icon
 *  - FileUploadPicker FAB (camera / gallery / documents)
 *  - UploadQueue with per-file progress & controls
 *  - Upload stats header (total / done / failed / bytes)
 *  - Pull-to-refresh (clears done files and refreshes)
 *  - Full dark mode via useTheme()
 *  - Zero frame drops: Reanimated progress bars, memoized items
 *  - Accessible: progressbar roles, button labels, status announcements
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { FontSize, FontWeight, Radius, Shadow, Spacing } from '../theme/tokens';
import { useFileUpload } from '../hooks/useFileUpload';
import { FileUploadPicker } from '../components/upload/FileUploadPicker';
import { UploadQueue } from '../components/upload/UploadQueue';
import { useImageUpscaler } from '../upscaling/useImageUpscaler';
import { BeforeAfterSlider } from '../components/image/BeforeAfterSlider';

const MIN_HD_DIMENSION = 1080;
const MAX_UPSCALE_INPUT = 512;

// ─── Animated dashed empty state ──────────────────────────────────────────────

function EmptyState() {
  const { colors } = useTheme();
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.08, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1,    duration: 900, useNativeDriver: true }),
      ]),
    ).start();
  }, [pulse]);

  return (
    <View style={styles.emptyWrap}>
      <View
        style={[
          styles.emptyBorder,
          {
            borderColor: colors.border,
            backgroundColor: colors.surface,
          },
        ]}
      >
        <Animated.Text
          style={[styles.emptyIcon, { transform: [{ scale: pulse }] }]}
        >
          📁
        </Animated.Text>
        <Text style={[styles.emptyTitle, { color: colors.text }]}>
          No files yet
        </Text>
        <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
          Tap{' '}
          <Text style={{ color: colors.primary, fontWeight: FontWeight.bold }}>+</Text>
          {' '}to add images, videos, or documents.{'\n'}
          Files are uploaded directly to secure cloud storage.
        </Text>

        <View style={styles.featureRow}>
          {[
            { icon: '🖼️', label: 'Photos & Videos' },
            { icon: '📄', label: 'Any Document' },
            { icon: '🔒', label: 'Direct to Bucket' },
          ].map((f) => (
            <View
              key={f.label}
              style={[styles.featureChip, { backgroundColor: colors.surfaceElevated, borderColor: colors.border }]}
            >
              <Text style={styles.featureIcon}>{f.icon}</Text>
              <Text style={[styles.featureLabel, { color: colors.textSecondary }]}>{f.label}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

// ─── Stats header card ─────────────────────────────────────────────────────────

function StatsCard({
  total, done, failed, uploading, totalBytes, doneBytes,
}: {
  total: number; done: number; failed: number; uploading: number;
  totalBytes: number; doneBytes: number;
}) {
  const { colors } = useTheme();

  function fmtBytes(b: number) {
    if (b === 0) return '0 B';
    const k = 1024, units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(b) / Math.log(k));
    return `${(b / Math.pow(k, i)).toFixed(1)} ${units[i]}`;
  }

  const overallPct = totalBytes > 0 ? Math.round((doneBytes / totalBytes) * 100) : 0;

  return (
    <View style={[styles.statsCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.statsRow}>
        <Stat label="Total"    value={String(total)}    color={colors.text} />
        <Stat label="Done"     value={String(done)}     color={colors.success} />
        <Stat label="Failed"   value={String(failed)}   color={failed > 0 ? colors.error : colors.textTertiary} />
        <Stat label="Active"   value={String(uploading)} color={uploading > 0 ? colors.primary : colors.textTertiary} />
      </View>

      {/* Overall progress bar */}
      <View style={[styles.overallTrack, { backgroundColor: colors.border }]}>
        <View
          style={[
            styles.overallFill,
            {
              width: `${overallPct}%` as any,
              backgroundColor: done === total && total > 0 ? colors.success : colors.primary,
            },
          ]}
        />
      </View>
      <Text style={[styles.overallLabel, { color: colors.textTertiary }]}>
        {fmtBytes(doneBytes)} of {fmtBytes(totalBytes)} uploaded ({overallPct}%)
      </Text>
    </View>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.statCell}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.textTertiary }]}>{label}</Text>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export function PortfolioUploadScreen() {
  const { colors, isDark } = useTheme();
  const upload = useFileUpload();
  const { files, stats, isUploading } = upload;
  const upscaler = useImageUpscaler();
  const [upscalePreview, setUpscalePreview] = useState<{
    originalUri: string;
    width: number;
    height: number;
  } | null>(null);

  const [refreshing, setRefreshing] = React.useState(false);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    upload.clearDone();
    upscaler.reset();
    setUpscalePreview(null);
    await new Promise((r) => setTimeout(r, 500));
    setRefreshing(false);
  }, [upload, upscaler]);

  const handleImageSelected = useCallback((uri: string, width: number, height: number) => {
    if (width < MIN_HD_DIMENSION || height < MIN_HD_DIMENSION) {
      Alert.alert(
        'Enhance image quality?',
        `This image is ${width}×${height} (below 1080p). Upscaling takes ~5s.`,
        [
          { text: 'Skip', style: 'cancel' },
          {
            text: 'Enhance',
            onPress: () => {
              setUpscalePreview({ originalUri: uri, width, height });
              const inputW = Math.min(width, MAX_UPSCALE_INPUT);
              const inputH = Math.min(height, MAX_UPSCALE_INPUT);
              upscaler.upscale(uri, inputW, inputH);
            },
          },
        ],
      );
    }
  }, [upscaler]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View>
          <Text style={[styles.title, { color: colors.text }]}>Portfolio Upload</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Direct to cloud storage
          </Text>
        </View>
        {stats.total > 0 && (
          <Pressable
            onPress={upload.clearAll}
            style={[styles.clearAllBtn, { backgroundColor: colors.errorLight }]}
            accessibilityRole="button"
            accessibilityLabel="Clear all files"
          >
            <Text style={[styles.clearAllText, { color: colors.error }]}>Clear All</Text>
          </Pressable>
        )}
      </View>

      {/* ── Body ───────────────────────────────────────────────────────── */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          files.length === 0 && styles.contentCenter,
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        {/* Image upscaling section */}
        {upscaler.processing && (
          <View style={[styles.upscaleCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={[styles.upscaleText, { color: colors.textSecondary }]}>
              Enhancing image quality...
            </Text>
          </View>
        )}

        {upscaler.result && upscalePreview && (
          <View style={[styles.upscaleCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.upscaleTitle, { color: colors.text }]}>Before / After</Text>
            <BeforeAfterSlider
              beforeUri={upscalePreview.originalUri}
              afterUri={upscaler.result.uri}
              width={upscaler.result.outputWidth}
              height={upscaler.result.outputHeight}
            />
            <Text style={[styles.upscaleDimensions, { color: colors.textTertiary }]}>
              {upscalePreview.width}×{upscalePreview.height} → {upscaler.result.outputWidth}×{upscaler.result.outputHeight}
            </Text>
          </View>
        )}

        {upscaler.error && (
          <View style={[styles.upscaleCard, { backgroundColor: colors.errorLight, borderColor: colors.error }]}>
            <Text style={[styles.upscaleText, { color: colors.error }]}>{upscaler.error}</Text>
          </View>
        )}

        {files.length === 0 && !upscaler.processing && !upscaler.result ? (
          <EmptyState />
        ) : (
          <>
            {/* Stats card */}
            {files.length > 0 && <StatsCard {...stats} />}

            {/* Upload queue */}
            <View style={styles.queueWrap}>
              <UploadQueue hook={upload} />
            </View>
          </>
        )}
      </ScrollView>

      {/* ── FAB picker ─────────────────────────────────────────────────── */}
      <FileUploadPicker
        onPickCamera={upload.pickFromCamera}
        onPickGallery={upload.pickImages}
        onPickDocuments={upload.pickDocuments}
        disabled={isUploading && stats.pending === 0}
      />
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1 },

  header: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.base,
    paddingTop:     Spacing.base,
    paddingBottom:  Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: {
    fontSize:   FontSize['2xl'],
    fontWeight: FontWeight.bold,
  },
  subtitle: {
    fontSize:  FontSize.xs,
    marginTop: 2,
  },
  clearAllBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.xs,
    borderRadius:      Radius.full,
  },
  clearAllText: {
    fontSize:   FontSize.sm,
    fontWeight: FontWeight.semibold,
  },

  scroll: { flex: 1 },
  content: {
    padding:       Spacing.base,
    paddingBottom: Spacing['5xl'],
    gap:           Spacing.md,
  },
  contentCenter: {
    flexGrow:       1,
    justifyContent: 'center',
  },

  // ── Empty state ─────────────────────────────────────────────────────────
  emptyWrap: {
    alignItems: 'center',
  },
  emptyBorder: {
    width:         '100%',
    borderWidth:   2,
    borderStyle:   'dashed',
    borderRadius:  Radius['2xl'],
    padding:       Spacing['2xl'],
    alignItems:    'center',
    gap:           Spacing.md,
  },
  emptyIcon: {
    fontSize: 56,
  },
  emptyTitle: {
    fontSize:   FontSize.xl,
    fontWeight: FontWeight.bold,
    textAlign:  'center',
  },
  emptySubtitle: {
    fontSize:  FontSize.sm,
    textAlign: 'center',
    lineHeight: 20,
  },
  featureRow: {
    flexDirection: 'row',
    gap:           Spacing.xs,
    flexWrap:      'wrap',
    justifyContent: 'center',
    marginTop:     Spacing.xs,
  },
  featureChip: {
    flexDirection:  'row',
    alignItems:     'center',
    gap:            Spacing.xs,
    paddingHorizontal: Spacing.sm,
    paddingVertical:   Spacing.xs,
    borderRadius:   Radius.full,
    borderWidth:    1,
  },
  featureIcon:  { fontSize: FontSize.sm },
  featureLabel: { fontSize: FontSize.xs, fontWeight: FontWeight.medium },

  // ── Stats card ──────────────────────────────────────────────────────────
  statsCard: {
    borderRadius: Radius.xl,
    borderWidth:  1,
    padding:      Spacing.base,
    gap:          Spacing.sm,
    ...Shadow.sm,
  },
  statsRow: {
    flexDirection:  'row',
    justifyContent: 'space-around',
  },
  statCell: {
    alignItems: 'center',
    gap:        2,
  },
  statValue: {
    fontSize:   FontSize['2xl'],
    fontWeight: FontWeight.bold,
  },
  statLabel: {
    fontSize: FontSize.xs,
  },
  overallTrack: {
    height:       6,
    borderRadius: Radius.full,
    overflow:     'hidden',
  },
  overallFill: {
    height:       6,
    borderRadius: Radius.full,
  },
  overallLabel: {
    fontSize:  FontSize.xs,
    textAlign: 'center',
  },

  // ── Queue ────────────────────────────────────────────────────────────────
  queueWrap: {
    flex: 1,
    minHeight: 200,
  },

  // ── Upscale ─────────────────────────────────────────────────────────────
  upscaleCard: {
    borderRadius: Radius.xl,
    borderWidth:  1,
    padding:      Spacing.base,
    gap:          Spacing.sm,
    alignItems:   'center',
  },
  upscaleTitle: {
    fontSize:   FontSize.lg,
    fontWeight: FontWeight.semibold,
    alignSelf:  'flex-start',
  },
  upscaleText: {
    fontSize:  FontSize.sm,
    marginTop: Spacing.xs,
  },
  upscaleDimensions: {
    fontSize: FontSize.xs,
  },
});
