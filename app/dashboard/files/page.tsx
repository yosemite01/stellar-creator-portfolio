import { Suspense } from 'react';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { IpfsStorageBrowser } from '@/components/ipfs/ipfs-storage-browser';
import { FileBrowserSkeleton } from '@/components/ui/skeleton-group';
import { getServerSession } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';

export const metadata = {
  title: 'Decentralized Files | Tamgora',
  description: 'Browse and pin files to IPFS decentralized storage',
};

async function PinnedFilesContent() {
  const session = await getServerSession();
  const pinnedRows = session?.user?.id
    ? await prisma.pinnedFile.findMany({
        where: { ownerId: session.user.id },
        orderBy: { createdAt: 'desc' },
        take: 50,
      })
    : [];

  const initialFiles = pinnedRows.map((row) => ({
    cid: row.cid,
    name: `pinned-${row.cid.slice(0, 10)}`,
    size: row.size,
    type: 'application/octet-stream',
    pinned: true,
    uploadedAt: row.createdAt.toISOString(),
  }));

  return <IpfsStorageBrowser initialFiles={initialFiles.length > 0 ? initialFiles : undefined} />;
}

export default function DashboardFilesPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-grow py-12 px-4">
        <Suspense fallback={<FileBrowserSkeleton />}>
          <PinnedFilesContent />
        </Suspense>
      </main>
      <Footer />
    </div>
  );
}
