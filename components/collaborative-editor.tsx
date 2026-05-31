'use client'

/**
 * CollaborativeEditor
 *
 * Real-time collaborative markdown editor backed by Yjs CRDTs.
 * - Syncs document state via y-websocket
 * - Shows live multi-colored presence cursors for each connected user
 * - Renders a full TipTap rich-text editor with starter-kit formatting
 */

import { useEffect, useMemo, useRef } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCursor from '@tiptap/extension-collaboration-cursor'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'

// ── Presence colours ──────────────────────────────────────────────────────────
const CURSOR_COLORS = [
  '#f97316', '#8b5cf6', '#06b6d4', '#10b981',
  '#f43f5e', '#eab308', '#3b82f6', '#ec4899',
]

function randomColor() {
  return CURSOR_COLORS[Math.floor(Math.random() * CURSOR_COLORS.length)]
}

function randomName() {
  const adjectives = ['Swift', 'Bright', 'Bold', 'Calm', 'Keen']
  const nouns = ['Creator', 'Builder', 'Maker', 'Thinker', 'Doer']
  return `${adjectives[Math.floor(Math.random() * adjectives.length)]} ${nouns[Math.floor(Math.random() * nouns.length)]}`
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface CollaborativeEditorProps {
  /** Unique document identifier (e.g. bounty ID) */
  docId: string
  /** WebSocket server URL (defaults to env var or localhost:1234) */
  wsUrl?: string
  /** Initial content (only applied when the doc is empty) */
  initialContent?: string
  /** Called whenever the document content changes */
  onChange?: (html: string) => void
  /** Whether the editor is read-only */
  readOnly?: boolean
  className?: string
}

// ── Component ─────────────────────────────────────────────────────────────────
export function CollaborativeEditor({
  docId,
  wsUrl,
  initialContent,
  onChange,
  readOnly = false,
  className = '',
}: CollaborativeEditorProps) {
  const serverUrl =
    wsUrl ??
    process.env.NEXT_PUBLIC_COLLAB_WS_URL ??
    'ws://localhost:1234'

  // Stable user identity for this session
  const user = useMemo(
    () => ({ name: randomName(), color: randomColor() }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  // Yjs document & provider – created once per docId
  const ydocRef = useRef<Y.Doc | null>(null)
  const providerRef = useRef<WebsocketProvider | null>(null)

  if (!ydocRef.current) {
    ydocRef.current = new Y.Doc()
  }

  useEffect(() => {
    const ydoc = ydocRef.current!
    const provider = new WebsocketProvider(serverUrl, docId, ydoc)
    providerRef.current = provider

    // Broadcast our presence
    provider.awareness.setLocalStateField('user', user)

    return () => {
      provider.destroy()
      providerRef.current = null
    }
    // Re-connect only when docId or server changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, serverUrl])

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Disable built-in history – Yjs handles undo/redo
        history: false,
      }),
      Collaboration.configure({
        document: ydocRef.current,
      }),
      CollaborationCursor.configure({
        provider: providerRef.current!,
        user,
      }),
    ],
    content: initialContent ?? '',
    editable: !readOnly,
    onUpdate({ editor }) {
      onChange?.(editor.getHTML())
    },
  })

  // Keep CollaborationCursor provider in sync after mount
  useEffect(() => {
    if (!editor || !providerRef.current) return
    const cursorExt = editor.extensionManager.extensions.find(
      (e) => e.name === 'collaborationCursor',
    )
    if (cursorExt) {
      cursorExt.options.provider = providerRef.current
    }
  }, [editor])

  return (
    <div className={`collaborative-editor ${className}`}>
      {/* Cursor colour legend */}
      <style>{`
        /* Yjs collaboration cursor styles */
        .collaboration-cursor__caret {
          border-left: 2px solid;
          border-right: 2px solid;
          margin-left: -1px;
          margin-right: -1px;
          pointer-events: none;
          position: relative;
          word-break: normal;
        }
        .collaboration-cursor__label {
          border-radius: 3px 3px 3px 0;
          color: #fff;
          font-size: 11px;
          font-style: normal;
          font-weight: 600;
          left: -1px;
          line-height: normal;
          padding: 0.1rem 0.3rem;
          position: absolute;
          top: -1.4em;
          user-select: none;
          white-space: nowrap;
        }
        .collaborative-editor .ProseMirror {
          min-height: 200px;
          padding: 1rem;
          outline: none;
        }
        .collaborative-editor .ProseMirror p.is-editor-empty:first-child::before {
          color: #adb5bd;
          content: attr(data-placeholder);
          float: left;
          height: 0;
          pointer-events: none;
        }
      `}</style>

      <div className="rounded-md border border-border bg-background focus-within:ring-2 focus-within:ring-ring">
        {/* Toolbar */}
        {!readOnly && editor && (
          <div className="flex flex-wrap gap-1 border-b border-border p-2">
            <ToolbarButton
              onClick={() => editor.chain().focus().toggleBold().run()}
              active={editor.isActive('bold')}
              title="Bold"
            >
              <strong>B</strong>
            </ToolbarButton>
            <ToolbarButton
              onClick={() => editor.chain().focus().toggleItalic().run()}
              active={editor.isActive('italic')}
              title="Italic"
            >
              <em>I</em>
            </ToolbarButton>
            <ToolbarButton
              onClick={() => editor.chain().focus().toggleStrike().run()}
              active={editor.isActive('strike')}
              title="Strikethrough"
            >
              <s>S</s>
            </ToolbarButton>
            <div className="w-px bg-border mx-1" />
            <ToolbarButton
              onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
              active={editor.isActive('heading', { level: 2 })}
              title="Heading 2"
            >
              H2
            </ToolbarButton>
            <ToolbarButton
              onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
              active={editor.isActive('heading', { level: 3 })}
              title="Heading 3"
            >
              H3
            </ToolbarButton>
            <div className="w-px bg-border mx-1" />
            <ToolbarButton
              onClick={() => editor.chain().focus().toggleBulletList().run()}
              active={editor.isActive('bulletList')}
              title="Bullet list"
            >
              •—
            </ToolbarButton>
            <ToolbarButton
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
              active={editor.isActive('orderedList')}
              title="Ordered list"
            >
              1.
            </ToolbarButton>
            <ToolbarButton
              onClick={() => editor.chain().focus().toggleCodeBlock().run()}
              active={editor.isActive('codeBlock')}
              title="Code block"
            >
              {'</>'}
            </ToolbarButton>
            <div className="w-px bg-border mx-1" />
            <ToolbarButton
              onClick={() => editor.chain().focus().undo().run()}
              active={false}
              title="Undo"
            >
              ↩
            </ToolbarButton>
            <ToolbarButton
              onClick={() => editor.chain().focus().redo().run()}
              active={false}
              title="Redo"
            >
              ↪
            </ToolbarButton>
          </div>
        )}

        <EditorContent editor={editor} />
      </div>
    </div>
  )
}

// ── Toolbar button ─────────────────────────────────────────────────────────────
function ToolbarButton({
  onClick,
  active,
  title,
  children,
}: {
  onClick: () => void
  active: boolean
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={`rounded px-2 py-1 text-sm font-medium transition-colors
        ${active
          ? 'bg-primary text-primary-foreground'
          : 'hover:bg-muted text-foreground'
        }`}
    >
      {children}
    </button>
  )
}
