'use client'

import * as React from 'react'
import { Check, Loader2, Wallet } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type ConnectWalletButtonProps = Omit<React.ComponentProps<typeof Button>, 'onClick'> & {
  account?: string | null
  isLoading?: boolean
  onConnect?: () => void | Promise<void>
  connectLabel?: string
  loadingLabel?: string
  connectedLabel?: string
}

function formatAccount(account: string) {
  if (account.length <= 12) {
    return account
  }

  return `${account.slice(0, 6)}...${account.slice(-4)}`
}

function ConnectWalletButton({
  account,
  isLoading = false,
  onConnect,
  connectLabel = 'Connect Wallet',
  loadingLabel = 'Connecting',
  connectedLabel,
  className,
  disabled,
  variant,
  type = 'button',
  ...props
}: ConnectWalletButtonProps) {
  const isConnected = Boolean(account)
  const label = isLoading
    ? loadingLabel
    : connectedLabel ?? (account ? formatAccount(account) : connectLabel)
  const Icon = isLoading ? Loader2 : isConnected ? Check : Wallet

  return (
    <Button
      type={type}
      variant={variant ?? (isConnected ? 'secondary' : 'default')}
      className={cn('min-w-36', className)}
      disabled={disabled || isLoading}
      aria-busy={isLoading}
      aria-label={label}
      onClick={onConnect}
      {...props}
    >
      <Icon className={cn('size-4', isLoading && 'animate-spin')} aria-hidden="true" />
      <span>{label}</span>
    </Button>
  )
}

export { ConnectWalletButton, formatAccount }
export type { ConnectWalletButtonProps }
