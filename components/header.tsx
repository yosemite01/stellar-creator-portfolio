'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useTheme } from 'next-themes';
import { Moon, Sun, Menu, X, AlertTriangle } from 'lucide-react';
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { DeferredSwapLauncher } from '@/components/streaming/deferred-swap-launcher';
import { NotificationCenter } from '@/backend/services/notifications/notification-center';
import { ConnectWalletButton, formatAccount } from '@/components/connect-wallet-button';
import { useWallet } from '@/contexts/WalletContext';

export function Header() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const { address, network, isConnected, isLoading, connect, disconnect } = useWallet();
  const expectedNetwork: string = process.env.NEXT_PUBLIC_STELLAR_NETWORK ?? 'testnet';
  const networkMismatch = isConnected && network !== 'unknown' && network !== expectedNetwork;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isMenuOpen) {
        setIsMenuOpen(false);
      }
    };

    if (isMenuOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isMenuOpen]);

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  const navigationItems = [
    { href: '/', label: 'Home' },
    { href: '/creators', label: 'Creators' },
    { href: '/freelancers', label: 'Hire' },
    { href: '/bounties', label: 'Bounties' },
    { href: '/about', label: 'About' },
  ];

  return (
    <header className="sticky top-0 z-50 w-full bg-background/75 backdrop-blur-xl border-b border-border/40 shadow-sm">
      {networkMismatch && (
        <div className="bg-yellow-500/10 border-b border-yellow-500/30 px-4 py-1.5 flex items-center justify-center gap-2 text-xs text-yellow-700 dark:text-yellow-400">
          <AlertTriangle size={14} aria-hidden="true" />
          <span>Wrong network: connected to <strong>{network}</strong>, expected <strong>{expectedNetwork}</strong></span>
        </div>
      )}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 transition-smooth">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 group">
            <Image
              src="/stellar-logo.jpg"
              alt="Stellar Logo"
              width={40}
              height={40}
              className="rounded-lg"
              priority
            />
            <span className="font-bold text-lg text-foreground hidden sm:inline">
              Stellar
            </span>
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-1">
            {navigationItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="px-4 py-2 text-sm font-medium text-foreground hover:text-primary bg-transparent hover:bg-secondary/40 transition-smooth rounded-lg"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          {/* Right Actions */}
          <div className="flex items-center gap-2">
            <DeferredSwapLauncher />
            <NotificationCenter />
            {mounted && (
              <>
                {isConnected && network !== 'unknown' && (
                  <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20">
                    {network}
                  </span>
                )}
                <ConnectWalletButton
                  account={address}
                  isLoading={isLoading}
                  onConnect={isConnected ? disconnect : () => connect('freighter')}
                  connectedLabel={address ? formatAccount(address) : undefined}
                  className="hidden sm:inline-flex"
                />
              </>
            )}
            {mounted && (
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleTheme}
                aria-label="Toggle theme"
                aria-pressed={theme === 'dark'}
                className="rounded-lg hover:bg-secondary/40 transition-smooth"
              >
                {theme === 'dark' ? (
                  <Sun size={20} className="text-accent animate-rotate-slow" />
                ) : (
                  <Moon size={20} className="text-primary animate-pulse-slow" />
                )}
              </Button>
            )}

            {/* Mobile Menu Button */}
            <button
              className="md:hidden p-2 hover:bg-secondary/40 rounded-lg transition-smooth"
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              aria-label="Toggle menu"
            >
              {isMenuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>

        {/* Mobile Navigation */}
        {isMenuOpen && (
          <nav className="md:hidden border-t border-border/40 bg-background animate-slide-up">
            <div className="flex flex-col py-2">
              {navigationItems.map((item, index) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="block px-4 py-3 text-sm font-medium text-foreground hover:text-primary hover:bg-secondary/40 transition-smooth min-h-[44px] flex items-center"
                  onClick={() => setIsMenuOpen(false)}
                  style={{
                    animation: `slide-up 0.3s ease-out ${index * 0.05}s backwards`,
                  }}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </nav>
        )}
      </div>
    </header>
  );
}
