import React from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { FontSize, FontWeight, Radius, Spacing } from '../theme/tokens';

interface PaymentCompleteScreenProps {
  paymentId?: string;
  status?: string;
  onBack?: () => void;
}

export function PaymentCompleteScreen({ paymentId, status = 'completed', onBack }: PaymentCompleteScreenProps) {
  const { colors } = useTheme();
  const isSuccess = status !== 'failed';

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.body}>
        <Text style={styles.icon}>{isSuccess ? '✅' : '❌'}</Text>
        <Text style={[styles.title, { color: colors.text }]}>
          {isSuccess ? 'Payment Complete' : 'Payment Failed'}
        </Text>
        <Text style={[styles.description, { color: colors.textSecondary }]}>
          {isSuccess
            ? 'Your payment was processed successfully and is now held in escrow.'
            : 'Something went wrong processing your payment. Please try again.'}
        </Text>
        {paymentId && (
          <Text style={[styles.id, { color: colors.textTertiary }]}>Ref: {paymentId}</Text>
        )}
        {onBack && (
          <Pressable
            style={[styles.button, { backgroundColor: colors.primary }]}
            onPress={onBack}
            accessibilityRole="button"
          >
            <Text style={styles.buttonText}>Return to App</Text>
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing['2xl'],
    gap: Spacing.base,
  },
  icon: { fontSize: 64 },
  title: { fontSize: FontSize['2xl'], fontWeight: FontWeight.bold, textAlign: 'center' },
  description: { fontSize: FontSize.base, textAlign: 'center', lineHeight: 24 },
  id: { fontSize: FontSize.xs, fontFamily: 'monospace' },
  button: {
    marginTop: Spacing.lg,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing['2xl'],
    borderRadius: Radius.xl,
  },
  buttonText: { color: '#ffffff', fontSize: FontSize.base, fontWeight: FontWeight.semibold },
});
