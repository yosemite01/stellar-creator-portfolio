'use client';

import Link from 'next/link';
import { useTheme } from 'next-themes';
import { Moon, Sun, Menu, X, AlertTriangle } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { MobileNav, MOBILE_NAV_PANEL_ID } from '@/components/layout/mobile-nav';
import { Button } from '@/components/ui/button';
import { DeferredSwapLauncher } from '@/components/streaming/deferred-swap-launcher';
import { NotificationCenter } from '@/components/notifications/notification-center';
import { ConnectWalletButton, formatAccount } from '@/components/wallet/connect-wallet-button';
import { WalletConnectModal } from '@/components/wallet/wallet-connect-modal';
import { useWallet } from '@/components/wallet/wallet-context';

export function Header() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const { address, network, walletType, isConnected, isLoading, error, connect, disconnect } = useWallet();
  const expectedNetwork: string = process.env.NEXT_PUBLIC_STELLAR_NETWORK ?? 'testnet';
  const networkMismatch = isConnected && network !== 'unknown' && network !== expectedNetwork;

  useEffect(() => {
    setMounted(true);
  }, []);

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

  const themeToggle = mounted ? (
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
  ) : null;

  return (
    <>
    <header className="sticky top-0 z-50 w-full bg-background/75 backdrop-blur-xl border-b border-border/40 shadow-sm">
      {networkMismatch && (
        <div
          role="alert"
          className="bg-yellow-500/10 border-b border-yellow-500/30 px-4 py-1.5 flex items-center justify-center gap-2 text-xs text-yellow-700 dark:text-yellow-400"
        >
          <AlertTriangle size={14} aria-hidden="true" />
          <span>Wrong network: connected to <strong>{network}</strong>, expected <strong>{expectedNetwork}</strong></span>
        </div>
      )}
      <div className="page-container">
        <div className="flex items-center justify-between h-16 transition-smooth">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 group">
            <svg
              aria-hidden="true"
              viewBox="0 0 180 180"
              width="40"
              height="40"
              className="shrink-0 rounded-lg"
            >
              <rect width="180" height="180" rx="40" fill="#6166F1" />
              <rect x="44" y="49" width="92" height="23" rx="11.5" fill="white" />
              <rect x="78.5" y="49" width="23" height="82" rx="11.5" fill="white" />
            </svg>
            <span className="font-bold text-lg text-foreground hidden sm:inline">
              Tamgora
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
                  error={error}
                  aria-haspopup="dialog"
                  aria-expanded={isWalletModalOpen}
                  onConnect={() => setIsWalletModalOpen(true)}
                  connectedLabel={address ? formatAccount(address) : undefined}
                  className="hidden sm:inline-flex"
                />
              </>
            )}
            {/* Below md the toggle lives in the off-canvas menu */}
            <div className="hidden md:block">{themeToggle}</div>

            {/* Mobile Menu Button */}
            <button
              ref={menuButtonRef}
              className="md:hidden inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg hover:bg-secondary/40 transition-smooth focus:outline-none focus:ring-2 focus:ring-ring"
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              aria-label="Toggle menu"
              aria-expanded={isMenuOpen}
              aria-controls={MOBILE_NAV_PANEL_ID}
            >
              {isMenuOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
            </button>
          </div>
        </div>

      </div>
    </header>

    {/* Rendered outside <header>: its backdrop-blur would otherwise become the
        containing block for the fixed off-canvas panel. */}
    <MobileNav
      open={isMenuOpen}
      onOpenChange={setIsMenuOpen}
      menuButtonRef={menuButtonRef}
      session={null}
      onSignOut={() => undefined}
      themeToggleSlot={themeToggle}
    />

    <WalletConnectModal
      open={isWalletModalOpen}
      onClose={() => setIsWalletModalOpen(false)}
      address={address}
      network={network}
      expectedNetwork={expectedNetwork}
      walletType={walletType}
      isConnected={isConnected}
      isLoading={isLoading}
      error={error}
      onConnect={connect}
      onDisconnect={disconnect}
    />
    </>
  );
}
