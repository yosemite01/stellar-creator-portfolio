/**
 * CacheMetricsCard Component
 * Displays cache performance metrics and statistics
 */

import React, { memo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { CacheMetrics } from '../services/CacheService';

interface CacheMetricsCardProps {
  metrics: CacheMetrics | null;
  loading: boolean;
  onRefresh: () => void;
  onClearCache: () => void;
  onPruneExpired: () => void;
}

export const CacheMetricsCard: React.FC<CacheMetricsCardProps> = memo(({
  metrics,
  loading,
  onRefresh,
  onClearCache,
  onPruneExpired,
}) => {
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  };

  const formatPercentage = (value: number): string => {
    return `${value.toFixed(1)}%`;
  };

  const formatTime = (ms: number): string => {
    if (ms < 1) return `${(ms * 1000).toFixed(0)}μs`;
    return `${ms.toFixed(2)}ms`;
  };

  if (loading && !metrics) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#6366f1" />
        <Text style={styles.loadingText}>Loading metrics...</Text>
      </View>
    );
  }

  if (!metrics) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>No metrics available</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>📊 Cache Metrics</Text>
        <TouchableOpacity onPress={onRefresh} disabled={loading}>
          <Text style={styles.refreshButton}>
            {loading ? '⟳' : '↻'} Refresh
          </Text>
        </TouchableOpacity>
      </View>

      {/* Overview Stats */}
      <View style={styles.statsGrid}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{metrics.totalEntries}</Text>
          <Text style={styles.statLabel}>Entries</Text>
        </View>
        
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{formatBytes(metrics.totalSize)}</Text>
          <Text style={styles.statLabel}>Size</Text>
        </View>
        
        <View style={styles.statCard}>
          <Text style={[styles.statValue, styles.successText]}>
            {formatPercentage(metrics.hitRate)}
          </Text>
          <Text style={styles.statLabel}>Hit Rate</Text>
        </View>
        
        <View style={styles.statCard}>
          <Text style={[styles.statValue, styles.warningText]}>
            {formatPercentage(metrics.missRate)}
          </Text>
          <Text style={styles.statLabel}>Miss Rate</Text>
        </View>
      </View>

      {/* Performance */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>⚡ Performance</Text>
        <View style={styles.performanceCard}>
          <View style={styles.performanceRow}>
            <Text style={styles.performanceLabel}>Avg Access Time</Text>
            <Text style={styles.performanceValue}>
              {formatTime(metrics.averageAccessTime)}
            </Text>
          </View>
        </View>
      </View>

      {/* Most Accessed */}
      {metrics.mostAccessed.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🔥 Most Accessed</Text>
          {metrics.mostAccessed.slice(0, 5).map((item, index) => (
            <View key={item.key} style={styles.accessItem}>
              <View style={styles.accessRank}>
                <Text style={styles.accessRankText}>{index + 1}</Text>
              </View>
              <Text style={styles.accessKey} numberOfLines={1}>
                {item.key}
              </Text>
              <Text style={styles.accessCount}>{item.count}×</Text>
            </View>
          ))}
        </View>
      )}

      {/* Actions */}
      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.button, styles.secondaryButton]}
          onPress={onPruneExpired}
        >
          <Text style={styles.secondaryButtonText}>🗑️ Prune Expired</Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={[styles.button, styles.dangerButton]}
          onPress={onClearCache}
        >
          <Text style={styles.dangerButtonText}>🧹 Clear All</Text>
        </TouchableOpacity>
      </View>

      {/* Cache Health Indicator */}
      <View style={styles.healthIndicator}>
        <Text style={styles.healthLabel}>Cache Health:</Text>
        <View style={[
          styles.healthBadge,
          metrics.hitRate >= 70 ? styles.healthGood :
          metrics.hitRate >= 40 ? styles.healthWarning :
          styles.healthPoor
        ]}>
          <Text style={styles.healthBadgeText}>
            {metrics.hitRate >= 70 ? '✓ Excellent' :
             metrics.hitRate >= 40 ? '⚠ Fair' :
             '✗ Poor'}
          </Text>
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#111827',
  },
  refreshButton: {
    fontSize: 14,
    color: '#6366f1',
    fontWeight: '600',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 16,
    gap: 8,
  },
  statCard: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: '#f9fafb',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: '#6b7280',
    fontWeight: '500',
  },
  successText: {
    color: '#10b981',
  },
  warningText: {
    color: '#f59e0b',
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
  },
  performanceCard: {
    backgroundColor: '#f9fafb',
    padding: 12,
    borderRadius: 8,
  },
  performanceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  performanceLabel: {
    fontSize: 14,
    color: '#6b7280',
  },
  performanceValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  accessItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f9fafb',
    padding: 10,
    borderRadius: 6,
    marginBottom: 6,
  },
  accessRank: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#6366f1',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  accessRankText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  accessKey: {
    flex: 1,
    fontSize: 13,
    color: '#374151',
    fontFamily: 'monospace',
  },
  accessCount: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6366f1',
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  button: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButton: {
    backgroundColor: '#ffffff',
    borderWidth: 2,
    borderColor: '#6366f1',
  },
  secondaryButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6366f1',
  },
  dangerButton: {
    backgroundColor: '#ffffff',
    borderWidth: 2,
    borderColor: '#ef4444',
  },
  dangerButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ef4444',
  },
  healthIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
  healthLabel: {
    fontSize: 14,
    color: '#6b7280',
    marginRight: 8,
  },
  healthBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  healthGood: {
    backgroundColor: '#d1fae5',
  },
  healthWarning: {
    backgroundColor: '#fef3c7',
  },
  healthPoor: {
    backgroundColor: '#fee2e2',
  },
  healthBadgeText: {
    fontSize: 13,
    fontWeight: '600',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#6b7280',
  },
  errorText: {
    fontSize: 14,
    color: '#ef4444',
    textAlign: 'center',
  },
});
