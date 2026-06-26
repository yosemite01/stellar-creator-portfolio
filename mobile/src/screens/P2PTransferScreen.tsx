import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import {
  estimateFee,
  submitTransfer,
  lookupUserByAddress,
  XLMTransferParams,
  FeeEstimate,
} from '../services/PeerTransferService';
import { getBiometricSupport, authenticateBiometric } from '../services/BiometricAuthService';
import { FontSize, FontWeight, Radius, Spacing } from '../theme/tokens';
import { trigger as triggerHaptic } from '../haptics/HapticEngine';

type TransferStep = 'amount' | 'qrScan' | 'preview' | 'biometric' | 'submit' | 'success';

interface TransferState {
  step: TransferStep;
  amount: string;
  token: 'XLM' | 'USDC' | 'EURC';
  recipientAddress: string;
  recipientName?: string;
  feeEstimate: FeeEstimate | null;
  transactionHash?: string;
  error?: string;
  isLoading: boolean;
}

export function P2PTransferScreen() {
  const { colors, isDark } = useTheme();
  const [state, setState] = useState<TransferState>({
    step: 'amount',
    amount: '',
    token: 'XLM',
    recipientAddress: '',
    feeEstimate: null,
    isLoading: false,
  });

  const isValidStellarAddress = (address: string): boolean => /^G[A-Z2-7]{55}$/.test(address.trim());

  const handleAmountChange = (text: string) => {
    setState((prev) => ({ ...prev, amount: text }));
  };

  const handleTokenSelect = (token: 'XLM' | 'USDC' | 'EURC') => {
    setState((prev) => ({ ...prev, token }));
  };

  const handleQRScan = useCallback(async () => {
    // TODO: Integrate expo-barcode-scanner for real QR scanning
    // For now, navigate to QR scanner placeholder
    setState((prev) => ({ ...prev, error: undefined }));
  }, []);

  const handleRecipientChange = useCallback(
    async (address: string) => {
      setState((prev) => ({ ...prev, recipientAddress: address, error: undefined }));

      if (!isValidStellarAddress(address)) {
        if (address.length > 10) {
          setState((prev) => ({
            ...prev,
            error: 'Invalid Stellar address (must start with G and be 56 characters)',
          }));
        }
        return;
      }

      // Lookup user by address
      const user = await lookupUserByAddress(address);
      setState((prev) => ({
        ...prev,
        recipientName: user?.name,
      }));
    },
    [],
  );

  const handlePreview = useCallback(async () => {
    if (!state.amount || parseFloat(state.amount) <= 0) {
      setState((prev) => ({ ...prev, error: 'Please enter a valid amount' }));
      return;
    }

    if (!isValidStellarAddress(state.recipientAddress)) {
      setState((prev) => ({
        ...prev,
        error: 'Please enter a valid recipient address',
      }));
      return;
    }

    setState((prev) => ({ ...prev, isLoading: true }));

    try {
      const params: XLMTransferParams = {
        amount: parseFloat(state.amount),
        recipientAddress: state.recipientAddress,
        token: state.token,
      };

      const feeEstimate = await estimateFee(params);
      setState((prev) => ({
        ...prev,
        feeEstimate,
        step: 'preview',
        isLoading: false,
      }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to estimate fee',
        isLoading: false,
      }));
    }
  }, [state.amount, state.recipientAddress, state.token]);

  const handleBiometricAuth = useCallback(async () => {
    const amount = parseFloat(state.amount);
    const requiresBiometric = amount > 10; // > 10 XLM

    if (!requiresBiometric) {
      setState((prev) => ({ ...prev, step: 'submit' }));
      return;
    }

    try {
      const result = await authenticateBiometric();
      if (result.success) {
        setState((prev) => ({ ...prev, step: 'submit' }));
        await triggerHaptic('success');
      } else {
        setState((prev) => ({
          ...prev,
          error: result.error || 'Biometric authentication failed',
        }));
      }
    } catch (error) {
      setState((prev) => ({
        ...prev,
        error: 'Authentication failed',
      }));
    }
  }, [state.amount]);

  const handleSubmit = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true }));

    try {
      // Mock keypair for demonstration
      const sourceKeypair = {
        publicKey: 'GBRPYHIL2CI3WHZKZMFNC7ARYKPYGTNUQSUW35DTLM3NNLRCXHZ45V2M',
        secretKey: 'mock-secret-key',
      };

      const params: XLMTransferParams = {
        amount: parseFloat(state.amount),
        recipientAddress: state.recipientAddress,
        token: state.token,
      };

      const result = await submitTransfer(params, sourceKeypair);

      if (result.success && result.hash) {
        setState((prev) => ({
          ...prev,
          step: 'success',
          transactionHash: result.hash,
          isLoading: false,
        }));
        await triggerHaptic('success');
      } else {
        setState((prev) => ({
          ...prev,
          error: result.error || 'Transfer failed',
          isLoading: false,
        }));
      }
    } catch (error) {
      setState((prev) => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Transfer failed',
        isLoading: false,
      }));
    }
  }, [state.amount, state.recipientAddress, state.token]);

  const handleViewTx = useCallback(() => {
    if (state.transactionHash) {
      const network = 'public'; // or 'testnet'
      Linking.openURL(
        `https://stellar.expert/explorer/${network}/tx/${state.transactionHash}`,
      );
    }
  }, [state.transactionHash]);

  const handleReset = () => {
    setState({
      step: 'amount',
      amount: '',
      token: 'XLM',
      recipientAddress: '',
      feeEstimate: null,
      isLoading: false,
    });
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

      {state.step === 'amount' && (
        <View style={[styles.container, { backgroundColor: colors.surface }]}>
          <Text style={[styles.header, { color: colors.text }]}>Send XLM</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Step 1 of 6: Enter amount and select token
          </Text>

          <View style={[styles.card, { backgroundColor: colors.surfaceElevated }]}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Amount</Text>
            <TextInput
              style={[
                styles.input,
                {
                  borderColor: colors.border,
                  color: colors.text,
                  backgroundColor: colors.background,
                },
              ]}
              placeholder="0.00"
              placeholderTextColor={colors.textSecondary}
              keyboardType="decimal-pad"
              value={state.amount}
              onChangeText={handleAmountChange}
            />

            <Text style={[styles.label, { color: colors.textSecondary, marginTop: Spacing.lg }]}>
              Token
            </Text>
            <View style={styles.tokenSelector}>
              {(['XLM', 'USDC', 'EURC'] as const).map((token) => (
                <Pressable
                  key={token}
                  onPress={() => handleTokenSelect(token)}
                  style={({ pressed }) => [
                    styles.tokenButton,
                    {
                      backgroundColor:
                        state.token === token ? colors.primary : colors.border,
                      opacity: pressed ? 0.7 : 1,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.tokenText,
                      {
                        color:
                          state.token === token ? colors.textInverse : colors.text,
                      },
                    ]}
                  >
                    {token}
                  </Text>
                </Pressable>
              ))}
            </View>

            {state.error && (
              <Text style={[styles.error, { color: '#ef4444' }]}>
                {state.error}
              </Text>
            )}

            <Pressable
              onPress={handlePreview}
              disabled={state.isLoading}
              style={({ pressed }) => [
                styles.actionButton,
                {
                  backgroundColor: state.isLoading
                    ? colors.border
                    : pressed
                      ? colors.primaryLight
                      : colors.primary,
                },
              ]}
            >
              {state.isLoading ? (
                <ActivityIndicator color={colors.textInverse} />
              ) : (
                <Text style={[styles.actionText, { color: colors.textInverse }]}>
                  Next: Scan Recipient
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      )}

      {state.step === 'preview' && (
        <View style={[styles.container, { backgroundColor: colors.surface }]}>
          <Text style={[styles.header, { color: colors.text }]}>Confirm Transfer</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Step 3 of 6: Review details
          </Text>

          <View style={[styles.card, { backgroundColor: colors.surfaceElevated }]}>
            <View style={styles.previewRow}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>
                Amount
              </Text>
              <Text style={[styles.value, { color: colors.text }]}>
                {state.amount} {state.token}
              </Text>
            </View>

            <View style={styles.previewRow}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>
                Recipient
              </Text>
              <Text style={[styles.value, { color: colors.text }]}>
                {state.recipientName || state.recipientAddress.slice(0, 12)}...
              </Text>
            </View>

            {state.feeEstimate && (
              <>
                <View style={styles.previewRow}>
                  <Text style={[styles.label, { color: colors.textSecondary }]}>
                    Network Fee
                  </Text>
                  <Text style={[styles.value, { color: colors.text }]}>
                    {(state.feeEstimate.totalFee / 10_000_000).toFixed(7)} XLM
                  </Text>
                </View>

                <View
                  style={[
                    styles.previewRow,
                    {
                      borderTopWidth: 1,
                      borderTopColor: colors.border,
                      paddingTopMargin: Spacing.lg,
                    },
                  ]}
                >
                  <Text style={[styles.label, { color: colors.textSecondary }]}>
                    Total Cost
                  </Text>
                  <Text
                    style={[
                      styles.value,
                      { color: colors.text, fontWeight: FontWeight.bold },
                    ]}
                  >
                    {state.feeEstimate.totalCostInXLM.toFixed(7)} XLM
                  </Text>
                </View>
              </>
            )}

            {state.error && (
              <Text style={[styles.error, { color: '#ef4444' }]}>
                {state.error}
              </Text>
            )}

            <Pressable
              onPress={handleBiometricAuth}
              disabled={state.isLoading}
              style={({ pressed }) => [
                styles.actionButton,
                {
                  backgroundColor: state.isLoading
                    ? colors.border
                    : pressed
                      ? colors.primaryLight
                      : colors.primary,
                },
              ]}
            >
              {state.isLoading ? (
                <ActivityIndicator color={colors.textInverse} />
              ) : (
                <Text style={[styles.actionText, { color: colors.textInverse }]}>
                  {parseFloat(state.amount) > 10 ? 'Authenticate & Continue' : 'Continue'}
                </Text>
              )}
            </Pressable>

            <Pressable
              onPress={() => setState((prev) => ({ ...prev, step: 'amount' }))}
              style={({ pressed }) => [
                styles.secondaryButton,
                { opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Text style={[styles.secondaryText, { color: colors.primary }]}>
                Back
              </Text>
            </Pressable>
          </View>
        </View>
      )}

      {state.step === 'success' && (
        <View style={[styles.container, { backgroundColor: colors.surface }]}>
          <Text style={[styles.header, { color: colors.text }]}>Transfer Complete</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Step 6 of 6: Success
          </Text>

          <View style={[styles.card, { backgroundColor: colors.surfaceElevated }]}>
            <View style={styles.successIcon}>
              <Text style={styles.successText}>✓</Text>
            </View>

            {state.transactionHash && (
              <>
                <Text style={[styles.value, { color: colors.text, textAlign: 'center' }]}>
                  {state.amount} {state.token} sent successfully
                </Text>

                <View style={styles.hashContainer}>
                  <Text style={[styles.label, { color: colors.textSecondary }]}>
                    Transaction Hash
                  </Text>
                  <Text
                    style={[styles.hashText, { color: colors.text }]}
                    numberOfLines={2}
                  >
                    {state.transactionHash}
                  </Text>
                </View>

                <Pressable
                  onPress={handleViewTx}
                  style={({ pressed }) => [
                    styles.actionButton,
                    {
                      backgroundColor: pressed
                        ? colors.primaryLight
                        : colors.primary,
                      opacity: pressed ? 0.7 : 1,
                    },
                  ]}
                >
                  <Text style={[styles.actionText, { color: colors.textInverse }]}>
                    View on Stellar.Expert
                  </Text>
                </Pressable>
              </>
            )}

            <Pressable
              onPress={handleReset}
              style={({ pressed }) => [
                styles.secondaryButton,
                { opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Text style={[styles.secondaryText, { color: colors.primary }]}>
                Send Another
              </Text>
            </Pressable>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, paddingBottom: Spacing.base },
  container: {
    flex: 1,
    padding: Spacing.base,
  },
  header: {
    fontSize: FontSize['3xl'],
    fontWeight: FontWeight.extrabold,
    marginBottom: Spacing.xs,
  },
  subtitle: {
    fontSize: FontSize.sm,
    marginBottom: Spacing.lg,
    lineHeight: 20,
  },
  card: {
    borderRadius: Radius.xl,
    borderWidth: 1,
    padding: Spacing.lg,
    gap: Spacing.lg,
  },
  label: {
    fontSize: FontSize.xs,
    textTransform: 'uppercase',
    fontWeight: FontWeight.semibold,
    marginBottom: Spacing.sm,
    letterSpacing: 0.5,
  },
  value: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.medium,
    lineHeight: 24,
  },
  input: {
    borderWidth: 1,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.sm,
    fontSize: FontSize.base,
    fontWeight: FontWeight.medium,
  },
  tokenSelector: {
    flexDirection: 'row',
    gap: Spacing.sm,
    justifyContent: 'space-around',
  },
  tokenButton: {
    flex: 1,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.lg,
    alignItems: 'center',
  },
  tokenText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
  },
  error: {
    fontSize: FontSize.sm,
    marginTop: Spacing.sm,
  },
  actionButton: {
    marginTop: Spacing.lg,
    borderRadius: Radius.lg,
    paddingVertical: Spacing.base,
    paddingHorizontal: Spacing.base,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  actionText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
  },
  secondaryButton: {
    marginTop: Spacing.md,
    paddingVertical: Spacing.sm,
    alignItems: 'center',
  },
  secondaryText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
  },
  previewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  hashContainer: {
    marginVertical: Spacing.lg,
    padding: Spacing.base,
    borderRadius: Radius.lg,
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  hashText: {
    fontSize: FontSize.xs,
    fontFamily: 'monospace',
    marginTop: Spacing.xs,
  },
  successIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#10b981',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: Spacing.lg,
  },
  successText: {
    fontSize: FontSize['3xl'],
    color: '#fff',
  },
});
