'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useTheme } from 'next-themes';
import { Moon, Sun, Menu, X, User, LogOut, LayoutDashboard } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

export function Header() {
  const { theme, setTheme } = useTheme();
  const { data: session } = useSession();
  const [mounted, setMounted] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  useEffect(() => {
    setMounted(true); // eslint-disable-line react-hooks/set-state-in-effect
  }, []);

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  const handleSignOut = async () => {
    await signOut({ callbackUrl: '/' });
  };

  const getUserInitials = () => {
    if (!session?.user?.name) return 'U';
    return session.user.name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <header className="sticky top-0 z-50 w-full bg-background/80 backdrop-blur-md border-b border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
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
            <Link href="/" className="px-4 py-2 text-sm font-medium text-foreground hover:text-primary transition-colors rounded-lg hover:bg-secondary/50">
              Home
            </Link>
            <Link href="/creators" className="px-4 py-2 text-sm font-medium text-foreground hover:text-primary transition-colors rounded-lg hover:bg-secondary/50">
              Creators
            </Link>
            <Link href="/freelancers" className="px-4 py-2 text-sm font-medium text-foreground hover:text-primary transition-colors rounded-lg hover:bg-secondary/50">
              Hire
            </Link>
            <Link href="/bounties" className="px-4 py-2 text-sm font-medium text-foreground hover:text-primary transition-colors rounded-lg hover:bg-secondary/50">
              Bounties
            </Link>
            <Link href="/about" className="px-4 py-2 text-sm font-medium text-foreground hover:text-primary transition-colors rounded-lg hover:bg-secondary/50">
              About
            </Link>
            {session && (
              <Link href="/disputes" className="px-4 py-2 text-sm font-medium text-foreground hover:text-primary transition-colors rounded-lg hover:bg-secondary/50">
                Disputes
              </Link>
            )}
          </nav>

          {/* Right Actions */}
          <div className="flex items-center gap-2">
            {mounted && (
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleTheme}
                aria-label="Toggle theme"
              >
                {theme === 'dark' ? (
                  <Sun size={20} className="text-accent" />
                ) : (
                  <Moon size={20} className="text-primary" />
                )}
              </Button>
            )}

            {session ? (
              <>
                {/* Desktop User Menu */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" className="relative h-9 w-9 rounded-full">
                      <Avatar className="h-9 w-9">
                        <AvatarImage src={session.user.image || undefined} alt={session.user.name || ''} />
                        <AvatarFallback>{getUserInitials()}</AvatarFallback>
                      </Avatar>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-56" align="end" forceMount>
                    <DropdownMenuLabel className="font-normal">
                      <div className="flex flex-col space-y-1">
                        <p className="text-sm font-medium leading-none">
                          {session.user.name || 'User'}
                        </p>
                        <p className="text-xs leading-none text-muted-foreground">
                          {session.user.email}
                        </p>
                      </div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                      <Link href="/dashboard" className="flex items-center">
                        <LayoutDashboard className="mr-2 h-4 w-4" />
                        Dashboard
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link href="/dashboard" className="flex items-center">
                        <User className="mr-2 h-4 w-4" />
                        Profile
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleSignOut}>
                      <LogOut className="mr-2 h-4 w-4" />
                      Log out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                {/* Mobile Menu Button */}
                <button
                  className="md:hidden p-2 hover:bg-secondary rounded-lg transition-colors"
                  onClick={() => setIsMenuOpen(!isMenuOpen)}
                  aria-label="Toggle menu"
                >
                  {isMenuOpen ? <X size={20} /> : <Menu size={20} />}
                </button>
              </>
            ) : (
              <>
                {/* Auth Buttons */}
                <div className="hidden md:flex items-center gap-2">
                  <Link href="/auth/login">
                    <Button variant="ghost" size="sm">
                      Sign In
                    </Button>
                  </Link>
                  <Link href="/auth/register">
                    <Button size="sm">
                      Sign Up
                    </Button>
                  </Link>
                </div>

                {/* Mobile Menu Button */}
                <button
                  className="md:hidden p-2 hover:bg-secondary rounded-lg transition-colors"
                  onClick={() => setIsMenuOpen(!isMenuOpen)}
                  aria-label="Toggle menu"
                >
                  {isMenuOpen ? <X size={20} /> : <Menu size={20} />}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Mobile Navigation */}
        {isMenuOpen && (
          <nav className="md:hidden pb-4 border-t border-border">
            <Link href="/" className="block px-4 py-2 text-sm font-medium text-foreground hover:text-primary transition-colors">
              Home
            </Link>
            <Link href="/creators" className="block px-4 py-2 text-sm font-medium text-foreground hover:text-primary transition-colors">
              Creators
            </Link>
            <Link href="/freelancers" className="block px-4 py-2 text-sm font-medium text-foreground hover:text-primary transition-colors">
              Hire
            </Link>
            <Link href="/bounties" className="block px-4 py-2 text-sm font-medium text-foreground hover:text-primary transition-colors">
              Bounties
            </Link>
            <Link href="/about" className="block px-4 py-2 text-sm font-medium text-foreground hover:text-primary transition-colors">
              About
            </Link>
            {session && (
              <Link href="/disputes" className="block px-4 py-2 text-sm font-medium text-foreground hover:text-primary transition-colors">
                Disputes
              </Link>
            )}
            
            {session ? (
              <>
                <Link href="/dashboard" className="block px-4 py-2 text-sm font-medium text-foreground hover:text-primary transition-colors">
                  Dashboard
                </Link>
                <button
                  onClick={handleSignOut}
                  className="w-full text-left px-4 py-2 text-sm font-medium text-destructive hover:text-destructive transition-colors"
                >
                  Sign Out
                </button>
              </>
            ) : (
              <>
                <Link href="/auth/login" className="block px-4 py-2 text-sm font-medium text-primary hover:text-primary transition-colors">
                  Sign In
                </Link>
                <Link href="/auth/register" className="block px-4 py-2 text-sm font-medium text-primary hover:text-primary transition-colors">
                  Sign Up
                </Link>
              </>
            )}
          </nav>
        )}
      </div>
    </header>
  );
}
