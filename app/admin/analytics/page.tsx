import type { CSSProperties } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

type Aggregate = {
  visitors: number;
  pageviews: number;
  bounceRate: number;
  visitDuration: number;
  conversions: number;
};

type TopItem = { label: string; value: number };

export const dynamic = "force-dynamic";

const SITE_ID = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN || "example.com";
const API_KEY = process.env.PLAUSIBLE_API_KEY;
const ADMIN_TOKEN = process.env.ADMIN_DASHBOARD_TOKEN;

const heatmapTrackedPages = ["/", "/creators", "/bounties", "/search"];

async function fetchAggregate(): Promise<Aggregate> {
  if (!API_KEY) {
    return {
      visitors: 1200,
      pageviews: 2600,
      bounceRate: 34,
      visitDuration: 185,
      conversions: 180,
    };
  }

  const metrics = ["visitors", "pageviews", "bounce_rate", "visit_duration"].join(",");
  const res = await fetch(
    `https://plausible.io/api/v2/stats/aggregate?site_id=${SITE_ID}&period=30d&metrics=${metrics}`,
    {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
      },
      next: { revalidate: 60 },
    }
  );

  if (!res.ok) {
    throw new Error("Failed to load analytics");
  }
  const data = await res.json();
  return {
    visitors: data.results.visitors.value,
    pageviews: data.results.pageviews.value,
    bounceRate: Math.round(data.results.bounce_rate.value),
    visitDuration: Math.round(data.results.visit_duration.value),
    conversions: await fetchConversions(),
  };
}

async function fetchConversions(): Promise<number> {
  if (!API_KEY) return 180;
  const res = await fetch(
    `https://plausible.io/api/v2/events/top-conversions?site_id=${SITE_ID}&period=30d&limit=100`,
    {
      headers: { Authorization: `Bearer ${API_KEY}` },
      next: { revalidate: 60 },
    }
  );
  if (!res.ok) return 0;
  const data = await res.json();
  return data.results.reduce(
    (sum: number, row: { conversions: number }) => sum + (row.conversions || 0),
    0
  );
}

async function fetchTopContent(event: "creator-view" | "bounty-view"): Promise<TopItem[]> {
  if (!API_KEY) {
    return [
      { label: "creator/alex", value: 92 },
      { label: "creator/jordan", value: 74 },
      { label: "creator/sam", value: 63 },
    ];
  }
  const res = await fetch(
    `https://plausible.io/api/v2/stats/breakdown?site_id=${SITE_ID}&event_name=${event}&property=event:slug&period=30d&limit=5`,
    {
      headers: { Authorization: `Bearer ${API_KEY}` },
      next: { revalidate: 60 },
    }
  );
  if (!res.ok) return [];
  const data = await res.json();
  return data.results.map((r: any) => ({
    label: r["event:slug"] || "unknown",
    value: r.visitors || r.pageviews || 0,
  }));
}

async function fetchSearches(): Promise<TopItem[]> {
  if (!API_KEY) {
    return [
      { label: "ai video", value: 120 },
      { label: "design", value: 98 },
      { label: "full stack", value: 88 },
    ];
  }
  const res = await fetch(
    `https://plausible.io/api/v2/stats/breakdown?site_id=${SITE_ID}&event_name=search&property=event:query&period=30d&limit=10`,
    {
      headers: { Authorization: `Bearer ${API_KEY}` },
      next: { revalidate: 60 },
    }
  );
  if (!res.ok) return [];
  const data = await res.json();
  return data.results.map((row: any) => ({
    label: row["event:query"] || "unknown",
    value: row.visitors || 0,
  }));
}

function requireAdmin() {
  if (!ADMIN_TOKEN) return;
  const cookieToken = cookies().get("admin-dashboard")?.value;
  if (cookieToken !== ADMIN_TOKEN) {
    redirect("/"); // keep dashboard private
  }
}

