import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import {
  ConnectWalletButton,
  formatAccount,
} from '@/components/ui/connect-wallet-button'

describe('ConnectWalletButton', () => {
  it('renders idle state and calls connect handler', () => {
    const onConnect = vi.fn()

    render(<ConnectWalletButton onConnect={onConnect} />)
    fireEvent.click(screen.getByRole('button', { name: 'Connect Wallet' }))

    expect(onConnect).toHaveBeenCalledTimes(1)
  })

  it('renders loading state as disabled', () => {
    render(<ConnectWalletButton isLoading />)

    const button = screen.getByRole('button', { name: 'Connecting' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
  })

  it('renders connected account state', () => {
    render(<ConnectWalletButton account="GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890" />)

    expect(
      screen.getByRole('button', { name: 'GABCDE...7890' }),
    ).toBeInTheDocument()
  })

  it('formats long and short accounts', () => {
    expect(formatAccount('GSHORT')).toBe('GSHORT')
    expect(formatAccount('GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890')).toBe(
      'GABCDE...7890',
    )
  })
})
