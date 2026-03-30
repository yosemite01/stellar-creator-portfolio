'use client'

import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { Header } from '@/components/layout/header'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'

type Prefs = {
  emailBountyAlerts: boolean
  emailApplicationUpdates: boolean
  emailMessages: boolean
  emailMarketing: boolean
  inAppEnabled: boolean
}

const defaults: Prefs = {
  emailBountyAlerts: true,
  emailApplicationUpdates: true,
  emailMessages: true,
  emailMarketing: false,
  inAppEnabled: true,
}

export default function NotificationSettingsPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [prefs, setPrefs] = useState<Prefs>(defaults)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [unavailable, setUnavailable] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/notifications/preferences')
      if (res.status === 503) {
        setUnavailable(true)
        return
      }
      if (!res.ok) {
        setError('Could not load preferences')
        return
      }
      const data = await res.json()
      const p = data.preferences
      if (p) {
        setPrefs({
          emailBountyAlerts: p.emailBountyAlerts,
          emailApplicationUpdates: p.emailApplicationUpdates,
          emailMessages: p.emailMessages,
          emailMarketing: p.emailMarketing,
          inAppEnabled: p.inAppEnabled,
        })
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/auth/login')
  }, [status, router])

  useEffect(() => {
    if (status === 'authenticated') void load()
  }, [status, load])

  async function save(next: Partial<Prefs>) {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/notifications/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      })
      if (!res.ok) {
        setError('Save failed')
        return
      }
      const data = await res.json()
      const p = data.preferences
      if (p) {
        setPrefs({
          emailBountyAlerts: p.emailBountyAlerts,
          emailApplicationUpdates: p.emailApplicationUpdates,
          emailMessages: p.emailMessages,
          emailMarketing: p.emailMarketing,
          inAppEnabled: p.inAppEnabled,
        })
      }
    } finally {
      setSaving(false)
    }
  }

  function toggle<K extends keyof Prefs>(key: K, value: boolean) {
    const next = { ...prefs, [key]: value }
    setPrefs(next)
    void save({ [key]: value })
  }

  if (status === 'loading' || !session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="max-w-2xl mx-auto px-4 py-10">
        <h1 className="text-2xl font-semibold tracking-tight mb-2">Notifications</h1>
        <p className="text-muted-foreground text-sm mb-8">
          Choose how we reach you about bounties, applications, and messages.
        </p>

        {unavailable ? (
          <Card>
            <CardHeader>
              <CardTitle>Database not configured</CardTitle>
              <CardDescription>
                Notification preferences are stored when <code className="text-xs">DATABASE_URL</code> is set.
                Emails still send in development using your mail provider env vars.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Channels</CardTitle>
              <CardDescription>Transactional emails (login, password reset) are always sent.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              {loading ? (
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              ) : (
                <>
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <Label htmlFor="in-app">In-app notifications</Label>
                      <p className="text-xs text-muted-foreground mt-1">Bell icon and dashboard alerts.</p>
                    </div>
                    <Switch
                      id="in-app"
                      checked={prefs.inAppEnabled}
                      disabled={saving}
                      onCheckedChange={(v) => toggle('inAppEnabled', v)}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <Label htmlFor="email-bounty">Email: bounty activity</Label>
                      <p className="text-xs text-muted-foreground mt-1">New applications on your bounties.</p>
                    </div>
                    <Switch
                      id="email-bounty"
                      checked={prefs.emailBountyAlerts}
                      disabled={saving}
                      onCheckedChange={(v) => toggle('emailBountyAlerts', v)}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <Label htmlFor="email-app">Email: application updates</Label>
                      <p className="text-xs text-muted-foreground mt-1">Submission receipts and accept/reject.</p>
                    </div>
                    <Switch
                      id="email-app"
                      checked={prefs.emailApplicationUpdates}
                      disabled={saving}
                      onCheckedChange={(v) => toggle('emailApplicationUpdates', v)}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <Label htmlFor="email-msg">Email: messages</Label>
                      <p className="text-xs text-muted-foreground mt-1">When someone posts on a thread.</p>
                    </div>
                    <Switch
                      id="email-msg"
                      checked={prefs.emailMessages}
                      disabled={saving}
                      onCheckedChange={(v) => toggle('emailMessages', v)}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <Label htmlFor="email-mkt">Email: product updates</Label>
                      <p className="text-xs text-muted-foreground mt-1">Occasional news (off by default).</p>
                    </div>
                    <Switch
                      id="email-mkt"
                      checked={prefs.emailMarketing}
                      disabled={saving}
                      onCheckedChange={(v) => toggle('emailMarketing', v)}
                    />
                  </div>
                  <Button variant="outline" size="sm" asChild>
                    <a href="/api/notifications?emailHistory=1" target="_blank" rel="noreferrer">
                      View recent email log (JSON)
                    </a>
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  )
}
