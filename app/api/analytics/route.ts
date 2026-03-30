import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { bounties as allBounties } from "@/lib/services/creators-data";
import {
  listApplicationsForApplicant,
  listApplicationsForBounty,
} from "@/lib/services/bounty-service";
import {
  computeEarningsMetrics,
  computePerformanceMetrics,
  computeConversionFunnel,
  computeTrendData,
  computePeerComparison,
  computePredictiveTrends,
  formatDataForExport,
  dateRangeFromPreset,
  generateMockBounties,
  generateMockApplications,
  MOCK_PLATFORM_AVERAGES,
  type BountyRecord,
  type ApplicationRecord,
  type DatePreset,
  type DateRange,
  type Granularity,
} from "@/lib/analytics/analytics-engine";

const VALID_PRESETS = new Set(["7d", "30d", "90d", "1y", "all"]);

/**
 * GET /api/analytics
 *
 * Requires authentication. Returns analytics metrics scoped to the
 * authenticated user's bounties and applications.
 *
 * Falls back to mock data when DATABASE_URL is not configured (dev/preview).
 *
 * Query params:
 *   preset      – 7d | 30d | 90d | 1y | all  (default: 30d)
 *   startDate / endDate – ISO-8601 (overrides preset)
 *   granularity – daily | weekly | monthly (default: auto)
 *   format      – json | csv  (default: json)
 */
export async function GET(req: NextRequest) {
  // --- Auth -----------------------------------------------------------------
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }
  const userId = session.user.id;

  // --- Date range -----------------------------------------------------------
  let range: DateRange;
  const { searchParams } = req.nextUrl;
  const startParam = searchParams.get("startDate");
  const endParam = searchParams.get("endDate");
  const preset = (searchParams.get("preset") || "30d") as DatePreset;

  if (startParam && endParam) {
    const start = new Date(startParam);
    const end = new Date(endParam);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
      return NextResponse.json(
        { error: "Invalid date range. startDate must be before endDate." },
        { status: 400 },
      );
    }
    range = { start, end };
  } else if (VALID_PRESETS.has(preset)) {
    range = dateRangeFromPreset(preset);
  } else {
    return NextResponse.json(
      {
        error: `Invalid preset. Must be one of: ${[...VALID_PRESETS].join(", ")}`,
      },
      { status: 400 },
    );
  }

  // --- Granularity ----------------------------------------------------------
  const durationDays = Math.ceil(
    (range.end.getTime() - range.start.getTime()) / (1000 * 60 * 60 * 24),
  );
  const granularityParam = searchParams.get(
    "granularity",
  ) as Granularity | null;
  const granularity: Granularity =
    granularityParam &&
    ["daily", "weekly", "monthly"].includes(granularityParam)
      ? granularityParam
      : durationDays <= 31
        ? "daily"
        : durationDays <= 180
          ? "weekly"
          : "monthly";

  // --- Data -----------------------------------------------------------------
  let bounties: BountyRecord[];
  let applications: ApplicationRecord[];

  const hasDatabase = Boolean(process.env.DATABASE_URL);

  if (hasDatabase) {
    // Real data: map service types → analytics engine types
    const rawBounties = allBounties.filter((b) => b.ownerUserId === userId);

    bounties = rawBounties.map((b) => ({
      id: b.id,
      title: b.title,
      budget: Math.round(b.budget * 100), // dollars → cents
      status: mapBountyStatus(b.status),
      category: b.category ?? null,
      createdAt:
        b.postedDate instanceof Date
          ? b.postedDate.toISOString()
          : new Date().toISOString(),
      updatedAt:
        b.postedDate instanceof Date
          ? b.postedDate.toISOString()
          : new Date().toISOString(),
      creatorId: userId,
    }));

    const rawApplications = listApplicationsForApplicant(userId);

    applications = rawApplications.map((a) => ({
      id: a.id,
      bountyId: a.bountyId,
      applicantId: a.applicantId,
      proposedBudget: Math.round((a.proposedBudget ?? 0) * 100),
      status: mapApplicationStatus(a.status),
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    }));

    // Also include applications on bounties the user owns (as client)
    const ownedApplications = rawBounties.flatMap((b) =>
      listApplicationsForBounty(b.id).map((a) => ({
        id: a.id,
        bountyId: a.bountyId,
        applicantId: a.applicantId,
        proposedBudget: Math.round((a.proposedBudget ?? 0) * 100),
        status: mapApplicationStatus(a.status),
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
      })),
    );

    // Merge, deduplicating by id
    const seen = new Set(applications.map((a) => a.id));
    for (const a of ownedApplications) {
      if (!seen.has(a.id)) {
        applications.push(a);
        seen.add(a.id);
      }
    }
  } else {
    // No database configured — use deterministic mock data scoped to userId
    bounties = generateMockBounties(40, userId);
    applications = generateMockApplications(bounties, userId);
  }

  // --- Compute metrics ------------------------------------------------------
  const earnings = computeEarningsMetrics(bounties, applications, range);
  const performance = computePerformanceMetrics(bounties, applications);
  const funnel = computeConversionFunnel(bounties, applications);

  const trendItems = bounties
    .filter((b) => b.status === "completed")
    .map((b) => ({ date: b.updatedAt, value: b.budget }));
  const trend = computeTrendData(trendItems, range, granularity);
  const prediction = computePredictiveTrends(trend);

  const userMetrics: Record<string, number> = {
    "Completion Rate": performance.completionRate,
    "Acceptance Rate": performance.acceptanceRate,
    "Avg Earnings": earnings.averagePerBounty,
    "Active Bounties": performance.activeBounties,
    Rating: performance.avgRating,
  };
  const peerComparison = computePeerComparison(
    userMetrics,
    MOCK_PLATFORM_AVERAGES,
  );

  const payload = {
    range: { start: range.start.toISOString(), end: range.end.toISOString() },
    granularity,
    isMockData: !hasDatabase,
    earnings,
    performance,
    funnel,
    trend,
    prediction,
    peerComparison,
  };

  // --- Export format --------------------------------------------------------
  const format = searchParams.get("format");
  if (format === "csv") {
    const exported = formatDataForExport(
      payload as unknown as Record<string, unknown>,
      "csv",
    );
    return new NextResponse(exported.data, {
      status: 200,
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="${exported.filename}"`,
      },
    });
  }

  return NextResponse.json(payload);
}

// --- Status mappers ---------------------------------------------------------

function mapBountyStatus(status: string): BountyRecord["status"] {
  switch (status) {
    case "open":
      return "open";
    case "in-progress":
    case "in_progress":
      return "in-progress";
    case "completed":
      return "completed";
    case "cancelled":
    case "canceled":
      return "cancelled";
    default:
      return "open";
  }
}

function mapApplicationStatus(status: string): ApplicationRecord["status"] {
  switch (status) {
    case "pending":
      return "pending";
    case "accepted":
      return "accepted";
    case "rejected":
      return "rejected";
    case "withdrawn":
      return "withdrawn";
    default:
      return "pending";
  }
}
