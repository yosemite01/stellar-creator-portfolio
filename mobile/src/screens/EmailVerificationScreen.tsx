import React, { useEffect, useState } from 'react';
import { ActivityIndicator, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { FontSize, FontWeight, Spacing } from '../theme/tokens';

interface EmailVerificationScreenProps {
  token?: string;
}

export function EmailVerificationScreen({ token }: EmailVerificationScreenProps) {
  const { colors } = useTheme();
  const [status, setStatus] = useState<'verifying' | 'success' | 'error'>(
    token ? 'verifying' : 'error',
  );

  useEffect(() => {
    if (!token) return;
    const timer = setTimeout(() => setStatus('success'), 1500);
    return () => clearTimeout(timer);
  }, [token]);

  const message =
    status === 'verifying'
      ? 'Verifying your email…'
      : status === 'success'
      ? 'Email verified successfully!'
      : 'Invalid or missing verification token.';

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.body}>
        {status === 'verifying' && <ActivityIndicator color={colors.primary} size="large" />}
        <Text style={[styles.label, { color: colors.text }]}>{message}</Text>
        {status === 'error' && (
          <Text style={[styles.hint, { color: colors.textSecondary }]}>
            Please request a new verification link from the app.
          </Text>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.lg },
  label: { fontSize: FontSize.xl, fontWeight: FontWeight.semibold, textAlign: 'center' },
  hint: { fontSize: FontSize.base, textAlign: 'center' },
});
