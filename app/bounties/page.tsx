'use client';

import { useState } from 'react';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { Button } from '@/components/ui/button';
import { bounties, Bounty } from '@/lib/creators-data';
import { ArrowRight, Filter, Calendar, DollarSign, Zap, X, CheckCircle, Loader2 } from 'lucide-react';

// ── Apply Modal ───────────────────────────────────────────────────────────────

type ApplyState = 'idle' | 'submitting' | 'success' | 'error';

function ApplyModal({ bounty, onClose }: { bounty: Bounty; onClose: () => void }) {
  const [proposal, setProposal] = useState('');
  const [budget, setBudget] = useState(String(bounty.budget));
  const [timeline, setTimeline] = useState('7');
  const [state, setState] = useState<ApplyState>('idle');
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!proposal.trim()) { setError('Proposal is required'); return; }
    const b = Number(budget);
    if (!b || b <= 0) { setError('Budget must be positive'); return; }
    const t = Number(timeline);
    if (!t || t <= 0) { setError('Timeline must be positive'); return; }

    setError('');
    setState('submitting');

    try {
      // Simulate escrow deposit call — replace with real apiFetch('/api/bounties/:id/apply')
      await new Promise<void>((res) => setTimeout(res, 1200));
      setState('success');
    } catch {
      setState('error');
      setError('Submission failed. Please try again.');
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="apply-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-card border border-border rounded-xl w-full max-w-lg shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b border-border">
          <div>
            <h2 id="apply-modal-title" className="text-lg font-bold text-foreground">Apply for Bounty</h2>
            <p className="text-sm text-muted-foreground mt-0.5 line-clamp-1">{bounty.title}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground transition-colors ml-4">
            <X size={20} />
          </button>
        </div>

        {state === 'success' ? (
          <div className="p-8 text-center" data-testid="apply-success">
            <CheckCircle size={48} className="text-green-500 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">Application Submitted!</h3>
            <p className="text-sm text-muted-foreground mb-6">
              Your proposal has been submitted. Funds will be held in escrow until the bounty is completed.
            </p>
            <Button onClick={onClose}>Close</Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate className="p-6 space-y-5">
            {/* Escrow info */}
            <div className="bg-accent/10 border border-accent/20 rounded-lg p-4 text-sm text-foreground">
              <p className="font-medium mb-1">🔒 Escrow-protected payment</p>
              <p className="text-muted-foreground">
                Budget is held in a Soroban escrow contract and released only on completion.
              </p>
            </div>

            {/* Proposed budget */}
            <div>
              <label htmlFor="apply-budget" className="block text-sm font-medium text-foreground mb-1.5">
                Proposed Budget (USD)
              </label>
              <div className="relative">
                <DollarSign size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  id="apply-budget"
                  type="number"
                  min={1}
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  className="w-full pl-9 pr-4 py-2.5 bg-background border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                  placeholder="e.g. 2500"
                />
              </div>
            </div>

            {/* Timeline */}
            <div>
              <label htmlFor="apply-timeline" className="block text-sm font-medium text-foreground mb-1.5">
                Delivery Timeline (days)
              </label>
              <div className="relative">
                <Calendar size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  id="apply-timeline"
                  type="number"
                  min={1}
                  value={timeline}
                  onChange={(e) => setTimeline(e.target.value)}
                  className="w-full pl-9 pr-4 py-2.5 bg-background border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                  placeholder="e.g. 14"
                />
              </div>
            </div>

            {/* Proposal */}
            <div>
              <label htmlFor="apply-proposal" className="block text-sm font-medium text-foreground mb-1.5">
                Proposal
              </label>
              <textarea
                id="apply-proposal"
                rows={4}
                value={proposal}
                onChange={(e) => setProposal(e.target.value)}
                className="w-full px-4 py-2.5 bg-background border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                placeholder="Describe your approach, relevant experience, and why you're the best fit…"
              />
            </div>

            {error && (
              <p role="alert" className="text-sm text-red-500">{error}</p>
            )}

            <div className="flex gap-3 pt-1">
              <Button type="button" variant="outline" className="flex-1" onClick={onClose} disabled={state === 'submitting'}>
                Cancel
              </Button>
              <Button type="submit" className="flex-1" disabled={state === 'submitting'}>
                {state === 'submitting' ? (
                  <><Loader2 size={16} className="mr-2 animate-spin" />Submitting…</>
                ) : (
                  <>Submit & Lock Escrow<ArrowRight size={14} className="ml-2" /></>
                )}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ── Bounty Card ───────────────────────────────────────────────────────────────

const difficultyColor: Record<string, string> = {
  beginner: 'bg-green-500/20 text-green-700 dark:text-green-400',
  intermediate: 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-400',
  advanced: 'bg-orange-500/20 text-orange-700 dark:text-orange-400',
  expert: 'bg-red-500/20 text-red-700 dark:text-red-400',
};

function BountyCard({ bounty, onApply }: { bounty: Bounty; onApply: (b: Bounty) => void }) {
  const daysLeft = Math.ceil((bounty.deadline.getTime() - Date.now()) / 86_400_000);
  return (
    <div className="bg-card border border-border rounded-lg p-6 hover:shadow-lg transition-all hover:-translate-y-1">
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <h3 className="text-xl font-bold text-foreground mb-1 line-clamp-2">{bounty.title}</h3>
          <p className="text-sm text-muted-foreground">{bounty.category}</p>
        </div>
        <span className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap ml-4 capitalize ${difficultyColor[bounty.difficulty] ?? 'bg-gray-500/20 text-gray-700'}`}>
          {bounty.difficulty}
        </span>
      </div>

      <p className="text-sm text-muted-foreground mb-4 line-clamp-2">{bounty.description}</p>

      <div className="grid grid-cols-2 gap-4 mb-4 py-4 border-y border-border">
        <div className="flex items-center gap-2">
          <DollarSign size={16} className="text-accent" />
          <div>
            <p className="text-xs text-muted-foreground">Budget</p>
            <p className="font-semibold text-foreground">${bounty.budget.toLocaleString()}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Calendar size={16} className="text-accent" />
          <div>
            <p className="text-xs text-muted-foreground">Timeline</p>
            <p className="font-semibold text-foreground">{daysLeft} days</p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {bounty.tags.slice(0, 3).map((tag) => (
          <span key={tag} className="inline-block px-2 py-1 bg-secondary/50 text-secondary-foreground rounded text-xs font-medium">
            {tag}
          </span>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          <Zap size={14} className="inline mr-1" />
          {bounty.applicants} applications
        </div>
        <Button size="sm" onClick={() => onApply(bounty)} className="group">
          Apply Now
          <ArrowRight size={14} className="ml-2 group-hover:translate-x-0.5 transition-transform" />
        </Button>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function BountiesPage() {
  const [selectedDifficulty, setSelectedDifficulty] = useState('All');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [activeBounty, setActiveBounty] = useState<Bounty | null>(null);

  const difficulties = ['All', 'beginner', 'intermediate', 'advanced', 'expert'];
  const categories = ['All', 'Brand Strategy', 'Technical Writing', 'Content Creation', 'UX Research'];

  const filtered = bounties.filter((b) => {
    const d = selectedDifficulty === 'All' || b.difficulty === selectedDifficulty;
    const c = selectedCategory === 'All' || b.category === selectedCategory;
    return d && c;
  });

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />

      <main className="flex-grow">
        {/* Hero */}
        <section className="relative overflow-hidden py-16 sm:py-24 border-b border-border">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-accent/5" />
          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h1 className="text-4xl sm:text-5xl font-bold text-foreground mb-4 text-balance">Stellar Bounties</h1>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto text-balance">
              Explore exclusive opportunities and showcase your expertise. Get paid for projects that matter.
            </p>
          </div>
        </section>

        {/* Filters & Content */}
        <section className="py-12">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="mb-8 pb-8 border-b border-border">
              <div className="flex items-center gap-2 mb-4">
                <Filter size={20} className="text-primary" />
                <h3 className="text-lg font-semibold text-foreground">Filter Bounties</h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-3">Difficulty Level</label>
                  <div className="flex flex-wrap gap-2">
                    {difficulties.map((d) => (
                      <button key={d} onClick={() => setSelectedDifficulty(d)}
                        className={`px-4 py-2 rounded-lg font-medium transition-all capitalize ${selectedDifficulty === d ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-secondary'}`}>
                        {d}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-3">Category</label>
                  <div className="flex flex-wrap gap-2">
                    {categories.map((c) => (
                      <button key={c} onClick={() => setSelectedCategory(c)}
                        className={`px-4 py-2 rounded-lg font-medium transition-all ${selectedCategory === c ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-secondary'}`}>
                        {c}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div>
              <p className="text-sm text-muted-foreground mb-6">Showing {filtered.length} bounties</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {filtered.map((b) => (
                  <BountyCard key={b.id} bounty={b} onApply={setActiveBounty} />
                ))}
              </div>
              {filtered.length === 0 && (
                <div className="text-center py-12">
                  <p className="text-lg text-muted-foreground mb-4">No bounties match your filters.</p>
                  <Button variant="outline" onClick={() => { setSelectedDifficulty('All'); setSelectedCategory('All'); }}>
                    Reset Filters
                  </Button>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-16 sm:py-24 bg-muted/30 border-t border-border">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">Have a project in mind?</h2>
            <p className="text-lg text-muted-foreground mb-8">Post your bounty and get applications from top-tier creators.</p>
            <Button size="lg" className="group">
              Post a Bounty
              <ArrowRight size={18} className="ml-2 group-hover:translate-x-1 transition-transform" />
            </Button>
          </div>
        </section>
      </main>

      <Footer />

      {activeBounty && <ApplyModal bounty={activeBounty} onClose={() => setActiveBounty(null)} />}
    </div>
  );
}
