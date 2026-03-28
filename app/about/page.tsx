'use client';

import { useRouter } from 'next/navigation';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { Button } from '@/components/ui/button';
import { ArrowRight, Heart, Globe, Zap } from 'lucide-react';

export default function AboutPage() {
  const router = useRouter();
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />

      <main className="flex-grow">
        {/* Hero Section */}
        <section className="border-b border-border bg-muted/30 py-16 sm:py-24">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h1 className="text-4xl sm:text-5xl font-bold text-foreground mb-6">
              About Stellar
            </h1>
            <p className="text-xl text-muted-foreground">
              We're building the world's premier platform for connecting exceptional creators with meaningful opportunities.
            </p>
          </div>
        </section>

        {/* Mission Section */}
        <section className="py-16 sm:py-24">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center mb-16">
              <div>
                <h2 className="text-3xl font-bold text-foreground mb-6">Our Mission</h2>
                <p className="text-lg text-muted-foreground leading-relaxed mb-4">
                  Stellar exists to empower world-class creators and connect them with exciting opportunities. We believe exceptional work deserves exceptional recognition.
                </p>
                <p className="text-lg text-muted-foreground leading-relaxed">
                  By building a curated community of talented designers, writers, and content creators, we're creating a platform where creativity thrives and collaborations flourish.
                </p>
              </div>
              <div className="bg-gradient-to-br from-primary/20 to-accent/20 rounded-lg h-80 flex items-center justify-center border border-border">
                <div className="text-center">
                  <Heart size={48} className="mx-auto mb-4 text-primary" />
                  <p className="text-muted-foreground">Celebrating Creative Excellence</p>
                </div>
              </div>
            </div>

            {/* Values Section */}
            <div>
              <h2 className="text-3xl font-bold text-foreground mb-8 text-center">Our Values</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Value 1 */}
                <div className="bg-card border border-border rounded-lg p-8">
                  <div className="w-12 h-12 bg-primary/20 rounded-lg flex items-center justify-center mb-4">
                    <Zap size={24} className="text-primary" />
                  </div>
                  <h3 className="text-xl font-bold text-foreground mb-3">Excellence</h3>
                  <p className="text-muted-foreground">
                    We maintain the highest standards, showcasing only the most talented creators and celebrating exceptional work.
                  </p>
                </div>

                {/* Value 2 */}
                <div className="bg-card border border-border rounded-lg p-8">
                  <div className="w-12 h-12 bg-accent/20 rounded-lg flex items-center justify-center mb-4">
                    <Globe size={24} className="text-accent" />
                  </div>
                  <h3 className="text-xl font-bold text-foreground mb-3">Global Reach</h3>
                  <p className="text-muted-foreground">
                    We connect creators from around the world with international opportunities and a global audience.
                  </p>
                </div>

                {/* Value 3 */}
                <div className="bg-card border border-border rounded-lg p-8">
                  <div className="w-12 h-12 bg-secondary/20 rounded-lg flex items-center justify-center mb-4">
                    <Heart size={24} className="text-secondary" />
                  </div>
                  <h3 className="text-xl font-bold text-foreground mb-3">Community</h3>
                  <p className="text-muted-foreground">
                    We foster meaningful relationships and collaborations within our creative community.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* What We Do Section */}
        <section className="border-y border-border bg-muted/30 py-16 sm:py-24">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-3xl font-bold text-foreground mb-8 text-center">What We Do</h2>
            <div className="space-y-6">
              {/* Feature 1 */}
              <div className="bg-card border border-border rounded-lg p-8">
                <h3 className="text-xl font-bold text-foreground mb-2">Showcase Portfolios</h3>
                <p className="text-muted-foreground">
                  We provide creators with a beautiful, professional platform to display their best work and attract clients globally.
                </p>
              </div>

              {/* Feature 2 */}
              <div className="bg-card border border-border rounded-lg p-8">
                <h3 className="text-xl font-bold text-foreground mb-2">Facilitate Collaborations</h3>
                <p className="text-muted-foreground">
                  Our platform makes it easy for creators to find collaborators, team members, and partners who share their vision and values.
                </p>
              </div>

              {/* Feature 3 */}
              <div className="bg-card border border-border rounded-lg p-8">
                <h3 className="text-xl font-bold text-foreground mb-2">Offer Bounty Opportunities</h3>
                <p className="text-muted-foreground">
                  We connect creators with exclusive bounties and projects that align with their skills and interests.
                </p>
              </div>

              {/* Feature 4 */}
              <div className="bg-card border border-border rounded-lg p-8">
                <h3 className="text-xl font-bold text-foreground mb-2">Build Community</h3>
                <p className="text-muted-foreground">
                  We cultivate a supportive environment where creators can learn from each other, share experiences, and grow together.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Stats Section */}
        <section className="py-16 sm:py-24">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-3xl font-bold text-foreground mb-12 text-center">Our Impact</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="text-center">
                <div className="text-5xl font-bold text-primary mb-2">4+</div>
                <p className="text-muted-foreground">Stellar Creators</p>
              </div>
              <div className="text-center">
                <div className="text-5xl font-bold text-primary mb-2">30+</div>
                <p className="text-muted-foreground">Portfolio Projects</p>
              </div>
              <div className="text-center">
                <div className="text-5xl font-bold text-primary mb-2">3</div>
                <p className="text-muted-foreground">Creative Disciplines</p>
              </div>
            </div>
          </div>
        </section>

        {/* Team Section */}
        <section className="border-t border-border bg-muted/30 py-16 sm:py-24">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-3xl font-bold text-foreground mb-8 text-center">Built for Creators</h2>
            <p className="text-lg text-muted-foreground text-center mb-12">
              Stellar was created by designers, writers, and creators who understand the challenges and opportunities in the creative industry. We're passionate about building tools that make your work shine.
            </p>
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-16 sm:py-24">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2 className="text-3xl font-bold text-foreground mb-4">
              Ready to Join Us?
            </h2>
            <p className="text-lg text-muted-foreground mb-8">
              Explore our community of world-class creators and find your next collaborator or opportunity.
            </p>
            <Button size="lg" className="group" onClick={() => router.push('/creators')}>
              Explore Creators
              <ArrowRight size={18} className="ml-2 group-hover:translate-x-1 transition-transform" />
            </Button>
          </div>
        </section>

        {/* Contact Section */}
        <section className="border-t border-border bg-muted/30 py-12">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h3 className="font-semibold text-foreground mb-4">Have Questions?</h3>
            <a
              href="mailto:contact@stellar.com"
              className="text-accent hover:text-primary transition-colors font-medium"
            >
              contact@stellar.com
            </a>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
