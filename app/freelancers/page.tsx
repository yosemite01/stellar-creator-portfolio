'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { CreatorCard } from '@/components/cards/creator-card';
import { Button } from '@/components/ui/button';
import { creators, disciplines } from '@/lib/services/creators-data';
import { ArrowRight, Search, Star, UserX } from 'lucide-react';
import { EmptyState } from '@/components/common/empty-state';

export default function FreelancersPage() {
  const [selectedDiscipline, setSelectedDiscipline] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredCreators = creators.filter((creator) => {
    const disciplineMatch = selectedDiscipline === 'All' || creator.discipline === selectedDiscipline;
    const searchMatch =
      creator.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      creator.bio.toLowerCase().includes(searchQuery.toLowerCase()) ||
      creator.skills.some((skill) => skill.toLowerCase().includes(searchQuery.toLowerCase()));
    return disciplineMatch && searchMatch;
  });

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />

      <main className="flex-grow">
        {/* Hero */}
        <section className="relative overflow-hidden py-16 sm:py-24 border-b border-border">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-accent/5" />
          <div className="absolute top-0 right-0 w-96 h-96 bg-accent/10 rounded-full blur-3xl" />
          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-12">
              <h1 className="text-4xl sm:text-5xl font-bold text-foreground mb-4 text-balance">
                Hire Stellar Freelancers
              </h1>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto text-balance">
                Find expert freelancers across design, writing, content creation, marketing, and more.
              </p>
            </div>

            {/* Search Bar */}
            <div className="max-w-2xl mx-auto mb-8">
              <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" size={20} />
                <input
                  type="text"
                  placeholder="Search by name, skills, or expertise..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-12 pr-4 py-3 bg-card border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
            </div>
          </div>
        </section>

        {/* Filters & Content */}
        <section className="py-12">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            {/* Filters */}
            <div className="mb-12 pb-8 border-b border-border">
              <h3 className="text-lg font-semibold text-foreground mb-4">Filter by Discipline</h3>
              <div className="flex flex-wrap gap-2">
                {disciplines.map((discipline) => (
                  <button
                    key={discipline}
                    onClick={() => setSelectedDiscipline(discipline)}
                    className={`px-4 py-2 rounded-lg font-medium transition-all ${
                      selectedDiscipline === discipline
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground hover:bg-secondary'
                    }`}
                  >
                    {discipline}
                  </button>
                ))}
              </div>
            </div>

            {/* Results */}
            <div>
              <p className="text-sm text-muted-foreground mb-8">
                Showing {filteredCreators.length} freelancer{filteredCreators.length !== 1 ? 's' : ''}
              </p>

              {filteredCreators.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {filteredCreators.map((creator) => (
                    <CreatorCard key={creator.id} creator={creator} />
                  ))}
                </div>
              ) : (
                <div className="text-center py-16">
                  <p className="text-lg text-muted-foreground mb-4">
                    No freelancers match your search.
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSelectedDiscipline('All');
                      setSearchQuery('');
                    }}
                  >
                    Clear Filters
                  </Button>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section className="py-16 sm:py-24 bg-muted/30 border-y border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-12">
              <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
                How It Works
              </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
              {[
                {
                  step: '01',
                  title: 'Browse Freelancers',
                  description: 'Find the perfect expert for your project by browsing our curated directory.',
                },
                {
                  step: '02',
                  title: 'Review Portfolio',
                  description: 'Check out their past work, testimonials, and rates to make an informed choice.',
                },
                {
                  step: '03',
                  title: 'Connect & Discuss',
                  description: 'Reach out directly via LinkedIn or email to discuss your project details.',
                },
                {
                  step: '04',
                  title: 'Collaborate',
                  description: 'Work together to deliver amazing results. Build a long-term relationship.',
                },
              ].map((item, index) => (
                <div key={index} className="text-center">
                  <div className="w-16 h-16 bg-primary/20 rounded-lg flex items-center justify-center mx-auto mb-4">
                    <span className="text-2xl font-bold text-primary">{item.step}</span>
                  </div>
                  <h3 className="text-lg font-bold text-foreground mb-2">{item.title}</h3>
                  <p className="text-sm text-muted-foreground">{item.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="py-16 sm:py-24">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-12">
              <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
                Why Hire from Stellar?
              </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {[
                {
                  title: 'Vetted Professionals',
                  description: 'All freelancers are carefully selected for their expertise and quality of work.',
                  icon: Star,
                },
                {
                  title: 'Diverse Expertise',
                  description: 'Find specialists across 15+ non-technical tech disciplines, from marketing to legal.',
                  icon: Search,
                },
                {
                  title: 'Direct Communication',
                  description: 'Work directly with freelancers without intermediaries. Full transparency and control.',
                  icon: ArrowRight,
                },
              ].map((feature, index) => {
                const Icon = feature.icon;
                return (
                  <div key={index} className="bg-card border border-border rounded-lg p-8 hover:shadow-lg transition-all">
                    <div className="w-12 h-12 bg-primary/20 rounded-lg flex items-center justify-center mb-4">
                      <Icon size={24} className="text-primary" />
                    </div>
                    <h3 className="text-lg font-bold text-foreground mb-2">{feature.title}</h3>
                    <p className="text-muted-foreground">{feature.description}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-16 sm:py-24 bg-primary/5 border-t border-border">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
              Can't find what you need?
            </h2>
            <p className="text-lg text-muted-foreground mb-8">
              Post your project on Stellar and let freelancers come to you.
            </p>
            <Link href="/bounties">
              <Button size="lg" className="group">
                Post a Project
                <ArrowRight size={18} className="ml-2 group-hover:translate-x-1 transition-transform" />
              </Button>
            </Link>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
