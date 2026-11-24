import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const creatorId = "demo-creator";
const clientId = "demo-client";

async function main() {
  await prisma.user.upsert({
    where: { email: "creator@example.com" },
    update: {},
    create: {
      id: creatorId,
      name: "Ada Creator",
      email: "creator@example.com",
      role: "CREATOR",
      onboardingCompletedAt: new Date(),
      creatorProfile: {
        create: {
          displayName: "Ada Creator",
          bio: "Product designer and community builder on Stellar.",
          discipline: "UI/UX Design",
          skills: ["Product Design", "Figma", "Community"],
          rating: 4.9,
          completedProjects: 18,
          verified: true,
        },
      },
    },
  });

  await prisma.user.upsert({
    where: { email: "client@example.com" },
    update: {},
    create: {
      id: clientId,
      name: "Demo Client",
      email: "client@example.com",
      role: "CLIENT",
      onboardingCompletedAt: new Date(),
      clientProfile: {
        create: {
          companyName: "Stellar Studio",
          projectType: "Design",
          budgetRange: "500-2000 XLM",
          verified: true,
        },
      },
    },
  });

  await prisma.bounty.upsert({
    where: { id: "demo-bounty" },
    update: {},
    create: {
      id: "demo-bounty",
      creatorId: clientId,
      title: "Design a creator portfolio landing page",
      description: "Create a responsive landing page for a Stellar creator.",
      budget: 850,
      deadline: new Date("2030-12-31T23:59:59.000Z"),
      category: "Design",
      tags: ["UI/UX", "Stellar", "Portfolio"],
    },
  });

  console.log("Seeded 2 demo users, 2 profiles, and 1 demo bounty.");
}

main()
  .catch((error) => {
    console.error("Demo seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
