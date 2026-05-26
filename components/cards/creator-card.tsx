'use client';

import { useRouter } from 'next/navigation';
import { Creator } from '@/lib/services/creators-data';
import { ArrowRight, Linkedin, Twitter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Image from 'next/image';
import { buildOptimizationProps, buildSizes } from '@/lib/utils/image-utils';
import { VerificationBadge, BadgeRow } from '@/components/widgets/verification-badge';

interface CreatorCardProps {
  creator: Creator;
}

export function CreatorCard({ creator }: CreatorCardProps) {
  const router = useRouter();
  const coverSizes = buildSizes({
    mobile: '100vw',
    tablet: '50vw',
    desktop: '33vw',
    largeDesktop: '33vw',
  });

  const handleCardClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Don't navigate if clicking on anchors or buttons
    if ((e.target as HTMLElement).closest('a, button')) {
      return;
    }
    router.push(`/creators/${creator.id}`);
  };

  return (
    <div
      onClick={handleCardClick}
      className="group h-full bg-card border border-border rounded-lg overflow-hidden hover:shadow-lg transition-all duration-300 hover:-translate-y-1 cursor-pointer"
    >
      {/* Cover Image */}
      <div className="aspect-video bg-gradient-to-br from-primary/20 to-accent/20 overflow-hidden relative">
        {creator.coverImage && (
          <Image
            src={creator.coverImage}
            alt={`${creator.name} cover image`}
            fill
            className="object-cover group-hover:scale-105 transition-transform duration-300"
            {...buildOptimizationProps({ sizes: coverSizes })}
            sizes={coverSizes}
            placeholder="empty"
          />
        )}
      </div>

      {/* Content */}
      <div className="p-6">
        {/* Discipline Badge */}
        <div className="inline-block mb-3">
          <span className="text-xs font-semibold px-3 py-1 bg-accent/20 text-accent rounded-full">
            {creator.discipline}
          </span>
        </div>

        {/* Name & Title */}
        <h3 className="text-lg font-bold text-foreground mb-1 line-clamp-2 flex items-center gap-1.5">
          {creator.name}
          {creator.verification && (
            <VerificationBadge
              status={creator.verification.status}
              verifiedAt={creator.verification.verifiedAt}
              size="sm"
            />
          )}
          {creator.verification?.badges && (
            <BadgeRow badges={creator.verification.badges} size="sm" />
          )}
        </h3>
        <p className="text-sm text-muted-foreground mb-2">
          {creator.title}
        </p>

        {/* Tagline */}
        <p className="text-sm font-medium text-foreground mb-4 italic">
          {creator.tagline}
        </p>

        {/* Stats */}
        {creator.stats && (
          <div className="grid grid-cols-3 gap-3 mb-4 py-3 border-y border-border">
            <div className="text-center">
              <div className="text-lg font-bold text-primary">{creator.stats.projects}</div>
              <div className="text-xs text-muted-foreground">Projects</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-primary">{creator.stats.clients}</div>
              <div className="text-xs text-muted-foreground">Clients</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-primary">{creator.stats.experience}y</div>
              <div className="text-xs text-muted-foreground">Experience</div>
            </div>
          </div>
        )}

        {/* Social Links */}
        <div className="flex gap-2 mb-4">
          {creator.linkedIn && (
            <a
              href={creator.linkedIn}
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 hover:bg-secondary rounded-lg transition-colors"
              aria-label="LinkedIn"
            >
              <Linkedin size={18} className="text-primary" />
            </a>
          )}
          {creator.twitter && (
            <a
              href={creator.twitter}
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 hover:bg-secondary rounded-lg transition-colors"
              aria-label="Twitter"
            >
              <Twitter size={18} className="text-primary" />
            </a>
          )}
        </div>

        {/* CTA Button */}
        <Button
          className="w-full group/btn"
          variant="default"
          onClick={() => router.push(`/creators/${creator.id}`)}
        >
          View Portfolio
          <ArrowRight size={16} className="ml-2 group-hover/btn:translate-x-1 transition-transform" />
        </Button>
      </div>
    </div>
  );
}
