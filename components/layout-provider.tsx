'use client'

import * as React from 'react'

// ── Loading event bus ─────────────────────────────────────────────────────────

type LoadingListener = (active: boolean) => void
const listeners = new Set<LoadingListener>()
let activeRequests = 0

export function notifyLoadingChange(delta: 1 | -1) {
  activeRequests = Math.max(0, activeRequests + delta)
  const active = activeRequests > 0
  listeners.forEach((fn) => fn(active))
}

// ── Context ───────────────────────────────────────────────────────────────────

const LoadingContext = React.createContext(false)
export const useGlobalLoading = () => React.useContext(LoadingContext)

// ── Progress bar ──────────────────────────────────────────────────────────────

function ProgressBar({ active }: { active: boolean }) {
  const [width, setWidth] = React.useState(0)
  const [visible, setVisible] = React.useState(false)
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(() => {
    if (active) {
      setVisible(true)
      setWidth(30)
      timerRef.current = setTimeout(() => setWidth(70), 200)
    } else {
      setWidth(100)
      timerRef.current = setTimeout(() => {
        setVisible(false)
        setWidth(0)
      }, 300)
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [active])

  if (!visible) return null

  return (
    <div
      role="progressbar"
      aria-label="Loading"
      aria-valuenow={width}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        height: 3,
        width: `${width}%`,
        transition: 'width 0.3s ease, opacity 0.3s ease',
        opacity: active ? 1 : 0,
        zIndex: 9999,
        background: 'var(--color-primary, #6366f1)',
        borderRadius: '0 2px 2px 0',
      }}
    />
  )
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function LayoutProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = React.useState(false)

  React.useEffect(() => {
    listeners.add(setLoading)
    return () => { listeners.delete(setLoading) }
  }, [])

  return (
    <LoadingContext.Provider value={loading}>
      <ProgressBar active={loading} />
      {children}
    </LoadingContext.Provider>
  )
}
