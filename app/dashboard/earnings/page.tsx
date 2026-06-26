import { Header } from '@/components/header'
import { Footer } from '@/components/footer'
import { EarningsDashboard } from '@/components/earnings-dashboard'

export const metadata = {
  title: 'Earnings | Stellar Creator Portfolio',
  description: 'Track your freelance earnings and export tax documents.',
}

export default function EarningsPage() {
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
        <EarningsDashboard />
      </main>
      <Footer />
    </div>
  )
}
