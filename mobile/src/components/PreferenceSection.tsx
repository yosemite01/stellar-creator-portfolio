/**
 * PreferenceSection Component
 * Groups related preference items with header
 */

import React, { memo } from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface PreferenceSectionProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  icon?: string;
}

export const PreferenceSection = memo<PreferenceSectionProps>(({
  title,
  description,
  children,
  icon,
}) => {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        {icon && <Text style={styles.icon}>{icon}</Text>}
        <View style={styles.headerTextContainer}>
          <Text style={styles.title}>{title}</Text>
          {description && (
            <Text style={styles.description}>{description}</Text>
          )}
        </View>
      </View>
      <View style={styles.content}>
        {children}
      </View>
    </View>
  );
});

PreferenceSection.displayName = 'PreferenceSection';

const styles = StyleSheet.create({
  container: {
    marginBottom: 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#f9fafb',
  },
  icon: {
    fontSize: 24,
    marginRight: 12,
  },
  headerTextContainer: {
    flex: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 4,
  },
  description: {
    fontSize: 13,
    color: '#6b7280',
    lineHeight: 18,
  },
  content: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    overflow: 'hidden',
    marginTop: 8,
    marginHorizontal: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
});
