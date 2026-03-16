'use client';

import { useRouter } from 'next/navigation';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { CreatorCard } from '@/components/creator-card';
import { Button } from '@/components/ui/button';
import { ArrowRight, Sparkles, Users, Target } from 'lucide-react';
import { creators } from '@/lib/creators-data';

export default function Home() {
  const router = useRouter();
  const featuredCreators = creators.slice(0, 3);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />

      <main className="flex-grow">
        {/* Hero Section */}
        <section className="relative overflow-hidden">
          {/* Background Elements */}
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-accent/5" />
          <div className="absolute top-0 right-0 w-96 h-96 bg-accent/10 rounded-full blur-3xl" />
          <div className="absolute bottom-0 left-0 w-96 h-96 bg-primary/10 rounded-full blur-3xl" />

          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-32">
            <div className="text-center">
              {/* Badge */}
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-accent/20 rounded-full mb-6 border border-accent/30">
                <Sparkles size={16} className="text-accent" />
                <span className="text-sm font-medium text-accent">Welcome to Stellar</span>
              </div>

              {/* Main Heading */}
              <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold text-foreground mb-6 text-balance leading-tight">
                Discover World-Class <span className="bg-gradient-to-r from-primary via-accent to-primary bg-clip-text text-transparent">Creators</span>
              </h1>

              {/* Subheading */}
              <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto text-balance">
                The ultimate platform for non-technical tech talent. Find world-class creators, hire freelancers, and post bounties across 15+ disciplines.
              </p>

              {/* CTA Buttons */}
              <div className="flex flex-col sm:flex-row gap-4 justify-center mb-12">
                <Button size="lg" className="group" onClick={() => router.push('/creators')}>
                  Browse Creators
                  <ArrowRight size={18} className="ml-2 group-hover:translate-x-1 transition-transform" />
                </Button>
                <Button size="lg" variant="outline" onClick={() => router.push('/bounties')}>
                  Explore Bounties
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* Stats Section */}
        <section className="border-y border-border bg-muted/30 py-12">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="text-center">
                <div className="text-4xl sm:text-5xl font-bold text-primary mb-2">
                  {creators.length}+
                </div>
                <p className="text-muted-foreground">Stellar Creators</p>
              </div>
              <div className="text-center">
                <div className="text-4xl sm:text-5xl font-bold text-primary mb-2">
                  {creators.reduce((sum, c) => sum + c.projects.length, 0)}+
                </div>
                <p className="text-muted-foreground">Incredible Projects</p>
              </div>
              <div className="text-center">
                <div className="text-4xl sm:text-5xl font-bold text-primary mb-2">
                  15+
                </div>
                <p className="text-muted-foreground">Non-Tech Disciplines</p>
              </div>
            </div>
          </div>
        </section>

        {/* Featured Creators Section */}
        <section className="py-20 sm:py-32">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            {/* Section Header */}
            <div className="text-center mb-12">
              <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
                Featured Creators & Freelancers
              </h2>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                Discover exceptional talent across design, writing, marketing, product management, and more.
              </p>
            </div>

            {/* Creators Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {featuredCreators.map((creator) => (
                <CreatorCard key={creator.id} creator={creator} />
              ))}
            </div>

            {/* View All CTA */}
            <div className="text-center mt-12">
              <Button size="lg" variant="outline" className="group" onClick={() => router.push('/creators')}>
                View All Creators
                <ArrowRight size={18} className="ml-2 group-hover:translate-x-1 transition-transform" />
              </Button>
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section className="py-20 sm:py-32 bg-muted/30 border-y border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-12">
              <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
                Why Join Stellar?
              </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {/* Feature 1 */}
              <div className="bg-card border border-border rounded-lg p-8 hover:shadow-lg transition-all">
                <div className="w-12 h-12 bg-primary/20 rounded-lg flex items-center justify-center mb-4">
                  <Users size={24} className="text-primary" />
                </div>
                <h3 className="text-xl font-bold text-foreground mb-2">
                  Connect & Collaborate
                </h3>
                <p className="text-muted-foreground">
                  Network with industry leaders and find perfect collaborators for your next project.
                </p>
              </div>

              {/* Feature 2 */}
              <div className="bg-card border border-border rounded-lg p-8 hover:shadow-lg transition-all">
                <div className="w-12 h-12 bg-accent/20 rounded-lg flex items-center justify-center mb-4">
                  <Target size={24} className="text-accent" />
                </div>
                <h3 className="text-xl font-bold text-foreground mb-2">
                  Bounty Opportunities
                </h3>
                <p className="text-muted-foreground">
                  Participate in exclusive bounties and showcase your expertise to potential clients.
                </p>
              </div>

              {/* Feature 3 */}
              <div className="bg-card border border-border rounded-lg p-8 hover:shadow-lg transition-all">
                <div className="w-12 h-12 bg-secondary/20 rounded-lg flex items-center justify-center mb-4">
                  <Sparkles size={24} className="text-secondary" />
                </div>
                <h3 className="text-xl font-bold text-foreground mb-2">
                  World-Class Platform
                </h3>
                <p className="text-muted-foreground">
                  Showcase your portfolio on a premium platform designed for creators.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-20 sm:py-32">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
              Ready to Join the Creator Community?
            </h2>
            <p className="text-lg text-muted-foreground mb-8">
              Explore our directory of stellar creators and start your next amazing project.
            </p>
            <Button size="lg" className="group" onClick={() => router.push('/creators')}>
              Get Started
              <ArrowRight size={18} className="ml-2 group-hover:translate-x-1 transition-transform" />
            </Button>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
