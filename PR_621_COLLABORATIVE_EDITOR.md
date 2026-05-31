# [Frontend] Implement Real-time Collaborative Markdown Editing via CRDTs

## Summary

Adds real-time collaborative editing to bounty project scope documents using **Yjs CRDTs** and **TipTap**. Clients and creators can now co-edit the same document simultaneously without conflicts — changes merge automatically via the CRDT algorithm.

## Changes

### New Files
| File | Description |
|------|-------------|
| `components/collaborative-editor.tsx` | Core TipTap editor with Yjs CRDT sync and multi-colored presence cursors |
| `app/bounties/[id]/page.tsx` | Bounty detail page showing meta info + collaborative scope editor |
| `app/bounties/[id]/bounty-scope-editor.tsx` | Client wrapper with dynamic import (SSR-safe) |
| `server/collab.ts` | Standalone Yjs WebSocket server (runs alongside Next.js) |
| `app/api/collab/route.ts` | Next.js API route placeholder for WebSocket upgrade |

### Modified Files
| File | Description |
|------|-------------|
| `package.json` | Added `yjs`, `y-websocket`, `@tiptap/extension-collaboration`, `@tiptap/extension-collaboration-cursor` |
| `pnpm-lock.yaml` | Lockfile updated |

## Implementation Details

### CRDT Sync (Yjs)
- Each bounty gets its own Yjs document room keyed by `bounty-scope-{bountyId}`
- `WebsocketProvider` from `y-websocket` handles real-time sync and reconnection
- Document state is a shared `Y.Doc` — all edits are conflict-free by design

### Presence Cursors
- `@tiptap/extension-collaboration-cursor` renders each user's cursor with a unique colour and name label
- 8 distinct cursor colours assigned randomly per session
- User identity is ephemeral (session-scoped) — no auth required for presence

### WebSocket Server
- `server/collab.ts` is a standalone Node.js WebSocket server using `y-websocket/bin/utils.js`
- Runs on `WS_PORT` (default `1234`) alongside the Next.js dev server
- Configure the client URL via `NEXT_PUBLIC_COLLAB_WS_URL` env var

### SSR Safety
- `CollaborativeEditor` is dynamically imported with `ssr: false` to prevent hydration issues with browser-only Yjs/WebSocket APIs

## How to Run

```bash
# Terminal 1 – Next.js dev server
pnpm dev

# Terminal 2 – Yjs WebSocket collaboration server
node --input-type=module < server/collab.ts
# or compile first: npx tsc server/collab.ts --outDir dist && node dist/collab.js
```

Set `NEXT_PUBLIC_COLLAB_WS_URL=ws://localhost:1234` in `.env.local` (defaults to this value).

## Testing

1. Open `http://localhost:3000/bounties/bounty-1` in two browser tabs
2. Type in one tab — changes appear instantly in the other
3. Each tab shows a coloured cursor label for the other user

## Screenshots

> Bounty detail page with collaborative scope editor and live presence cursors.

---

closes #621
