import React, { useCallback, useMemo, useState, useRef } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useTheme } from "../theme/ThemeProvider";
import { useI18n } from "../i18n/I18nProvider";
import { useOfflineData } from "../hooks/useOfflineData";
import { useInfiniteScroll } from "../hooks/useInfiniteScroll";
import {
  PortfolioSummary,
  ProjectBountyItem,
  HomeData,
} from "../types";
import { ROUTES } from "../constants/routes";
import { MetricCard } from "../components/dashboard/MetricCard";
import { PortfolioCard } from "../components/home/PortfolioCard";
import { ProjectBountyList } from "../components/home/ProjectBountyList";
import { ActionButton } from "../components/buttons/ActionButton";
import { FontSize, FontWeight, Radius, Spacing } from "../theme/tokens";
import { trigger } from "../haptics/HapticEngine";

const buildHomeData = (): HomeData => ({
  trendingPortfolios: [
    {
      id: "p1",
      title: "Aurora NFT Launch",
      subtitle: "Fast-growing digital art portfolio with design-first UX.",
      creator: "Luna Arts",
      value: "14.8k",
      followers: 28,
      change: 18,
      tags: ["NFT", "Art", "Brand"],
    },
    {
      id: "p2",
      title: "Crypto Creator Growth",
      subtitle: "High-conversion crypto campaigns optimized for creators.",
      creator: "Stellar Labs",
      value: "9.7k",
      followers: 16,
      change: 23,
      tags: ["Crypto", "Growth", "Marketing"],
    },
    {
      id: "p3",
      title: "Product Launch Suite",
      subtitle: "Bounty-backed launch systems for early-stage founders.",
      creator: "LaunchPad",
      value: "12.4k",
      followers: 21,
      change: 12,
      tags: ["Launch", "Product", "Bounty"],
    },
  ],
  quickMetrics: [
    {
      id: "m1",
      label: "Trending Portfolios",
      value: 14,
      previousValue: 9,
      unit: "",
      trend: "up",
      trendPct: 55.6,
    },
    {
      id: "m2",
      label: "Active Bounties",
      value: 7,
      previousValue: 5,
      unit: "",
      trend: "up",
      trendPct: 40.0,
    },
    {
      id: "m3",
      label: "Portfolio Views",
      value: 32,
      previousValue: 21,
      unit: "k",
      trend: "up",
      trendPct: 52.4,
    },
    {
      id: "m4",
      label: "Conversion Rate",
      value: 4.8,
      previousValue: 4.1,
      unit: "%",
      trend: "up",
      trendPct: 17.1,
    },
  ],
  projectBountyItems: [
    {
      id: "j1",
      kind: "project",
      title: "Creator Marketplace Redesign",
      subtitle: "Refine onboarding and highlight creator stories.",
      reward: "850 XLM",
      due: "3 days left",
      status: "Live",
      tags: ["Web", "Design"],
    },
    {
      id: "j2",
      kind: "bounty",
      title: "Brand identity for DeFi product",
      subtitle: "Design visual system for token launch campaign.",
      reward: "450 XLM",
      due: "1 day left",
      status: "Closing",
      tags: ["Brand", "Finance"],
    },
    {
      id: "j3",
      kind: "project",
      title: "Mobile campaign for creator growth",
      subtitle: "Launch mobile-first acquisition funnel.",
      reward: "1,200 XLM",
      due: "6 days left",
      status: "Live",
      tags: ["Mobile", "Growth"],
    },
    {
      id: "j4",
      kind: "bounty",
      title: "Illustration suite for influencer pack",
      subtitle: "Create assets for social push and creator events.",
      reward: "380 XLM",
      due: "2 days left",
      status: "Live",
      tags: ["Illustration", "Social"],
    },
  ],
});

async function fetchHomeData(): Promise<HomeData> {
  await new Promise((resolve) => setTimeout(resolve, 520));
  return buildHomeData();
}

