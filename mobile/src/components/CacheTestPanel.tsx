/**
 * CacheTestPanel Component
 * Interactive panel for testing cache functionality
 */

import React, { memo, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { CacheService } from '../services/CacheService';

export const CacheTestPanel: React.FC = memo(() => {
  const [key, setKey] = useState('test-key');
  const [value, setValue] = useState('Hello, Cache!');
  const [ttl, setTtl] = useState('60000'); // 1 minute
  const [retrievedValue, setRetrievedValue] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const handleSet = useCallback(async () => {
    if (!key.trim()) {
      Alert.alert('Error', 'Please enter a cache key');
      return;
    }

    setLoading(true);
    try {
      const ttlMs = parseInt(ttl) || undefined;
      const success = await CacheService.set(key, value, { ttl: ttlMs });
      
      if (success) {
        Alert.alert('Success', `Cached "${key}" successfully!`);
      } else {
        Alert.alert('Error', 'Failed to cache data');
      }
    } catch (error) {
      Alert.alert('Error', 'An error occurred while caching');
    } finally {
      setLoading(false);
    }
  }, [key, value, ttl]);

  const handleGet = useCallback(async () => {
    if (!key.trim()) {
      Alert.alert('Error', 'Please enter a cache key');
      return;
    }

    setLoading(true);
    try {
      const cached = await CacheService.get<string>(key);
      
      if (cached !== null) {
        setRetrievedValue(cached);
        Alert.alert('Success', `Retrieved: "${cached}"`);
      } else {
        setRetrievedValue('');
        Alert.alert('Not Found', 'No cached data found for this key');
      }
    } catch (error) {
      Alert.alert('Error', 'An error occurred while retrieving');
    } finally {
      setLoading(false);
    }
  }, [key]);

  const handleRemove = useCallback(async () => {
    if (!key.trim()) {
      Alert.alert('Error', 'Please enter a cache key');
      return;
    }

    setLoading(true);
    try {
      const success = await CacheService.remove(key);
      
      if (success) {
        setRetrievedValue('');
        Alert.alert('Success', `Removed "${key}" from cache`);
      } else {
        Alert.alert('Error', 'Failed to remove from cache');
      }
    } catch (error) {
      Alert.alert('Error', 'An error occurred while removing');
    } finally {
      setLoading(false);
    }
  }, [key]);

  const handleHas = useCallback(async () => {
    if (!key.trim()) {
      Alert.alert('Error', 'Please enter a cache key');
      return;
    }

    setLoading(true);
    try {
      const exists = await CacheService.has(key);
      Alert.alert(
        'Cache Check',
        exists ? `✓ "${key}" exists in cache` : `✗ "${key}" not found in cache`
      );
    } catch (error) {
      Alert.alert('Error', 'An error occurred while checking');
    } finally {
      setLoading(false);
    }
  }, [key]);

  const handleTestPerformance = useCallback(async () => {
    setLoading(true);
    try {
      const iterations = 100;
      const testKey = 'perf-test';
      const testData = { message: 'Performance test data', timestamp: Date.now() };

      // Test write performance
      const writeStart = Date.now();
      for (let i = 0; i < iterations; i++) {
        await CacheService.set(`${testKey}-${i}`, testData);
      }
      const writeTime = Date.now() - writeStart;

      // Test read performance
      const readStart = Date.now();
      for (let i = 0; i < iterations; i++) {
        await CacheService.get(`${testKey}-${i}`);
      }
      const readTime = Date.now() - readStart;

      // Cleanup
      for (let i = 0; i < iterations; i++) {
        await CacheService.remove(`${testKey}-${i}`);
      }

      Alert.alert(
        'Performance Test',
        `${iterations} iterations:\n\n` +
        `Write: ${writeTime}ms (${(writeTime / iterations).toFixed(2)}ms avg)\n` +
        `Read: ${readTime}ms (${(readTime / iterations).toFixed(2)}ms avg)`
      );
    } catch (error) {
      Alert.alert('Error', 'Performance test failed');
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>🧪 Cache Testing</Text>

      {/* Key Input */}
      <View style={styles.inputGroup}>
        <Text style={styles.label}>Cache Key</Text>
        <TextInput
          style={styles.input}
          value={key}
          onChangeText={setKey}
          placeholder="Enter cache key"
          placeholderTextColor="#9ca3af"
        />
      </View>

      {/* Value Input */}
      <View style={styles.inputGroup}>
        <Text style={styles.label}>Value</Text>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={setValue}
          placeholder="Enter value to cache"
          placeholderTextColor="#9ca3af"
          multiline
        />
      </View>

      {/* TTL Input */}
      <View style={styles.inputGroup}>
        <Text style={styles.label}>TTL (milliseconds)</Text>
        <TextInput
          style={styles.input}
          value={ttl}
          onChangeText={setTtl}
          placeholder="60000"
          placeholderTextColor="#9ca3af"
          keyboardType="numeric"
        />
      </View>

      {/* Retrieved Value Display */}
      {retrievedValue !== '' && (
        <View style={styles.resultCard}>
          <Text style={styles.resultLabel}>Retrieved Value:</Text>
          <Text style={styles.resultValue}>{retrievedValue}</Text>
        </View>
      )}

      {/* Action Buttons */}
      {loading ? (
        <ActivityIndicator size="large" color="#6366f1" style={styles.loader} />
      ) : (
        <>
          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={[styles.button, styles.primaryButton]}
              onPress={handleSet}
            >
              <Text style={styles.primaryButtonText}>💾 Set</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.button, styles.secondaryButton]}
              onPress={handleGet}
            >
              <Text style={styles.secondaryButtonText}>📥 Get</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={[styles.button, styles.secondaryButton]}
              onPress={handleHas}
            >
              <Text style={styles.secondaryButtonText}>🔍 Check</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.button, styles.dangerButton]}
              onPress={handleRemove}
            >
              <Text style={styles.dangerButtonText}>🗑️ Remove</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.button, styles.performanceButton]}
            onPress={handleTestPerformance}
          >
            <Text style={styles.performanceButtonText}>⚡ Performance Test</Text>
          </TouchableOpacity>
        </>
      )}

      {/* Info */}
      <View style={styles.infoCard}>
        <Text style={styles.infoText}>
          💡 Test cache operations with custom keys and values. TTL is optional (leave empty for no expiration).
        </Text>
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
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: 16,
  },
  inputGroup: {
    marginBottom: 12,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#f9fafb',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    color: '#111827',
  },
  resultCard: {
    backgroundColor: '#eff6ff',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#dbeafe',
  },
  resultLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1e40af',
    marginBottom: 4,
  },
  resultValue: {
    fontSize: 14,
    color: '#1e40af',
    fontFamily: 'monospace',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  button: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButton: {
    backgroundColor: '#6366f1',
  },
  primaryButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
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
  performanceButton: {
    backgroundColor: '#10b981',
    marginBottom: 12,
  },
  performanceButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
  },
  loader: {
    marginVertical: 20,
  },
  infoCard: {
    backgroundColor: '#fef3c7',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#fde68a',
  },
  infoText: {
    fontSize: 12,
    color: '#92400e',
    lineHeight: 18,
  },
});