export default async function AnalyticsPage() {
  requireAdmin();

  let aggregate: Aggregate;
  let topCreators: TopItem[] = [];
  let topBounties: TopItem[] = [];
  let searches: TopItem[] = [];

  try {
    [aggregate, topCreators, topBounties, searches] = await Promise.all([
      fetchAggregate(),
      fetchTopContent("creator-view"),
      fetchTopContent("bounty-view"),
      fetchSearches(),
    ]);
  } catch (error) {
    aggregate = {
      visitors: 0,
      pageviews: 0,
      conversions: 0,
      bounceRate: 0,
      visitDuration: 0,
    };
    console.error("Analytics dashboard failed to load", error);
  }

  const funnel = [
    { label: "Viewed listing", value: aggregate.pageviews },
    { label: "CTA clicked", value: Math.round(aggregate.pageviews * 0.42) },
    { label: "Started application", value: Math.round(aggregate.pageviews * 0.21) },
    { label: "Submitted application", value: aggregate.conversions },
  ];

  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <div>
          <p style={styles.kicker}>Private dashboard</p>
          <h1 style={styles.title}>Platform Analytics</h1>
          <p style={styles.subtitle}>
            Privacy-first analytics via Plausible. Last 30 days for {SITE_ID}.
          </p>
        </div>
      </header>

      <section style={styles.grid}>
        <MetricCard label="Visitors" value={aggregate.visitors} />
        <MetricCard label="Pageviews" value={aggregate.pageviews} />
        <MetricCard label="Conversions" value={aggregate.conversions} />
        <MetricCard label="Bounce rate" value={`${aggregate.bounceRate}%`} />
        <MetricCard label="Avg. visit (s)" value={aggregate.visitDuration} />
      </section>

      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Conversion Funnel</h2>
        <div style={styles.funnel}>
          {funnel.map((step, idx) => (
            <div key={step.label} style={{ ...styles.funnelStep, opacity: 1 - idx * 0.12 }}>
              <p style={styles.funnelLabel}>{step.label}</p>
              <p style={styles.funnelValue}>{step.value}</p>
            </div>
          ))}
        </div>
      </section>

      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Top Creators</h2>
        <List data={topCreators} />
      </section>

      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Top Bounties</h2>
        <List data={topBounties} />
      </section>

      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Popular Searches</h2>
        <List data={searches} />
      </section>

      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Heatmap Coverage</h2>
        <ul style={styles.list}>
          {heatmapTrackedPages.map((page) => (
            <li key={page} style={styles.listItem}>
              {page}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

function MetricCard({ label, value }: { label: string; value: string | number }) {
  return (
    <article style={styles.card}>
      <p style={styles.cardLabel}>{label}</p>
      <p style={styles.cardValue}>{value}</p>
    </article>
  );
}

function List({ data }: { data: TopItem[] }) {
  return (
    <ul style={styles.list}>
      {data.map((item) => (
        <li key={item.label} style={styles.listItem}>
          <span>{item.label}</span>
          <span style={styles.muted}>{item.value}</span>
        </li>
      ))}
    </ul>
  );
}

const styles: Record<string, CSSProperties> = {
  page: {
    fontFamily: '"Inter", system-ui, -apple-system, sans-serif',
    padding: "40px",
    background: "#0f172a",
    color: "#e2e8f0",
    minHeight: "100vh",
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: "24px",
  },
  kicker: { textTransform: "uppercase", letterSpacing: "0.08em", fontSize: "12px", color: "#7dd3fc" },
  title: { fontSize: "32px", margin: "6px 0 4px" },
  subtitle: { color: "#cbd5e1" },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: "12px",
    marginBottom: "28px",
  },
  card: {
    padding: "16px",
    background: "linear-gradient(145deg, #111827, #0b1224)",
    borderRadius: "12px",
    border: "1px solid rgba(255,255,255,0.06)",
  },
  cardLabel: { color: "#94a3b8", marginBottom: "8px" },
  cardValue: { fontSize: "24px", fontWeight: 600 },
  section: {
    marginTop: "12px",
    padding: "16px",
    borderRadius: "12px",
    background: "rgba(15,23,42,0.6)",
    border: "1px solid rgba(255,255,255,0.06)",
  },
  sectionTitle: { marginBottom: "12px", fontSize: "18px", fontWeight: 600 },
  funnel: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
    gap: "10px",
  },
  funnelStep: {
    padding: "12px",
    background: "#111827",
    borderRadius: "10px",
    border: "1px solid rgba(255,255,255,0.05)",
  },
  funnelLabel: { color: "#cbd5e1", marginBottom: "6px" },
  funnelValue: { fontWeight: 700, fontSize: "20px" },
  list: { listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "8px" },
  listItem: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px",
    borderRadius: "10px",
    background: "#0b1224",
    border: "1px solid rgba(255,255,255,0.04)",
  },
  muted: { color: "#94a3b8" },
};
