'use client';

import { useState } from 'react';
import { Copy, Check, Twitter, Linkedin, Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ReferralWidgetProps {
  referralUrl: string;
  code: string;
}

export function ReferralWidget({ referralUrl, code }: ReferralWidgetProps) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(referralUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const shareText = encodeURIComponent(`Join me on Stellar — the platform for world-class non-technical tech talent. Use my referral link:`);

  const socials = [
    {
      label: 'Twitter',
      icon: Twitter,
      href: `https://twitter.com/intent/tweet?text=${shareText}&url=${encodeURIComponent(referralUrl)}`,
      color: 'text-sky-500',
    },
    {
      label: 'LinkedIn',
      icon: Linkedin,
      href: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(referralUrl)}`,
      color: 'text-blue-600',
    },
  ];

  return (
    <div className="bg-card border border-border rounded-lg p-6 space-y-4">
      <div className="flex items-center gap-2 mb-1">
        <Share2 size={18} className="text-primary" />
        <h3 className="font-semibold text-foreground">Your Referral Link</h3>
      </div>

      {/* Link copy row */}
      <div className="flex gap-2">
        <input
          readOnly
          value={referralUrl}
          aria-label="Referral URL"
          className="flex-1 min-w-0 px-3 py-2 bg-muted border border-border rounded-lg text-sm text-foreground font-mono truncate focus:outline-none"
        />
        <Button variant="outline" size="sm" onClick={copy} className="shrink-0 gap-1.5">
          {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
          {copied ? 'Copied!' : 'Copy'}
        </Button>
      </div>

      {/* Code badge */}
      <p className="text-xs text-muted-foreground">
        Code: <span className="font-mono font-semibold text-foreground">{code}</span>
      </p>

      {/* Social share */}
      <div className="flex gap-2 pt-1">
        {socials.map(({ label, icon: Icon, href, color }) => (
          <a
            key={label}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Share on ${label}`}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-muted hover:bg-secondary rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <Icon size={14} className={color} />
            {label}
          </a>
        ))}
      </div>
    </div>
  );
}
