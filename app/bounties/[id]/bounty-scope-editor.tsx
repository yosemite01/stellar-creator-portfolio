'use client'

/**
 * BountyScopeEditor
 *
 * Client wrapper that renders the CollaborativeEditor for a specific bounty's
 * project scope document. Each bounty gets its own Yjs document room keyed by
 * bountyId so clients and creators can co-edit the scope in real time.
 */

import dynamic from 'next/dynamic'
import { Users } from 'lucide-react'

// Dynamically import to avoid SSR issues with browser-only Yjs/WebSocket APIs
const CollaborativeEditor = dynamic(
  () => import('@/components/collaborative-editor').then((m) => m.CollaborativeEditor),
  { ssr: false, loading: () => <EditorSkeleton /> },
)

interface Props {
  bountyId: string
  initialDeliverables: string
}

export function BountyScopeEditor({ bountyId, initialDeliverables }: Props) {
  return (
    <section aria-labelledby="scope-heading">
      <div className="flex items-center gap-2 mb-3">
        <h2 id="scope-heading" className="text-lg font-semibold">
          Project Scope
        </h2>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Users className="h-3.5 w-3.5" />
          Live collaborative editing
        </span>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        Edit the project scope below. Changes sync in real time for all
        collaborators — no refresh needed.
      </p>
      <CollaborativeEditor
        docId={`bounty-scope-${bountyId}`}
        initialContent={`<p>${initialDeliverables}</p>`}
        className="min-h-[300px]"
      />
    </section>
  )
}

function EditorSkeleton() {
  return (
    <div className="rounded-md border border-border bg-muted/30 min-h-[300px] animate-pulse" />
  )
}
