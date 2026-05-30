/**
 * Static StyleSheet definitions and theme palettes for {@link GlobalHeader}.
 *
 * Keeping every style here (rather than inline in the component) avoids
 * recreating style objects on each render and keeps the component body lean.
 */
import { StyleSheet } from 'react-native';
import {
  DarkColors,
  FontSize,
  FontWeight,
  LightColors,
  Spacing,
} from '../theme/tokens';

/** Fixed height of the header content row (excludes the status-bar inset). */
export const HEADER_CONTENT_HEIGHT = 56;

/** Width reserved for the leading / trailing action slots so the title stays centered. */
const SIDE_SLOT_MIN_WIDTH = 48;

/** Resolved color palette for a single color scheme. */
export interface HeaderPalette {
  background: string;
  border: string;
  title: string;
  icon: string;
}

/**
 * Semantic header colors per color scheme, derived from the shared design
 * tokens so the header stays in sync with the rest of the app.
 */
export const headerPalette: Record<'light' | 'dark', HeaderPalette> = {
  light: {
    background: LightColors.surface,
    border: LightColors.border,
    title: LightColors.text,
    icon: LightColors.text,
  },
  dark: {
    background: DarkColors.surface,
    border: DarkColors.border,
    title: DarkColors.text,
    icon: DarkColors.text,
  },
};

export const styles = StyleSheet.create({
  container: {
    width: '100%',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  row: {
    height: HEADER_CONTENT_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.base,
  },
  sideLeft: {
    minWidth: SIDE_SLOT_MIN_WIDTH,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  sideRight: {
    minWidth: SIDE_SLOT_MIN_WIDTH,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  backButton: {
    paddingVertical: Spacing.xs,
    paddingRight: Spacing.sm,
  },
  backLabel: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.regular,
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: FontSize.lg,
    fontWeight: FontWeight.semibold,
  },
});
