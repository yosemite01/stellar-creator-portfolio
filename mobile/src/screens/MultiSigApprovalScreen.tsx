import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useMultiAccount } from "../hooks/useMultiAccount";
import type { StellarAccount } from "../services/MultiAccountService";

interface AccountItemProps {
  account: StellarAccount;
  isActive: boolean;
  isSwitching: boolean;
  onSwitch: (publicKey: string) => void;
  onRemove: (publicKey: string) => void;
}

function truncateAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-6)}`;
}

function AccountItem({
  account,
  isActive,
  isSwitching,
  onSwitch,
  onRemove,
}: AccountItemProps) {
  return (
    <View
      style={[styles.accountCard, isActive && styles.accountCardActive]}
      accessibilityRole="button"
      accessibilityLabel={`Account ${account.label}, ${truncateAddress(account.publicKey)}${isActive ? ", currently active" : ""}`}
    >
      <TouchableOpacity
        style={styles.accountInfo}
        onPress={() => onSwitch(account.publicKey)}
        disabled={isSwitching || isActive}
      >
        <View style={styles.avatarContainer}>
          <View
            style={[styles.avatar, isActive && styles.avatarActive]}
          >
            <Text style={styles.avatarText}>
              {account.label.charAt(0).toUpperCase()}
            </Text>
          </View>
          {isActive && <View style={styles.activeDot} />}
        </View>

        <View style={styles.accountDetails}>
          <Text style={styles.accountLabel}>{account.label}</Text>
          <Text style={styles.accountAddress}>
            {truncateAddress(account.publicKey)}
          </Text>
        </View>

        {isActive && (
          <View style={styles.activeBadge}>
            <Text style={styles.activeBadgeText}>Active</Text>
          </View>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.removeButton}
        onPress={() => onRemove(account.publicKey)}
        accessibilityLabel={`Remove account ${account.label}`}
      >
        <Text style={styles.removeButtonText}>Remove</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function MultiSigApprovalScreen() {
  const {
    accounts,
    activeAccount,
    isLoading,
    isSwitching,
    error,
    switchAccount,
    addAccount,
    removeAccount,
    clearError,
  } = useMultiAccount();

  const [showAddForm, setShowAddForm] = useState(false);

  const handleSwitch = useCallback(
    async (publicKey: string) => {
      try {
        await switchAccount(publicKey);
      } catch {
        // error is set in the hook
      }
    },
    [switchAccount],
  );

  const handleRemove = useCallback(
    (publicKey: string) => {
      const account = accounts.find((a) => a.publicKey === publicKey);
      Alert.alert(
        "Remove Account",
        `Remove "${account?.label ?? "account"}"? This will delete the stored key material.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Remove",
            style: "destructive",
            onPress: async () => {
              try {
                await removeAccount(publicKey);
              } catch {
                // error is set in the hook
              }
            },
          },
        ],
      );
    },
    [accounts, removeAccount],
  );

  const handleAddAccount = useCallback(async () => {
    const placeholder = `G${"A".repeat(55)}`;
    try {
      await addAccount(placeholder, "encrypted-placeholder", "New Account");
      setShowAddForm(false);
    } catch {
      // error is set in the hook
    }
  }, [addAccount]);

  const renderItem = useCallback(
    ({ item }: { item: StellarAccount }) => (
      <AccountItem
        account={item}
        isActive={activeAccount?.publicKey === item.publicKey}
        isSwitching={isSwitching}
        onSwitch={handleSwitch}
        onRemove={handleRemove}
      />
    ),
    [activeAccount, isSwitching, handleSwitch, handleRemove],
  );

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
        <Text style={styles.loadingText}>Loading accounts...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Stellar Accounts</Text>
      <Text style={styles.subtitle}>
        Manage your Stellar accounts. Biometric authentication is required to
        switch or add accounts.
      </Text>

      {error && (
        <TouchableOpacity style={styles.errorBanner} onPress={clearError}>
          <Text style={styles.errorText}>{error}</Text>
          <Text style={styles.errorDismiss}>Dismiss</Text>
        </TouchableOpacity>
      )}

      {isSwitching && (
        <View style={styles.switchingBanner}>
          <ActivityIndicator size="small" color="#fff" />
          <Text style={styles.switchingText}>
            Authenticating and switching...
          </Text>
        </View>
      )}

      <FlatList
        data={accounts}
        renderItem={renderItem}
        keyExtractor={(item) => item.publicKey}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>
              No accounts yet. Add your first Stellar account to get started.
            </Text>
          </View>
        }
      />

      <TouchableOpacity style={styles.addButton} onPress={handleAddAccount}>
        <Text style={styles.addButtonText}>Add Account</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0a0a0a",
    paddingTop: 60,
    paddingHorizontal: 16,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#0a0a0a",
  },
  loadingText: {
    marginTop: 12,
    color: "#999",
    fontSize: 14,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: "#fff",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: "#888",
    marginBottom: 20,
  },
  errorBanner: {
    backgroundColor: "#3b1111",
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  errorText: {
    color: "#f87171",
    fontSize: 13,
    flex: 1,
  },
  errorDismiss: {
    color: "#f87171",
    fontSize: 12,
    fontWeight: "600",
    marginLeft: 8,
  },
  switchingBanner: {
    backgroundColor: "#1e3a5f",
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  switchingText: {
    color: "#93c5fd",
    fontSize: 13,
  },
  listContent: {
    paddingBottom: 100,
  },
  accountCard: {
    backgroundColor: "#1a1a1a",
    borderRadius: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#2a2a2a",
    overflow: "hidden",
  },
  accountCardActive: {
    borderColor: "#3b82f6",
  },
  accountInfo: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
  },
  avatarContainer: {
    position: "relative",
    marginRight: 12,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#333",
    justifyContent: "center",
    alignItems: "center",
  },
  avatarActive: {
    backgroundColor: "#1e40af",
  },
  avatarText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
  },
  activeDot: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#22c55e",
    borderWidth: 2,
    borderColor: "#1a1a1a",
  },
  accountDetails: {
    flex: 1,
  },
  accountLabel: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 2,
  },
  accountAddress: {
    color: "#888",
    fontSize: 13,
    fontFamily: "monospace",
  },
  activeBadge: {
    backgroundColor: "#1e40af",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  activeBadgeText: {
    color: "#93c5fd",
    fontSize: 11,
    fontWeight: "600",
  },
  removeButton: {
    borderTopWidth: 1,
    borderTopColor: "#2a2a2a",
    padding: 10,
    alignItems: "center",
  },
  removeButtonText: {
    color: "#f87171",
    fontSize: 13,
    fontWeight: "500",
  },
  emptyState: {
    padding: 40,
    alignItems: "center",
  },
  emptyText: {
    color: "#666",
    fontSize: 14,
    textAlign: "center",
  },
  addButton: {
    position: "absolute",
    bottom: 30,
    left: 16,
    right: 16,
    backgroundColor: "#3b82f6",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
  },
  addButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
