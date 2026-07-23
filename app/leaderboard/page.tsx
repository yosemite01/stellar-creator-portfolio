import { prisma } from "@/lib/prisma";
import { LeaderboardClient, type CreatorLeaderboardItem } from "@/components/leaderboard-client";
import { getServerSession } from "next-auth/next";

export const dynamic = 'force-dynamic';
export const revalidate = 3600; // Refreshed hourly with Cache-Control: max-age=3600

export default async function LeaderboardPage() {
  const session = await getServerSession().catch(() => null);
  const currentUserId = session?.user?.id || null;

  // Fetch all creator profiles
  const rawCreators = await prisma.creatorProfile.findMany({
    include: {
      user: true,
    },
  });

  // Fetch released escrows to compute earnings
  const releasedEscrows = await prisma.escrow.findMany({
    where: {
      status: "released",
    },
    select: {
      creatorId: true,
      amount: true,
    },
  });

  // Aggregate earnings per creator
  const earningsMap: Record<string, number> = {};
  releasedEscrows.forEach((escrow) => {
    earningsMap[escrow.creatorId] = (earningsMap[escrow.creatorId] || 0) + escrow.amount;
  });

  // Map database profiles to leaderboard items
  const creators: CreatorLeaderboardItem[] = rawCreators.map((c) => ({
    id: c.id,
    userId: c.userId,
    displayName: c.displayName,
    avatar: c.avatar,
    discipline: c.discipline,
    skills: c.skills,
    rating: Math.round(c.rating * 100), // Scale rating (e.g. 4.5 -> 450)
    completedProjects: c.completedProjects,
    earnings: earningsMap[c.userId] || 0,
    createdAt: c.createdAt.toISOString(),
  }));

  return (
    <main className="min-h-screen bg-[#0b0f19] text-slate-100 pb-16">
      <LeaderboardClient creators={creators} currentUserId={currentUserId} />
    </main>
  );
}