export function HomeScreen() {
  const { colors, isDark } = useTheme();
  const { t } = useI18n();
  const router = useRouter();
  const { data, isLoading, isStale, cachedAt, refetch } =
    useOfflineData<HomeData>("home-screen-data", fetchHomeData, {
      ttlMs: 5 * 60 * 1000,
    });
  const [refreshing, setRefreshing] = useState(false);

  const handleNavigateToAudio = useCallback(
    () => router.push(ROUTES.APP.AUDIO),
    [router],
  );

  const handleNavigateToMultiSig = useCallback(
    () => router.push(ROUTES.APP.MULTISIG),
    [router],
  );

  const handleNavigateToP2P = useCallback(
    () => router.push(ROUTES.APP.P2P),
    [router],
  );

  const handleNavigateToBiometric = useCallback(
    () => router.push(ROUTES.APP.BIOMETRIC),
    [router],
  );


  // Infinite scroll for bounty items
  const bountyRef = useRef(null);
  const {
    data: bountyItems,
    isLoading: bountyLoading,
    isFetching: bountyFetching,
    loadMore: loadMoreBounties,
  } = useInfiniteScroll({
    pageSize: 10,
    maxItems: 200, // Memory optimization
    initialData: data?.projectBountyItems ?? [],
    onLoadMore: async (page: number, pageSize: number) => {
      // Simulate pagination - in real app, call API
      await new Promise((resolve) => setTimeout(resolve, 300));
      const allItems = data?.projectBountyItems ?? [];
      const startIdx = (page - 1) * pageSize;
      return allItems.slice(startIdx, startIdx + pageSize);
    },
  });

  const handleRefresh = useCallback(async () => {
    void trigger("light");
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

  const onPortfolioPress = useCallback((portfolio: PortfolioSummary) => {
    Haptics.selectionAsync();
    // Placeholder for deeper portfolio details.
  }, []);

  const onItemSelect = useCallback((item: ProjectBountyItem) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // Placeholder for project / bounty detail navigation.
  }, []);

  const trendingSection = useMemo(() => {
    if (!data) return null;

    return (
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            {t("home.trendingTitle")}
          </Text>
          <Text
            style={[styles.sectionCaption, { color: colors.textSecondary }]}
          >
            {t("home.trendingCaption")}
          </Text>
        </View>
        <FlatList
          data={data.trendingPortfolios}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <PortfolioCard
              portfolio={item}
              onPress={() => onPortfolioPress(item)}
            />
          )}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.horizontalList}
          ListFooterComponent={<View style={{ width: Spacing.base }} />}
        />
      </View>
    );
  }, [data, colors.text, colors.textSecondary, onPortfolioPress]);

  const metricsSection = useMemo(() => {
    if (!data) return null;
    return (
      <View style={styles.metricsGrid}>
        {data.quickMetrics.map((metric) => (
          <MetricCard
            key={metric.id}
            metric={metric}
            style={styles.metricCell}
          />
        ))}
      </View>
    );
  }, [data]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <View
          style={[
            styles.hero,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <View>
            <Text style={[styles.title, { color: colors.text }]}>
              {t("home.greeting")}
            </Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              {t("home.subtitle")}
            </Text>
          </View>
          <View style={styles.heroActions}>
            <ActionButton
              title={t("home.useBiometrics")}
              onPress={handleNavigateToBiometric}
              variant="primary"
              accessibilityLabel="Open biometric authentication screen"
            />
            <ActionButton
              title={t("home.refresh")}
              onPress={handleRefresh}
              variant="secondary"
              accessibilityLabel="Refresh home content"
            />
          </View>
          <View style={styles.featureActions}>
            <ActionButton
              title={t("home.audio")}
              onPress={handleNavigateToAudio}
              variant="secondary"
              style={styles.featureButton}
              accessibilityLabel="Open audio playback screen"
            />
            <ActionButton
              title={t("home.multiSig")}
              onPress={handleNavigateToMultiSig}
              variant="secondary"
              style={styles.featureButton}
              accessibilityLabel="Open multi-signature approval screen"
            />
            <ActionButton
              title={t("home.peerTransfer")}
              onPress={handleNavigateToP2P}
              variant="secondary"
              style={styles.featureButton}
              accessibilityLabel="Open peer-to-peer transfer screen"
            />
          </View>
        </View>

        {isStale && cachedAt && (
          <View
            style={[
              styles.staleBadge,
              {
                backgroundColor: colors.warningLight,
                borderColor: colors.warning,
              },
            ]}
          >
            <Text style={[styles.staleText, { color: colors.warning }]}>
              {t("home.cachedData", { time: cachedAt.toLocaleTimeString() })}
            </Text>
          </View>
        )}

        {isLoading && !data ? (
          <View style={styles.loadingWrapper}>
            <ActivityIndicator color={colors.primary} size="large" />
            <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
              {t("home.loadingAnalytics")}
            </Text>
          </View>
        ) : (
          <>
            {metricsSection}
            {trendingSection}
            <ProjectBountyList
              items={data?.projectBountyItems ?? []}
              title={t("home.projectBountyFeed")}
              onSelect={onItemSelect}
            />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: {
    padding: Spacing.base,
    paddingBottom: Spacing["3xl"],
  },
  hero: {
    borderRadius: Radius.xl,
    borderWidth: 1,
    padding: Spacing.base,
    marginBottom: Spacing.lg,
  },
  title: {
    fontSize: FontSize["3xl"],
    fontWeight: FontWeight.extrabold,
    marginBottom: Spacing.sm,
  },
  subtitle: {
    fontSize: FontSize.base,
    lineHeight: 22,
  },
  heroActions: {
    marginTop: Spacing.lg,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  featureActions: {
    marginTop: Spacing.sm,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  featureButton: {
    flex: 1,
    minWidth: 100,
    marginRight: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  staleBadge: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    padding: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  staleText: {
    fontSize: FontSize.xs,
    textAlign: "center",
  },
  loadingWrapper: {
    padding: Spacing.xl,
    alignItems: "center",
  },
  loadingText: {
    marginTop: Spacing.sm,
    fontSize: FontSize.sm,
  },
  section: {
    marginBottom: Spacing.lg,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.sm,
  },
  sectionTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
  },
  sectionCaption: {
    fontSize: FontSize.xs,
  },
  horizontalList: {
    paddingVertical: Spacing.sm,
  },
  metricsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    marginBottom: Spacing.lg,
  },
  metricCell: {
    width: "48%",
    marginBottom: Spacing.sm,
  },
});
