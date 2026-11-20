import { Header } from '@/components/layout/header'
import { Footer } from '@/components/layout/footer'
import { EarningsDashboard } from '@/components/analytics/earnings-dashboard'
import { getServerSession } from '@/lib/auth/auth'
import { getEarningTransactions } from '@/lib/earnings-data'
import { prisma } from '@/lib/prisma'

export const metadata = {
  title: 'Earnings | Tamgora',
  description: 'Track your freelance earnings and export tax documents.',
}

export default async function EarningsPage() {
  const session = await getServerSession()
  const transactions = session?.user?.id
    ? await getEarningTransactions(session.user.id, prisma)
    : []

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-grow container max-w-5xl mx-auto px-4 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Earnings</h1>
          <p className="text-muted-foreground mt-1">
            Track your income, filter by date range, and export tax documents.
          </p>
        </div>
        <EarningsDashboard transactions={transactions} />
      </main>
      <Footer />
    </div>
  )
}
