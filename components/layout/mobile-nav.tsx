'use client'

import Link from 'next/link'
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import type { Session } from 'next-auth'
import { ChevronDown, LayoutDashboard, LogOut, Sparkles, User, X } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import {
  collectFocusableElements,
  nextFocusIndex,
  shouldCloseMenuOnHorizontalSwipe,
} from '@/lib/utils/mobile-nav-utils'

/** Stable id for `aria-controls` on the menu button (header + drawer). */
export const MOBILE_NAV_PANEL_ID = 'main-mobile-nav-panel'

export interface MobileNavProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  menuButtonRef: React.RefObject<HTMLElement | null>
  session: Session | null
  onSignOut: () => void
  /** Rendered inside the drawer (e.g. theme toggle). */
  themeToggleSlot?: React.ReactNode
}

export function MobileNav({
  open,
  onOpenChange,
  menuButtonRef,
  session,
  onSignOut,
  themeToggleSlot,
}: MobileNavProps) {
  const subMenuSuffix = useId()
  const backdropRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const touchStartX = useRef<number | null>(null)
  const [browseOpen, setBrowseOpen] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(false)

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      queueMicrotask(() => setReducedMotion(false))
      return
    }
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReducedMotion(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  const close = useCallback(() => onOpenChange(false), [onOpenChange])

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const panel = panelRef.current
    if (!panel) return
    const t = window.setTimeout(() => {
      const nodes = collectFocusableElements(panel)
      nodes[0]?.focus()
    }, reducedMotion ? 0 : 50)
    return () => window.clearTimeout(t)
  }, [open, reducedMotion])

  useEffect(() => {
    if (!open) return
    const panel = panelRef.current
    if (!panel) return

    function onDocKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
        return
      }
      if (e.key !== 'Tab') return
      const nodes = collectFocusableElements(panel)
      if (nodes.length === 0) return
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      const active = document.activeElement as HTMLElement | undefined
      if (e.shiftKey) {
        if (active === first) {
          e.preventDefault()
          last.focus()
        }
      } else if (active === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onDocKeyDown)
    return () => document.removeEventListener('keydown', onDocKeyDown)
  }, [open, close])

  useEffect(() => {
    if (!open) return
    const ref = menuButtonRef
    return () => {
      queueMicrotask(() => ref.current?.focus())
    }
  }, [open, menuButtonRef])

  const moveFocusByArrow = useCallback((delta: 1 | -1) => {
    const panel = panelRef.current
    if (!panel) return
    const nodes = collectFocusableElements(panel)
    if (nodes.length === 0) return
    const active = document.activeElement as HTMLElement | null
    const raw = nodes.findIndex((n) => n === active)
    const current = raw >= 0 ? raw : 0
    const nextIdx = nextFocusIndex(current, delta, nodes.length)
    nodes[nextIdx]?.focus()
  }, [])

  function onPanelKeyDown(e: React.KeyboardEvent<HTMLElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      moveFocusByArrow(1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      moveFocusByArrow(-1)
    }
  }

  function onTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX
  }

  function onTouchEnd(e: React.TouchEvent) {
    if (touchStartX.current == null) return
    const endX = e.changedTouches[0].clientX
    const deltaX = endX - touchStartX.current
    touchStartX.current = null
    if (shouldCloseMenuOnHorizontalSwipe(deltaX)) {
      close()
    }
  }

  const transitionClass = reducedMotion ? 'duration-0' : 'duration-200 ease-out'

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 md:hidden',
        transitionClass,
        open ? 'pointer-events-auto' : 'pointer-events-none',
      )}
      aria-hidden={!open}
      // When closed, remove drawer from tab order and block interaction (iOS/Android + desktop).
      inert={!open}
    >
      <div
        ref={backdropRef}
        className={cn(
          'absolute inset-0 bg-black/50 transition-opacity motion-reduce:transition-none',
          transitionClass,
          open ? 'opacity-100' : 'opacity-0',
        )}
        onClick={close}
        aria-hidden
      />

      <nav
        ref={panelRef}
        id={MOBILE_NAV_PANEL_ID}
        role="dialog"
        aria-modal="true"
        aria-label="Main navigation"
        tabIndex={-1}
        onKeyDown={onPanelKeyDown}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        className={cn(
          'absolute top-0 right-0 flex h-full w-[min(100vw-1rem,20rem)] flex-col border-l border-border bg-background shadow-xl transition-transform motion-reduce:transition-none',
          transitionClass,
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <div className="flex h-14 min-h-[44px] shrink-0 items-center justify-between border-b border-border px-2">
          <span className="px-2 text-sm font-semibold text-foreground">Menu</span>
          <button
            type="button"
            onClick={close}
            className={cn(
              'inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-foreground',
              'hover:bg-secondary active:bg-secondary/80',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            )}
            aria-label="Close menu"
          >
            <X className="h-6 w-6" aria-hidden />
          </button>
        </div>

        <div className="flex flex-1 flex-col overflow-y-auto overscroll-contain py-2">
          <Link
            href="/"
            onClick={close}
            className={navLinkClass}
          >
            Home
          </Link>

          <Collapsible
            open={browseOpen}
            onOpenChange={setBrowseOpen}
            className="border-b border-border py-1"
          >
            <CollapsibleTrigger
              className={cn(
                navLinkClass,
                'w-full justify-between gap-2 border-0 bg-transparent text-left [&[data-state=open]>svg]:rotate-180',
              )}
              id={`${MOBILE_NAV_PANEL_ID}-browse-trigger-${subMenuSuffix}`}
              aria-controls={`${MOBILE_NAV_PANEL_ID}-browse-${subMenuSuffix}`}
            >
              Browse
              <ChevronDown
                className={cn(
                  'h-5 w-5 shrink-0 transition-transform motion-reduce:transition-none',
                  reducedMotion ? '' : 'duration-200',
                )}
                aria-hidden
              />
            </CollapsibleTrigger>
            <CollapsibleContent
              id={`${MOBILE_NAV_PANEL_ID}-browse-${subMenuSuffix}`}
              role="region"
              aria-labelledby={`${MOBILE_NAV_PANEL_ID}-browse-trigger-${subMenuSuffix}`}
              className="border-t border-border/60 bg-muted/20 data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down overflow-hidden motion-reduce:animate-none"
            >
              <Link href="/creators" onClick={close} className={subLinkClass}>
                Creators
              </Link>
              <Link href="/freelancers" onClick={close} className={subLinkClass}>
                Hire
              </Link>
              <Link href="/bounties" onClick={close} className={subLinkClass}>
                Bounties
              </Link>
            </CollapsibleContent>
          </Collapsible>

          <Link href="/about" onClick={close} className={navLinkClass}>
            About
          </Link>

          {themeToggleSlot ? (
            <div className="flex min-h-11 items-center gap-2 border-t border-border px-4 py-2">
              <span className="text-sm text-muted-foreground">Appearance</span>
              <div className="ml-auto flex min-h-11 min-w-11 items-center justify-center">
                {themeToggleSlot}
              </div>
            </div>
          ) : null}

          <div className="mt-auto border-t border-border pt-2">
            {session ? (
              <>
                <Link href="/dashboard" onClick={close} className={navLinkClass}>
                  <LayoutDashboard className="mr-2 h-5 w-5 shrink-0" aria-hidden />
                  Dashboard
                </Link>
                <Link href="/matches" onClick={close} className={navLinkClass}>
                  <Sparkles className="mr-2 h-5 w-5 shrink-0 text-primary" aria-hidden />
                  Matches
                </Link>
                <Link href="/dashboard" onClick={close} className={navLinkClass}>
                  <User className="mr-2 h-5 w-5 shrink-0" aria-hidden />
                  Profile
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    close()
                    void onSignOut()
                  }}
                  className={cn(navLinkClass, 'w-full text-destructive hover:text-destructive')}
                >
                  <LogOut className="mr-2 h-5 w-5 shrink-0" aria-hidden />
                  Log out
                </button>
              </>
            ) : (
              <>
                <Link href="/auth/login" onClick={close} className={navLinkClass}>
                  Sign in
                </Link>
                <Link href="/auth/register" onClick={close} className={navLinkClass}>
                  Sign up
                </Link>
              </>
            )}
          </div>
        </div>
      </nav>
    </div>
  )
}

const navLinkClass = cn(
  'flex min-h-11 items-center px-4 py-2 text-base font-medium text-foreground',
  'hover:bg-secondary/80 active:bg-secondary',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
)

const subLinkClass = cn(
  'flex min-h-11 items-center py-2 pl-8 pr-4 text-base text-foreground',
  'hover:bg-secondary/80 active:bg-secondary',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
)
