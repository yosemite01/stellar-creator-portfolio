'use client';

import { useRouter } from 'next/navigation';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { Button } from '@/components/ui/button';
import { TeamSection } from '@/components/team-section';
import { FeatureGallery } from '@/components/feature-gallery';
import { ArrowRight, Heart, Globe, Zap } from 'lucide-react';

const galleryItems = [
  {
    id: 'collab',
    src: '/images/collaboration-teamwork.jpg',
    alt: 'Creators collaborating together',
    title: 'Seamless Collaboration',
    description: 'Connect with talented creatives and bring your vision to life',
  },
  {
    id: 'success',
    src: '/images/success-celebration.jpg',
    alt: 'Celebrating creative success',
    title: 'Celebrate Wins',
    description: 'Share your achievements and inspire the community',
  },
  {
    id: 'global',
    src: '/images/global-network.jpg',
    alt: 'Global creative network',
    title: 'Global Reach',
    description: 'Connect with creators and opportunities worldwide',
  },
  {
    id: 'portfolio',
    src: '/images/portfolio-showcase.jpg',
    alt: 'Portfolio showcase',
    title: 'Showcase Work',
    description: 'Display your best projects and attract new clients',
  },
];

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
                <div className="bg-card border border-border/60 rounded-lg p-8 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/10 hover:-translate-y-2 transition-all duration-300 ease-out cursor-pointer group">
                  <div className="w-12 h-12 bg-primary/20 group-hover:bg-primary/30 rounded-lg flex items-center justify-center mb-4 transition-colors duration-200">
                    <Zap size={24} className="text-primary group-hover:scale-110 transition-transform duration-200" />
                  </div>
                  <h3 className="text-xl font-bold text-foreground mb-3">Excellence</h3>
                  <p className="text-muted-foreground">
                    We maintain the highest standards, showcasing only the most talented creators and celebrating exceptional work.
                  </p>
                </div>

                {/* Value 2 */}
                <div className="bg-card border border-border/60 rounded-lg p-8 hover:border-accent/40 hover:shadow-lg hover:shadow-accent/10 hover:-translate-y-2 transition-all duration-300 ease-out cursor-pointer group">
                  <div className="w-12 h-12 bg-accent/20 group-hover:bg-accent/30 rounded-lg flex items-center justify-center mb-4 transition-colors duration-200">
                    <Globe size={24} className="text-accent group-hover:scale-110 transition-transform duration-200" />
                  </div>
                  <h3 className="text-xl font-bold text-foreground mb-3">Global Reach</h3>
                  <p className="text-muted-foreground">
                    We connect creators from around the world with international opportunities and a global audience.
                  </p>
                </div>

                {/* Value 3 */}
                <div className="bg-card border border-border/60 rounded-lg p-8 hover:border-secondary/40 hover:shadow-lg hover:shadow-secondary/10 hover:-translate-y-2 transition-all duration-300 ease-out cursor-pointer group">
                  <div className="w-12 h-12 bg-secondary/20 group-hover:bg-secondary/30 rounded-lg flex items-center justify-center mb-4 transition-colors duration-200">
                    <Heart size={24} className="text-secondary group-hover:scale-110 transition-transform duration-200" />
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
              <div className="bg-card border border-border/60 rounded-lg p-8 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/10 hover:bg-card/80 transition-all duration-300 ease-out cursor-pointer group">
                <h3 className="text-xl font-bold text-foreground mb-2 group-hover:text-primary transition-colors duration-200">Showcase Portfolios</h3>
                <p className="text-muted-foreground">
                  We provide creators with a beautiful, professional platform to display their best work and attract clients globally.
                </p>
              </div>

              {/* Feature 2 */}
              <div className="bg-card border border-border/60 rounded-lg p-8 hover:border-accent/40 hover:shadow-lg hover:shadow-accent/10 hover:bg-card/80 transition-all duration-300 ease-out cursor-pointer group">
                <h3 className="text-xl font-bold text-foreground mb-2 group-hover:text-accent transition-colors duration-200">Facilitate Collaborations</h3>
                <p className="text-muted-foreground">
                  Our platform makes it easy for creators to find collaborators, team members, and partners who share their vision and values.
                </p>
              </div>

              {/* Feature 3 */}
              <div className="bg-card border border-border/60 rounded-lg p-8 hover:border-secondary/40 hover:shadow-lg hover:shadow-secondary/10 hover:bg-card/80 transition-all duration-300 ease-out cursor-pointer group">
                <h3 className="text-xl font-bold text-foreground mb-2 group-hover:text-secondary transition-colors duration-200">Offer Bounty Opportunities</h3>
                <p className="text-muted-foreground">
                  We connect creators with exclusive bounties and projects that align with their skills and interests.
                </p>
              </div>

              {/* Feature 4 */}
              <div className="bg-card border border-border/60 rounded-lg p-8 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/10 hover:bg-card/80 transition-all duration-300 ease-out cursor-pointer group">
                <h3 className="text-xl font-bold text-foreground mb-2 group-hover:text-primary transition-colors duration-200">Build Community</h3>
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

        {/* Visual Gallery Section */}
        <section className="py-16 sm:py-24">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-3xl font-bold text-foreground mb-12 text-center">Our Creative Community</h2>
            <FeatureGallery items={galleryItems} columns={2} />
          </div>
        </section>

        {/* Team Section */}
        <TeamSection />

        {/* CTA Section */}
        <section className="py-16 sm:py-24">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2 className="text-3xl font-bold text-foreground mb-4">
              Ready to Join Us?
            </h2>
            <p className="text-lg text-muted-foreground mb-8">
              Explore our community of world-class creators and find your next collaborator or opportunity.
            </p>
            <Button
              size="lg"
              className="group shadow-lg shadow-primary/30 hover:shadow-xl hover:shadow-primary/40 hover:-translate-y-1 transition-all duration-200"
              onClick={() => router.push('/creators')}
            >
              Explore Creators
              <ArrowRight size={18} className="ml-2 group-hover:translate-x-1 transition-transform duration-200" />
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
