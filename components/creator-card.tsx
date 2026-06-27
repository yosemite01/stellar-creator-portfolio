'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Creator } from '@/lib/creators-data';
import { ArrowRight, Linkedin, Twitter, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useComparison } from '@/components/ComparisonContext';
import Image from 'next/image';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface CreatorCardProps {
  creator: Creator;
}

export function CreatorCard({ creator }: CreatorCardProps) {
  const router = useRouter();
  const { addCreator, removeCreator, isSelected, canAddMore, selectedCreators } = useComparison();
  const [showTooltip, setShowTooltip] = useState(false);

  const handleCardClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Don't navigate if clicking on anchors or buttons
    if ((e.target as HTMLElement).closest('a, button, input')) {
      return;
    }
    router.push(`/creators/${creator.id}`);
  };

  const handleCompareToggle = (e: React.MouseEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (isSelected(creator.id)) {
      removeCreator(creator.id);
    } else if (canAddMore()) {
      addCreator(creator);
    } else {
      setShowTooltip(true);
      setTimeout(() => setShowTooltip(false), 3000);
    }
  };

  return (
    <div
      onClick={handleCardClick}
      className="group h-full bg-card border border-border/60 rounded-lg overflow-hidden hover:shadow-xl shadow-sm transition-smooth hover:-translate-y-2 cursor-pointer relative"
    >
      {/* Compare Checkbox */}
      <div className="absolute top-3 right-3 z-10">
        <TooltipProvider>
          <Tooltip open={showTooltip} onOpenChange={setShowTooltip}>
            <TooltipTrigger asChild>
              <label className="flex items-center gap-2 bg-background/90 backdrop-blur-sm px-3 py-2 rounded-lg border border-border cursor-pointer hover:bg-background/95 transition-colors">
                <input
                  type="checkbox"
                  checked={isSelected(creator.id)}
                  onChange={handleCompareToggle}
                  disabled={!canAddMore() && !isSelected(creator.id)}
                  className="w-4 h-4 cursor-pointer"
                />
                <span className="text-xs font-semibold text-muted-foreground">
                  {isSelected(creator.id) ? (
                    <Check size={14} className="text-green-500" />
                  ) : (
                    'Compare'
                  )}
                </span>
              </label>
            </TooltipTrigger>
            {!canAddMore() && !isSelected(creator.id) && (
              <TooltipContent className="bg-background border border-border">
                <p className="text-xs">
                  Maximum 3 creators for comparison
                </p>
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* Cover Image */}
      <div className="aspect-video bg-gradient-to-br from-primary/20 to-accent/20 overflow-hidden relative">
        {creator.coverImage && (
          <Image
            src={creator.coverImage}
            alt={creator.name}
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            className="object-cover group-hover:scale-105 transition-transform duration-300"
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
        <h3 className="text-lg font-bold text-foreground mb-1 line-clamp-2">
          {creator.name}
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
