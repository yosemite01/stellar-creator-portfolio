import React from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { FontSize, FontWeight, Spacing } from '../theme/tokens';

interface BountyDetailScreenProps {
  bountyId: string;
  onBack?: () => void;
}

export function BountyDetailScreen({ bountyId, onBack }: BountyDetailScreenProps) {
  const { colors } = useTheme();

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        {onBack && (
          <Pressable onPress={onBack} accessibilityRole="button">
            <Text style={[styles.back, { color: colors.primary }]}>← Back</Text>
          </Pressable>
        )}
        <Text style={[styles.title, { color: colors.text }]}>Bounty</Text>
      </View>
      <View style={styles.body}>
        <Text style={[styles.id, { color: colors.textSecondary }]}>ID: {bountyId}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { padding: Spacing.lg, gap: Spacing.xs },
  back: { fontSize: FontSize.base, fontWeight: FontWeight.medium },
  title: { fontSize: FontSize['2xl'], fontWeight: FontWeight.bold },
  body: { flex: 1, padding: Spacing.lg },
  id: { fontSize: FontSize.sm },
});
