import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MobileNav, MOBILE_NAV_PANEL_ID } from '@/components/layout/mobile-nav'

vi.mock('next/link', () => ({
  default ({
    children,
    href,
    ...rest
  }: { children: React.ReactNode; href: string }) {
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    )
  },
}))

function setup() {
  const menuButtonRef = React.createRef<HTMLButtonElement>()
  const onOpenChange = vi.fn()
  return { menuButtonRef, onOpenChange }
}

describe('MobileNav', () => {
  it('renders dialog with stable id for aria-controls', () => {
    const { menuButtonRef, onOpenChange } = setup()
    render(
      <MobileNav
        open
        onOpenChange={onOpenChange}
        menuButtonRef={menuButtonRef}
        session={null}
        onSignOut={vi.fn()}
      />,
    )
    const dialog = screen.getByRole('dialog', { name: /main navigation/i })
    expect(dialog).toHaveAttribute('id', MOBILE_NAV_PANEL_ID)
  })

  it('invokes onOpenChange(false) on Escape', () => {
    const { menuButtonRef, onOpenChange } = setup()
    render(
      <MobileNav
        open
        onOpenChange={onOpenChange}
        menuButtonRef={menuButtonRef}
        session={null}
        onSignOut={vi.fn()}
      />,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('toggles Browse submenu and exposes nested links', async () => {
    const { menuButtonRef, onOpenChange } = setup()
    render(
      <MobileNav
        open
        onOpenChange={onOpenChange}
        menuButtonRef={menuButtonRef}
        session={null}
        onSignOut={vi.fn()}
      />,
    )
    const browse = screen.getByRole('button', { name: /^browse$/i })
    fireEvent.click(browse)
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /creators/i })).toBeInTheDocument()
    })
  })

  it('applies minimum touch target classes to primary controls', () => {
    const { menuButtonRef, onOpenChange } = setup()
    render(
      <MobileNav
        open
        onOpenChange={onOpenChange}
        menuButtonRef={menuButtonRef}
        session={null}
        onSignOut={vi.fn()}
      />,
    )
    const closeBtn = screen.getByRole('button', { name: /close menu/i })
    expect(closeBtn.className).toMatch(/min-h-11/)
    expect(closeBtn.className).toMatch(/min-w-11/)
  })
})
