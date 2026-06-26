/**
 * FeeEstimateDisplay Component
 * Displays fee breakdown for contract operations
 */

import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Pressable,
} from "react-native";
import { useBountyCreationFee } from "../hooks/useFeeEstimation";
import { useTheme } from "../theme/ThemeProvider";
import { FontSize, FontWeight, Radius, Spacing } from "../theme/tokens";

export interface FeeEstimateDisplayProps {
  budget: number | null;
  contract: "bounty" | "escrow";
  onRefresh?: () => void;
  showDisclaimer?: boolean;
}

export function FeeEstimateDisplay({
  budget,
  contract,
  onRefresh,
  showDisclaimer = true,
}: FeeEstimateDisplayProps): React.ReactElement {
  const { colors } = useTheme();
  const { estimate, loading, error, refetch } = useBountyCreationFee(
    contract === "bounty" ? budget : null,
  );

  if (!budget || budget < 0) {
    return <View />;
  }

  return (
    <View style={styles.container}>
      {/* Loading State */}
      {loading && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator
            size="small"
            color={colors.primary}
            style={styles.spinner}
          />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
            Calculating fees...
          </Text>
        </View>
      )}

      {/* Error State */}
      {error && !loading && (
        <View style={[styles.errorContainer, { borderColor: colors.error }]}>
          <Text style={[styles.errorText, { color: colors.error }]}>
            {error}
          </Text>
          {onRefresh && (
            <Pressable onPress={refetch} style={styles.retryButton}>
              <Text style={[styles.retryText, { color: colors.primary }]}>
                Retry
              </Text>
            </Pressable>
          )}
        </View>
      )}

      {/* Fee Breakdown */}
      {estimate && !loading && !error && (
        <View style={[styles.estimateContainer, { backgroundColor: colors.surfaceVariant }]}>
          <Text
            style={[
              styles.title,
              { color: colors.text, fontWeight: FontWeight.bold as any },
            ]}
          >
            Fee Breakdown
          </Text>

          {/* Fee Lines */}
          <View style={styles.feeRow}>
            <Text style={[styles.feeLabel, { color: colors.textSecondary }]}>
              Platform Fee:
            </Text>
            <Text style={[styles.feeValue, { color: colors.text }]}>
              {estimate.platform_fee.toFixed(2)} stroops
            </Text>
          </View>

          <View style={styles.feeRow}>
            <Text style={[styles.feeLabel, { color: colors.textSecondary }]}>
              Network Fee:
            </Text>
            <Text style={[styles.feeValue, { color: colors.text }]}>
              {estimate.network_fee.toFixed(2)} stroops
            </Text>
          </View>

          {estimate.resource_fee > 0 && (
            <View style={styles.feeRow}>
              <Text style={[styles.feeLabel, { color: colors.textSecondary }]}>
                Resource Fee:
              </Text>
              <Text style={[styles.feeValue, { color: colors.text }]}>
                {estimate.resource_fee.toFixed(2)} stroops
              </Text>
            </View>
          )}

          {/* Divider */}
          <View
            style={[
              styles.divider,
              { backgroundColor: colors.textSecondary + "20" },
            ]}
          />

          {/* Total Fee */}
          <View style={styles.feeRow}>
            <Text
              style={[
                styles.totalLabel,
                { color: colors.text, fontWeight: FontWeight.bold as any },
              ]}
            >
              Total Fee:
            </Text>
            <Text
              style={[
                styles.totalValue,
                { color: colors.primary, fontWeight: FontWeight.bold as any },
              ]}
            >
              {estimate.total_fee.toFixed(2)} stroops
            </Text>
          </View>

          {/* Disclaimer */}
          {showDisclaimer && (
            <Text
              style={[
                styles.disclaimer,
                { color: colors.textSecondary, fontSize: FontSize.xs },
              ]}
            >
              Estimated fees. Actual fees may vary by up to 10% due to network conditions.
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: Spacing.md,
  },
  loadingContainer: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.md,
  },
  spinner: {
    marginRight: Spacing.md,
  },
  loadingText: {
    fontSize: FontSize.sm,
  },
  errorContainer: {
    borderLeftWidth: 4,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.sm,
    marginBottom: Spacing.md,
  },
  errorText: {
    fontSize: FontSize.sm,
    marginBottom: Spacing.sm,
  },
  retryButton: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  retryText: {
    fontSize: FontSize.sm,
    fontWeight: "600",
  },
  estimateContainer: {
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.md,
  },
  title: {
    fontSize: FontSize.sm,
    marginBottom: Spacing.md,
  },
  feeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.sm,
  },
  feeLabel: {
    fontSize: FontSize.sm,
    flex: 1,
  },
  feeValue: {
    fontSize: FontSize.sm,
    fontWeight: "500",
    textAlign: "right",
  },
  divider: {
    height: 1,
    marginVertical: Spacing.md,
  },
  totalLabel: {
    fontSize: FontSize.base,
    flex: 1,
  },
  totalValue: {
    fontSize: FontSize.base,
    textAlign: "right",
  },
  disclaimer: {
    marginTop: Spacing.md,
    fontStyle: "italic",
    lineHeight: 16,
  },
});
