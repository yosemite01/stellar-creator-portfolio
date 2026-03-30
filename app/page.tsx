'use client';

import { useRouter } from 'next/navigation';
import { useI18n } from '@/components/i18n-provider';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { CreatorCard } from '@/components/cards/creator-card';
import { Button } from '@/components/ui/button';
import { ArrowRight, Sparkles, Users, Target } from 'lucide-react';
import { creators } from '@/lib/services/creators-data';

export default function Home() {
  const router = useRouter();
  const { t } = useI18n();
  const featuredCreators = creators.slice(0, 3);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />

      <main className="flex-grow">
        {/* Hero Section */}
        <section className="relative overflow-hidden border-b border-border">
          {/* Minimal Background - Professional Look */}
          <div className="absolute inset-0 bg-gradient-to-b from-primary/3 to-transparent" />

          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24 md:py-32">
            <div className="text-center max-w-4xl mx-auto">
              {/* Subtitle Badge */}
              <p className="text-sm font-semibold text-primary mb-4 uppercase tracking-wide">
                {t('home.heroBadge')}
              </p>

              {/* Main Heading */}
              <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold text-foreground mb-6 text-balance leading-tight">
                {t('home.heroTitle')}
              </h1>

              {/* Subheading */}
              <p className="text-base sm:text-lg text-muted-foreground mb-8 max-w-3xl mx-auto text-balance leading-relaxed">
                {t('home.heroSubtitle')}
              </p>

              {/* CTA Buttons */}
              <div className="flex flex-col sm:flex-row gap-3 justify-center items-center sm:items-stretch mb-8">
                <Button size="lg" className="w-full sm:w-auto" onClick={() => router.push('/creators')}>
                  {t('home.browseCreators')}
                  <ArrowRight size={18} className="ms-2" />
                </Button>
                <Button size="lg" variant="outline" className="w-full sm:w-auto" onClick={() => router.push('/bounties')}>
                  {t('home.postBounty')}
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* Stats Section */}
        <section className="py-12 sm:py-16 border-b border-border bg-muted/30">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8">
              <div className="text-center">
                <div className="text-3xl sm:text-4xl font-bold text-primary mb-2">
                  {creators.length}+
                </div>
                <p className="text-sm sm:text-base text-muted-foreground">{t('home.statsCreators')}</p>
              </div>
              <div className="text-center">
                <div className="text-3xl sm:text-4xl font-bold text-primary mb-2">
                  {creators.reduce((sum, c) => sum + c.projects.length, 0)}+
                </div>
                <p className="text-sm sm:text-base text-muted-foreground">{t('home.statsProjects')}</p>
              </div>
              <div className="text-center">
                <div className="text-3xl sm:text-4xl font-bold text-primary mb-2">
                  15+
                </div>
                <p className="text-sm sm:text-base text-muted-foreground">{t('home.statsDisciplines')}</p>
              </div>
            </div>
          </div>
        </section>

        {/* Featured Creators Section */}
        <section className="py-16 sm:py-24">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            {/* Section Header */}
            <div className="text-center mb-12 sm:mb-16">
              <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-foreground mb-3 sm:mb-4">
                {t('home.featuredTitle')}
              </h2>
              <p className="text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto">
                {t('home.featuredSubtitle')}
              </p>
            </div>

            {/* Creators Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
              {featuredCreators.map((creator) => (
                <CreatorCard key={creator.id} creator={creator} />
              ))}
            </div>

            {/* View All CTA */}
            <div className="text-center">
              <Button size="lg" variant="outline" className="group" onClick={() => router.push('/creators')}>
                {t('home.viewAllCreators')}
                <ArrowRight size={18} className="ms-2 group-hover:translate-x-1 transition-transform rtl:group-hover:-translate-x-1" />
              </Button>
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section className="py-16 sm:py-24 bg-muted/30 border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-12 sm:mb-16">
              <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-foreground mb-3">
                {t('home.whyTitle')}
              </h2>
              <p className="text-muted-foreground max-w-2xl mx-auto">
                {t('home.whySubtitle')}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8">
              {/* Feature 1 */}
              <div className="bg-card border border-border rounded-lg p-6 sm:p-8 hover:shadow-lg transition-all duration-300">
                <div className="w-10 h-10 bg-primary/15 rounded-lg flex items-center justify-center mb-4">
                  <Users size={20} className="text-primary" />
                </div>
                <h3 className="text-lg sm:text-xl font-bold text-foreground mb-3">
                  {t('home.feature1Title')}
                </h3>
                <p className="text-sm sm:text-base text-muted-foreground leading-relaxed">
                  {t('home.feature1Body')}
                </p>
              </div>

              {/* Feature 2 */}
              <div className="bg-card border border-border rounded-lg p-6 sm:p-8 hover:shadow-lg transition-all duration-300">
                <div className="w-10 h-10 bg-accent/15 rounded-lg flex items-center justify-center mb-4">
                  <Target size={20} className="text-accent" />
                </div>
                <h3 className="text-lg sm:text-xl font-bold text-foreground mb-3">
                  {t('home.feature2Title')}
                </h3>
                <p className="text-sm sm:text-base text-muted-foreground leading-relaxed">
                  {t('home.feature2Body')}
                </p>
              </div>

              {/* Feature 3 */}
              <div className="bg-card border border-border rounded-lg p-6 sm:p-8 hover:shadow-lg transition-all duration-300">
                <div className="w-10 h-10 bg-secondary/15 rounded-lg flex items-center justify-center mb-4">
                  <Sparkles size={20} className="text-secondary" />
                </div>
                <h3 className="text-lg sm:text-xl font-bold text-foreground mb-3">
                  {t('home.feature3Title')}
                </h3>
                <p className="text-sm sm:text-base text-muted-foreground leading-relaxed">
                  {t('home.feature3Body')}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-16 sm:py-24 border-t border-border">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-foreground mb-4 sm:mb-6">
              {t('home.ctaTitle')}
            </h2>
            <p className="text-base sm:text-lg text-muted-foreground mb-8 sm:mb-10 max-w-2xl mx-auto">
              {t('home.ctaSubtitle')}
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center items-center sm:items-stretch">
              <Button size="lg" className="w-full sm:w-auto" onClick={() => router.push('/creators')}>
                {t('home.ctaBrowse')}
                <ArrowRight size={18} className="ms-2" />
              </Button>
              <Button size="lg" variant="outline" className="w-full sm:w-auto" onClick={() => router.push('/bounties')}>
                {t('home.ctaPost')}
              </Button>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
