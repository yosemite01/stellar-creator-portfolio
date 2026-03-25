'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { Button } from '@/components/ui/button';
import { bounties, Bounty } from '@/lib/creators-data';
import { ArrowRight, Filter, Calendar, DollarSign, Zap, Search } from 'lucide-react';
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyContent, EmptyMedia } from '@/components/ui/empty';

export default function BountiesPage() {
  const [selectedDifficulty, setSelectedDifficulty] = useState('All');
  const [selectedCategory, setSelectedCategory] = useState('All');

  const difficulties = ['All', 'beginner', 'intermediate', 'advanced', 'expert'];
  const categories = ['All', 'Brand Strategy', 'Technical Writing', 'Content Creation', 'UX Research'];

  const filteredBounties = bounties.filter((bounty) => {
    const difficultyMatch = selectedDifficulty === 'All' || bounty.difficulty === selectedDifficulty;
    const categoryMatch = selectedCategory === 'All' || bounty.category === selectedCategory;
    return difficultyMatch && categoryMatch;
  });

  const getDifficultyColor = (difficulty: string) => {
    const colors: Record<string, string> = {
      beginner: 'badge-beginner',
      intermediate: 'badge-intermediate',
      advanced: 'badge-advanced',
      expert: 'badge-expert',
    };
    return colors[difficulty] || 'bg-muted text-muted-foreground';
  };

  const BountyCard = ({ bounty }: { bounty: Bounty }) => (
    <div className="bg-card border border-border rounded-lg p-6 hover:shadow-lg transition-all hover:-translate-y-1">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <h3 className="text-xl font-bold text-foreground mb-1 line-clamp-2">
            {bounty.title}
          </h3>
          <p className="text-sm text-muted-foreground">{bounty.category}</p>
        </div>
        <span className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap ml-4 capitalize ${getDifficultyColor(bounty.difficulty)}`}>
          {bounty.difficulty}
        </span>
      </div>

      {/* Description */}
      <p className="text-sm text-muted-foreground mb-4 line-clamp-2">
        {bounty.description}
      </p>

      {/* Stats */}
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
            <p className="font-semibold text-foreground">
              {Math.ceil((bounty.deadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24))} days
            </p>
          </div>
        </div>
      </div>

      {/* Tags */}
      <div className="flex flex-wrap gap-2 mb-4">
        {bounty.tags.slice(0, 3).map((tag) => (
          <span
            key={tag}
            className="inline-block px-2 py-1 bg-secondary/50 text-secondary-foreground rounded text-xs font-medium"
          >
            {tag}
          </span>
        ))}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          <Zap size={14} className="inline mr-1" />
          {bounty.applicants} applications
        </div>
        <Button size="sm" variant="default" className="group">
          Apply Now
          <ArrowRight size={14} className="ml-2 group-hover:translate-x-0.5 transition-transform" />
        </Button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />

      <main className="flex-grow">
        {/* Hero */}
        <section className="relative overflow-hidden py-16 sm:py-24 border-b border-border">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-accent/5" />
          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center">
              <h1 className="text-4xl sm:text-5xl font-bold text-foreground mb-4 text-balance">
                Stellar Bounties
              </h1>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto text-balance">
                Explore exclusive opportunities and showcase your expertise. Get paid for projects that matter.
              </p>
            </div>
          </div>
        </section>

        {/* Filters & Content */}
        <section className="py-12">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            {/* Filters */}
            <div className="mb-8 pb-8 border-b border-border">
              <div className="flex items-center gap-2 mb-4">
                <Filter size={20} className="text-primary" />
                <h3 className="text-lg font-semibold text-foreground">Filter Bounties</h3>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Difficulty Filter */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-3">
                    Difficulty Level
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {difficulties.map((difficulty) => (
                      <button
                        key={difficulty}
                        onClick={() => setSelectedDifficulty(difficulty)}
                        className={`px-4 py-2 rounded-lg font-medium transition-all capitalize ${
                          selectedDifficulty === difficulty
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-muted-foreground hover:bg-secondary'
                        }`}
                      >
                        {difficulty}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Category Filter */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-3">
                    Category
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {categories.map((category) => (
                      <button
                        key={category}
                        onClick={() => setSelectedCategory(category)}
                        className={`px-4 py-2 rounded-lg font-medium transition-all ${
                          selectedCategory === category
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-muted-foreground hover:bg-secondary'
                        }`}
                      >
                        {category}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Results */}
            <div>
              <p className="text-sm text-muted-foreground mb-6">
                Showing {filteredBounties.length} bounties
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {filteredBounties.map((bounty) => (
                  <BountyCard key={bounty.id} bounty={bounty} />
                ))}
              </div>

              {filteredBounties.length === 0 && (
                <Empty className="min-h-[400px]">
                  <EmptyMedia variant="icon">
                    <Search className="size-6" />
                  </EmptyMedia>
                  <EmptyHeader>
                    <EmptyTitle>No bounties found</EmptyTitle>
                    <EmptyDescription>
                      Try adjusting your filters or reset to see all available bounties.
                    </EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent>
                    <Button 
                      variant="outline" 
                      onClick={() => {
                        setSelectedDifficulty('All');
                        setSelectedCategory('All');
                      }}
                    >
                      Reset Filters
                    </Button>
                  </EmptyContent>
                </Empty>
              )}
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-16 sm:py-24 bg-muted/30 border-t border-border">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
              Have a project in mind?
            </h2>
            <p className="text-lg text-muted-foreground mb-8">
              Post your bounty and get applications from top-tier creators.
            </p>
            <Button size="lg" className="group">
              Post a Bounty
              <ArrowRight size={18} className="ml-2 group-hover:translate-x-1 transition-transform" />
            </Button>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
