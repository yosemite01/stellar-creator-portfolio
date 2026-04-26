'use client';

import Link from 'next/link';
import Image from 'next/image';
import { Linkedin, Twitter } from 'lucide-react';

export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="border-t border-border bg-muted/30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 mb-8">
          {/* Brand */}
          <div className="sm:col-span-2 lg:col-span-1">
            <div className="flex items-center gap-2 mb-4">
              <Image
                src="/stellar-logo.jpg"
                alt="Stellar"
                width={32}
                height={32}
                className="rounded-lg"
              />
              <span className="font-bold text-lg text-foreground">Stellar</span>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              The platform connecting world-class creators with exceptional opportunities.
            </p>
          </div>

          {/* Navigation */}
          <div>
            <h3 className="font-semibold text-foreground mb-4 text-sm uppercase tracking-wide">Platform</h3>
            <nav className="space-y-3">
              <Link href="/" className="block text-sm text-muted-foreground hover:text-primary transition-colors">
                Home
              </Link>
              <Link href="/creators" className="block text-sm text-muted-foreground hover:text-primary transition-colors">
                Creators
              </Link>
              <Link href="/freelancers" className="block text-sm text-muted-foreground hover:text-primary transition-colors">
                Hire
              </Link>
              <Link href="/bounties" className="block text-sm text-muted-foreground hover:text-primary transition-colors">
                Bounties
              </Link>
            </nav>
          </div>

          {/* Company */}
          <div>
            <h3 className="font-semibold text-foreground mb-4 text-sm uppercase tracking-wide">Company</h3>
            <nav className="space-y-3">
              <Link href="/about" className="block text-sm text-muted-foreground hover:text-primary transition-colors">
                About Us
              </Link>
              <a href="#" className="block text-sm text-muted-foreground hover:text-primary transition-colors">
                Blog
              </a>
              <a href="#" className="block text-sm text-muted-foreground hover:text-primary transition-colors">
                Contact
              </a>
            </nav>
          </div>

          {/* Social */}
          <div>
            <h3 className="font-semibold text-foreground mb-4 text-sm uppercase tracking-wide">Follow</h3>
            <div className="flex gap-3">
              <a
                href="#"
                target="_blank"
                rel="noopener noreferrer"
                className="p-2 bg-secondary hover:bg-secondary/80 rounded-lg transition-colors"
                aria-label="LinkedIn"
              >
                <Linkedin size={16} className="text-primary" />
              </a>
              <a
                href="#"
                target="_blank"
                rel="noopener noreferrer"
                className="p-2 bg-secondary hover:bg-secondary/80 rounded-lg transition-colors"
                aria-label="Twitter"
              >
                <Twitter size={16} className="text-primary" />
              </a>
            </div>
          </div>
        </div>

        {/* Bottom */}
        <div className="border-t border-border pt-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-center sm:text-left">
          <p className="text-xs sm:text-sm text-muted-foreground">
            &copy; {currentYear} Stellar. All rights reserved.
          </p>
          <div className="flex items-center gap-6">
            <a href="#" className="text-xs sm:text-sm text-muted-foreground hover:text-primary transition-colors">
              Privacy
            </a>
            <a href="#" className="text-xs sm:text-sm text-muted-foreground hover:text-primary transition-colors">
              Terms
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
