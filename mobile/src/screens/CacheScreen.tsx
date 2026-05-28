/**
 * CacheScreen - Cache Management and Metrics Screen
 * Comprehensive UI for cache testing and performance monitoring
 */

import React, { memo, useCallback } from 'react';
import {
  View,
  StyleSheet,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  RefreshControl,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useCacheMetrics } from '../hooks/useCache';
import { CacheMetricsCard } from '../components/CacheMetricsCard';
import { CacheTestPanel } from '../components/CacheTestPanel';
import { PreferenceSection } from '../components/PreferenceSection';

interface CacheScreenProps {
  onBack?: () => void;
}

export const CacheScreen: React.FC<CacheScreenProps> = memo(({ onBack }) => {
  const {
    metrics,
    loading,
    error,
    refresh,
    clearAllCache,
    pruneExpired,
    exportCache,
  } = useCacheMetrics();

  const [refreshing, setRefreshing] = React.useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  const handleClearCache = useCallback(() => {
    Alert.alert(
      'Clear All Cache',
      'Are you sure you want to clear all cached data? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            await clearAllCache();
            Alert.alert('Success', 'All cache data has been cleared');
          },
        },
      ]
    );
  }, [clearAllCache]);

  const handlePruneExpired = useCallback(async () => {
    const count = await pruneExpired();
    Alert.alert(
      'Prune Complete',
      count > 0
        ? `Removed ${count} expired cache ${count === 1 ? 'entry' : 'entries'}`
        : 'No expired entries found'
    );
  }, [pruneExpired]);

  const handleExportCache = useCallback(async () => {
    const data = await exportCache();
    if (data) {
      Alert.alert(
        'Export Cache',
        `Cache data exported successfully!\n\nSize: ${(data.length / 1024).toFixed(2)} KB`,
        [{ text: 'OK' }]
      );
      // In a real app, you would save this to a file or share it
      console.log('Exported cache data:', data.substring(0, 200) + '...');
    } else {
      Alert.alert('Error', 'Failed to export cache data');
    }
  }, [exportCache]);

  return (
    <View style={styles.container}>
      <StatusBar style="auto" />
      
      <View style={styles.header}>
        {onBack && (
          <TouchableOpacity onPress={onBack} style={styles.backButton}>
            <Text style={styles.backButtonText}>← Back</Text>
          </TouchableOpacity>
        )}
        <Text style={styles.headerTitle}>Cache Manager</Text>
        <TouchableOpacity onPress={handleExportCache}>
          <Text style={styles.exportButton}>📤 Export</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {error && (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>⚠️ {error}</Text>
          </View>
        )}

        {/* Cache Metrics */}
        <PreferenceSection
          title="Performance Metrics"
          description="Real-time cache performance and statistics"
          icon="📊"
        >
          <CacheMetricsCard
            metrics={metrics}
            loading={loading}
            onRefresh={refresh}
            onClearCache={handleClearCache}
            onPruneExpired={handlePruneExpired}
          />
        </PreferenceSection>

        {/* Cache Testing */}
        <PreferenceSection
          title="Testing & Debugging"
          description="Test cache operations and performance"
          icon="🧪"
        >
          <CacheTestPanel />
        </PreferenceSection>

        {/* Cache Information */}
        <PreferenceSection
          title="About Cache"
          description="How caching works in this app"
          icon="ℹ️"
        >
          <View style={styles.infoCard}>
            <Text style={styles.infoTitle}>🚀 Rapid Revisit Metrics</Text>
            <Text style={styles.infoText}>
              This app uses AsyncStorage for native caching, providing:
            </Text>
            <Text style={styles.infoList}>
              • <Text style={styles.infoBold}>Fast Access</Text>: Sub-millisecond retrieval times{'\n'}
              • <Text style={styles.infoBold}>Persistence</Text>: Data survives app restarts{'\n'}
              • <Text style={styles.infoBold}>TTL Support</Text>: Automatic expiration{'\n'}
              • <Text style={styles.infoBold}>LRU Pruning</Text>: Intelligent space management{'\n'}
              • <Text style={styles.infoBold}>Metrics</Text>: Real-time performance tracking
            </Text>
          </View>

          <View style={styles.infoCard}>
            <Text style={styles.infoTitle}>📈 Cache Strategies</Text>
            <Text style={styles.infoList}>
              • <Text style={styles.infoBold}>Cache-Aside</Text>: Load on demand, cache for reuse{'\n'}
              • <Text style={styles.infoBold}>Write-Through</Text>: Update cache and storage together{'\n'}
              • <Text style={styles.infoBold}>TTL-Based</Text>: Automatic expiration for fresh data{'\n'}
              • <Text style={styles.infoBold}>LRU Eviction</Text>: Remove least recently used items
            </Text>
          </View>

          <View style={styles.infoCard}>
            <Text style={styles.infoTitle}>⚡ Performance Tips</Text>
            <Text style={styles.infoList}>
              • Keep cache size under 50MB for optimal performance{'\n'}
              • Use appropriate TTL values for your data{'\n'}
              • Prune expired entries regularly{'\n'}
              • Monitor hit rate (aim for 70%+){'\n'}
              • Clear cache if experiencing issues
            </Text>
          </View>
        </PreferenceSection>

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            Cache data is stored locally and persists across app sessions
          </Text>
        </View>
      </ScrollView>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f3f4f6',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
    paddingTop: 60,
    backgroundColor: '#ffffff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
  },
  backButton: {
    marginRight: 12,
  },
  backButtonText: {
    fontSize: 16,
    color: '#6366f1',
    fontWeight: '600',
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#111827',
    flex: 1,
  },
  exportButton: {
    fontSize: 14,
    color: '#6366f1',
    fontWeight: '600',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  errorCard: {
    backgroundColor: '#fef2f2',
    padding: 16,
    borderRadius: 8,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  errorText: {
    fontSize: 14,
    color: '#dc2626',
  },
  infoCard: {
    backgroundColor: '#f9fafb',
    padding: 16,
    borderRadius: 8,
    marginBottom: 12,
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 8,
  },
  infoText: {
    fontSize: 14,
    color: '#4b5563',
    marginBottom: 8,
    lineHeight: 20,
  },
  infoList: {
    fontSize: 13,
    color: '#4b5563',
    lineHeight: 22,
  },
  infoBold: {
    fontWeight: '600',
    color: '#111827',
  },
  footer: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 13,
    color: '#9ca3af',
    textAlign: 'center',
  },
});
