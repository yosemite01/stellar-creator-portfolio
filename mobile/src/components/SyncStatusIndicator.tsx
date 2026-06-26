/**
 * SyncStatusIndicator — visual indicator for WatermelonDB sync status.
 *
 * Displays an icon/text badge showing current sync state:
 * - idle: gray dot (last sync successful)
 * - syncing: animated spinner
 * - error: red dot with error icon
 * - offline: orange dot (no network)
 */

import React, { useMemo } from 'react';
import {
  ActivityIndicator,
  Text,
  useColorScheme,
  View,
} from 'react-native';
import type { SyncStatus } from '../../../utils/SyncScheduler';

interface SyncStatusIndicatorProps {
  status: SyncStatus;
}

const STATUS_COLORS = {
  idle: '#10b981', // green
  syncing: '#3b82f6', // blue
  error: '#ef4444', // red
  offline: '#f97316', // orange
};

const STATUS_LABELS: Record<SyncStatus, string> = {
  idle: 'Synced',
  syncing: 'Syncing',
  error: 'Sync failed',
  offline: 'Offline',
};

/**
 * Compact sync status indicator.
 * Shows a colored dot with optional spinner for syncing state.
 */
export function SyncStatusIndicator({ status }: SyncStatusIndicatorProps): React.JSX.Element {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const color = STATUS_COLORS[status];
  const label = STATUS_LABELS[status];
  const textColor = isDark ? '#f3f4f6' : '#1f2937';

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingRight: 12,
        gap: 6,
      }}
      accessibilityLabel={`Sync status: ${label}`}
      accessible
    >
      {status === 'syncing' ? (
        <ActivityIndicator size="small" color={color} />
      ) : (
        <View
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: color,
          }}
        />
      )}
      <Text
        style={{
          fontSize: 12,
          color: textColor,
          fontWeight: '500',
        }}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );
}
