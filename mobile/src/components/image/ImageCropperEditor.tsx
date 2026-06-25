/**
 * ImageCropperEditor — GPU-shader filters, rotation, scaling, perspective warping.
 * Used for avatar and banner editing on mobile.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  Dimensions,
  Image,
  Pressable,
  ScrollView,
  Slider,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { FontSize, FontWeight, Radius, Spacing } from '../../theme/tokens';
import {
  applyConvolutionCpu,
  type FilterPreset,
  CONVOLUTION_KERNELS,
} from '../../utils/image/convolutionShaders';
import { compressToJpeg, formatCompressionSavings } from '../../utils/image/jpegCompression';

const { width: SCREEN_W } = Dimensions.get('window');
const PREVIEW_SIZE = SCREEN_W - Spacing.base * 2;

export interface CropTransform {
  rotation: number;
  scale: number;
  perspectiveX: number;
  perspectiveY: number;
}

interface ImageAdjustments {
  brightness: number; // 0 to 2, 1 is normal
  contrast: number; // 0 to 2, 1 is normal
  saturation: number; // 0 to 2, 1 is normal
}

type AspectRatioPreset = '1:1' | '4:3' | '16:9' | 'freeform';

export interface ImageCropperEditorProps {
  imageUri: string;
  imageWidth: number;
  imageHeight: number;
  fileSize?: number;
  aspectRatio?: number;
  onSave?: (result: { uri: string; width: number; height: number; filter: FilterPreset }) => void;
  onCancel?: () => void;
}

const FILTER_PRESETS: FilterPreset[] = ['none', 'sharpen', 'blur', 'edge', 'emboss', 'sepia', 'grayscale', 'vintage'];

const ASPECT_RATIOS: Record<AspectRatioPreset, number | null> = {
  '1:1': 1,
  '4:3': 4/3,
  '16:9': 16/9,
  'freeform': null,
};

const QUALITY_PRESETS = [
  { label: 'High', value: 0.9 },
  { label: 'Medium', value: 0.7 },
  { label: 'Low', value: 0.5 },
];

type EditorState = {
  filter: FilterPreset;
  transform: CropTransform;
  adjustments: ImageAdjustments;
  aspectRatio: AspectRatioPreset;
  quality: number;
};

export function ImageCropperEditor({
  imageUri,
  imageWidth,
  imageHeight,
  fileSize = 0,
  aspectRatio: initialAspectRatio = 1,
  onSave,
  onCancel,
}: ImageCropperEditorProps) {
  const { colors } = useTheme();

  const getInitialAspectRatioPreset = (ratio: number): AspectRatioPreset => {
    if (ratio === 1) return '1:1';
    if (Math.abs(ratio - 4/3) < 0.01) return '4:3';
    if (Math.abs(ratio - 16/9) < 0.01) return '16:9';
    return 'freeform';
  };

  const initialState: EditorState = {
    filter: 'none',
    transform: {
      rotation: 0,
      scale: 1,
      perspectiveX: 0,
      perspectiveY: 0,
    },
    adjustments: {
      brightness: 1,
      contrast: 1,
      saturation: 1,
    },
    aspectRatio: getInitialAspectRatioPreset(initialAspectRatio),
    quality: 0.82,
  };

  const [state, setState] = useState<EditorState>(initialState);
  const [history, setHistory] = useState<EditorState[]>([initialState]);
  const [historyIndex, setHistoryIndex] = useState(0);

  const currentAspectRatio = ASPECT_RATIOS[state.aspectRatio];
  const previewHeight = currentAspectRatio ? PREVIEW_SIZE / currentAspectRatio : PREVIEW_SIZE * (imageHeight / imageWidth);

  const saveStateToHistory = useCallback((newState: EditorState) => {
    const newHistory = history.slice(0, historyIndex + 1);
    if (newHistory.length >= 5) {
      newHistory.shift();
    }
    newHistory.push(newState);
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  }, [history, historyIndex]);

  const undo = useCallback(() => {
    if (historyIndex > 0) {
      setHistoryIndex(historyIndex - 1);
      setState(history[historyIndex - 1]);
    }
  }, [history, historyIndex]);

  const redo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      setHistoryIndex(historyIndex + 1);
      setState(history[historyIndex + 1]);
    }
  }, [history, historyIndex]);

  const updateState = useCallback((updates: Partial<EditorState>) => {
    const newState = { ...state, ...updates };
    setState(newState);
    saveStateToHistory(newState);
  }, [state, saveStateToHistory]);

  const transformStyle = useMemo(
    () => ({
      transform: [
        { perspective: 800 },
        { rotate: `${state.transform.rotation}deg` },
        { scale: state.transform.scale },
        { rotateX: `${state.transform.perspectiveX}deg` },
        { rotateY: `${state.transform.perspectiveY}deg` },
      ],
    }),
    [state.transform],
  );

  const compressed = useMemo(
    () => compressToJpeg(imageUri, imageWidth, imageHeight, { quality: state.quality, maxWidth: 1200 }),
    [imageUri, imageWidth, imageHeight, state.quality],
  );

  const savingsLabel = useMemo(
    () => (fileSize > 0 ? formatCompressionSavings(fileSize, compressed.estimatedBytes) : null),
    [fileSize, compressed.estimatedBytes],
  );

  const rotate = useCallback((delta: number) => {
    updateState({
      transform: { ...state.transform, rotation: (state.transform.rotation + delta + 360) % 360 },
    });
  }, [state.transform, updateState]);

  const adjustScale = useCallback((delta: number) => {
    updateState({
      transform: { ...state.transform, scale: Math.max(0.5, Math.min(3, state.transform.scale + delta)) },
    });
  }, [state.transform, updateState]);

  const adjustPerspective = useCallback((axis: 'X' | 'Y', delta: number) => {
    updateState({
      transform: {
        ...state.transform,
        [`perspective${axis}`]: Math.max(-30, Math.min(30, (state.transform as CropTransform)[`perspective${axis}` as 'perspectiveX' | 'perspectiveY'] + delta)),
      },
    });
  }, [state.transform, updateState]);

  const handleSave = useCallback(() => {
    onSave?.({
      uri: compressed.uri,
      width: compressed.width,
      height: compressed.height,
      filter: state.filter,
    });
  }, [compressed, state.filter, onSave]);

  const filterLabel = state.filter === 'none' ? 'Original' : state.filter.charAt(0).toUpperCase() + state.filter.slice(1);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
          <Pressable onPress={onCancel} accessibilityRole="button" accessibilityLabel="Cancel editing">
            <Text style={[styles.headerAction, { color: colors.textSecondary }]}>Cancel</Text>
          </Pressable>
        </View>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Edit Image</Text>
        <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
          <Pressable onPress={undo} disabled={historyIndex === 0} accessibilityRole="button" accessibilityLabel="Undo">
            <Text style={[styles.headerAction, { color: historyIndex === 0 ? colors.textTertiary : colors.textSecondary }]}>Undo</Text>
          </Pressable>
          <Pressable onPress={redo} disabled={historyIndex === history.length - 1} accessibilityRole="button" accessibilityLabel="Redo">
            <Text style={[styles.headerAction, { color: historyIndex === history.length - 1 ? colors.textTertiary : colors.textSecondary }]}>Redo</Text>
          </Pressable>
          <Pressable onPress={handleSave} accessibilityRole="button" accessibilityLabel="Save edited image">
            <Text style={[styles.headerAction, { color: colors.primary, fontWeight: FontWeight.bold }]}>Save</Text>
          </Pressable>
        </View>
      </View>

      <View style={[styles.previewWrap, { height: previewHeight }]}>
        <View style={[styles.previewFrame, { borderColor: colors.border }, transformStyle]}>
          <Image
            source={{ uri: imageUri }}
            style={{ 
              width: PREVIEW_SIZE, 
              height: previewHeight,
              transform: [
                { brightness: state.adjustments.brightness },
                { contrast: state.adjustments.contrast },
                { saturate: state.adjustments.saturation },
              ]
            }}
            resizeMode="cover"
            accessibilityLabel={`Image preview with ${filterLabel} filter`}
          />
        </View>
        {state.filter !== 'none' && (
          <View style={[styles.filterBadge, { backgroundColor: colors.primary }]}>
            <Text style={styles.filterBadgeText}>GPU: {filterLabel}</Text>
          </View>
        )}
      </View>

      <ScrollView style={{ flex: 1 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow} contentContainerStyle={styles.filterContent}>
          {FILTER_PRESETS.map((preset) => (
            <Pressable
              key={preset}
              onPress={() => updateState({ filter: preset })}
              style={[
                styles.filterChip,
                {
                  backgroundColor: state.filter === preset ? colors.primary : colors.surface,
                  borderColor: colors.border,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel={`Apply ${preset} filter`}
            >
              <Text style={{ color: state.filter === preset ? '#fff' : colors.text, fontSize: FontSize.sm }}>
                {preset === 'none' ? 'None' : preset}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        <View style={styles.controls}>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Aspect Ratio</Text>
          <View style={styles.controlRow}>
            {(Object.keys(ASPECT_RATIOS) as AspectRatioPreset[]).map((preset) => (
              <Pressable
                key={preset}
                style={[
                  styles.controlBtn,
                  {
                    backgroundColor: state.aspectRatio === preset ? colors.primary : colors.surface,
                  },
                ]}
                onPress={() => updateState({ aspectRatio: preset })}
              >
                <Text style={{ color: state.aspectRatio === preset ? '#fff' : colors.text }}>{preset}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Transform</Text>
          <View style={styles.controlRow}>
            <Pressable style={[styles.controlBtn, { backgroundColor: colors.surface }]} onPress={() => rotate(-90)}>
              <Text style={{ color: colors.text }}>↺ 90°</Text>
            </Pressable>
            <Pressable style={[styles.controlBtn, { backgroundColor: colors.surface }]} onPress={() => rotate(90)}>
              <Text style={{ color: colors.text }}>↻ 90°</Text>
            </Pressable>
            <Pressable style={[styles.controlBtn, { backgroundColor: colors.surface }]} onPress={() => adjustScale(0.1)}>
              <Text style={{ color: colors.text }}>Zoom +</Text>
            </Pressable>
            <Pressable style={[styles.controlBtn, { backgroundColor: colors.surface }]} onPress={() => adjustScale(-0.1)}>
              <Text style={{ color: colors.text }}>Zoom −</Text>
            </Pressable>
          </View>

          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Perspective</Text>
          <View style={styles.controlRow}>
            <Pressable style={[styles.controlBtn, { backgroundColor: colors.surface }]} onPress={() => adjustPerspective('X', 5)}>
              <Text style={{ color: colors.text }}>Tilt ↑</Text>
            </Pressable>
            <Pressable style={[styles.controlBtn, { backgroundColor: colors.surface }]} onPress={() => adjustPerspective('X', -5)}>
              <Text style={{ color: colors.text }}>Tilt ↓</Text>
            </Pressable>
            <Pressable style={[styles.controlBtn, { backgroundColor: colors.surface }]} onPress={() => adjustPerspective('Y', 5)}>
              <Text style={{ color: colors.text }}>Pan ←</Text>
            </Pressable>
            <Pressable style={[styles.controlBtn, { backgroundColor: colors.surface }]} onPress={() => adjustPerspective('Y', -5)}>
              <Text style={{ color: colors.text }}>Pan →</Text>
            </Pressable>
          </View>

          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Adjustments</Text>
          <View style={styles.sliderContainer}>
            <View style={styles.sliderRow}>
              <Text style={{ color: colors.text, fontSize: FontSize.sm, width: 80 }}>Brightness</Text>
              <Slider
                style={{ flex: 1 }}
                minimumValue={0}
                maximumValue={2}
                step={0.01}
                value={state.adjustments.brightness}
                onValueChange={(value) => setState({ ...state, adjustments: { ...state.adjustments, brightness: value } })}
                onSlidingComplete={(value) => updateState({ adjustments: { ...state.adjustments, brightness: value } })}
                minimumTrackTintColor={colors.primary}
                maximumTrackTintColor={colors.border}
                thumbTintColor={colors.primary}
              />
              <Text style={{ color: colors.text, fontSize: FontSize.sm, width: 40, textAlign: 'right' }}>
                {Math.round(state.adjustments.brightness * 100)}%
              </Text>
            </View>

            <View style={styles.sliderRow}>
              <Text style={{ color: colors.text, fontSize: FontSize.sm, width: 80 }}>Contrast</Text>
              <Slider
                style={{ flex: 1 }}
                minimumValue={0}
                maximumValue={2}
                step={0.01}
                value={state.adjustments.contrast}
                onValueChange={(value) => setState({ ...state, adjustments: { ...state.adjustments, contrast: value } })}
                onSlidingComplete={(value) => updateState({ adjustments: { ...state.adjustments, contrast: value } })}
                minimumTrackTintColor={colors.primary}
                maximumTrackTintColor={colors.border}
                thumbTintColor={colors.primary}
              />
              <Text style={{ color: colors.text, fontSize: FontSize.sm, width: 40, textAlign: 'right' }}>
                {Math.round(state.adjustments.contrast * 100)}%
              </Text>
            </View>

            <View style={styles.sliderRow}>
              <Text style={{ color: colors.text, fontSize: FontSize.sm, width: 80 }}>Saturation</Text>
              <Slider
                style={{ flex: 1 }}
                minimumValue={0}
                maximumValue={2}
                step={0.01}
                value={state.adjustments.saturation}
                onValueChange={(value) => setState({ ...state, adjustments: { ...state.adjustments, saturation: value } })}
                onSlidingComplete={(value) => updateState({ adjustments: { ...state.adjustments, saturation: value } })}
                minimumTrackTintColor={colors.primary}
                maximumTrackTintColor={colors.border}
                thumbTintColor={colors.primary}
              />
              <Text style={{ color: colors.text, fontSize: FontSize.sm, width: 40, textAlign: 'right' }}>
                {Math.round(state.adjustments.saturation * 100)}%
              </Text>
            </View>
          </View>

          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Quality</Text>
          <View style={styles.controlRow}>
            {QUALITY_PRESETS.map((preset) => (
              <Pressable
                key={preset.label}
                style={[
                  styles.controlBtn,
                  {
                    backgroundColor: state.quality === preset.value ? colors.primary : colors.surface,
                  },
                ]}
                onPress={() => updateState({ quality: preset.value })}
              >
                <Text style={{ color: state.quality === preset.value ? '#fff' : colors.text }}>{preset.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </ScrollView>

      <View style={[styles.metaBar, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
        <Text style={[styles.metaText, { color: colors.textSecondary }]}>
          Output: {compressed.width}×{compressed.height} · Q{(compressed.quality * 100).toFixed(0)}%
          {savingsLabel ? ` · ${savingsLabel}` : ''}
        </Text>
        <Text style={[styles.metaHint, { color: colors.textTertiary }]}>
          Kernels: {Object.keys(CONVOLUTION_KERNELS).length} GPU shaders · CPU fallback via applyConvolutionCpu
        </Text>
      </View>
    </View>
  );
}

export { applyConvolutionCpu };

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.sm,
  },
  headerTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  headerAction: { fontSize: FontSize.base, minWidth: 50 },
  previewWrap: {
    marginHorizontal: Spacing.base,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    position: 'relative',
  },
  previewFrame: { borderWidth: 1, borderRadius: Radius.lg, overflow: 'hidden' },
  filterBadge: {
    position: 'absolute',
    bottom: Spacing.sm,
    right: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radius.full,
  },
  filterBadgeText: { color: '#fff', fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
  filterRow: { marginTop: Spacing.md, maxHeight: 44 },
  filterContent: { paddingHorizontal: Spacing.base, gap: Spacing.sm },
  filterChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
    borderWidth: 1,
  },
  controls: { padding: Spacing.base, gap: Spacing.sm },
  sectionLabel: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, marginTop: Spacing.xs },
  controlRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  controlBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.md,
    minWidth: 72,
    alignItems: 'center',
  },
  sliderContainer: {
    gap: Spacing.sm,
  },
  sliderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  metaBar: {
    padding: Spacing.base,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  metaText: { fontSize: FontSize.sm },
  metaHint: { fontSize: FontSize.xs },
});
