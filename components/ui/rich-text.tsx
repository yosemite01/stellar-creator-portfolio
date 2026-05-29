'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import DOMPurify from 'isomorphic-dompurify';

interface RichTextEditorProps {
  value?: string;
  onChange?: (html: string) => void;
  placeholder?: string;
  className?: string;
}

export function RichTextEditor({ value = '', onChange, placeholder = 'Write project details...', className }: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } }),
      Placeholder.configure({ placeholder }),
    ],
    content: value,
    onUpdate({ editor }) {
      const html = DOMPurify.sanitize(editor.getHTML());
      onChange?.(html);
    },
    editorProps: {
      attributes: {
        class: 'prose prose-sm dark:prose-invert max-w-none min-h-[160px] px-3 py-2 focus:outline-none',
      },
    },
  });

  if (!editor) return null;

  const btn = (action: () => boolean, label: string, active?: boolean) => (
    <button
      type="button"
      onMouseDown={(e) => { e.preventDefault(); action(); }}
      aria-label={label}
      className={`px-2 py-1 text-xs rounded hover:bg-muted transition-colors ${active ? 'bg-muted font-bold' : ''}`}
    >
      {label}
    </button>
  );

  return (
    <div className={`border border-input rounded-md bg-background overflow-hidden ${className ?? ''}`}>
      {/* Toolbar */}
      <div className="flex flex-wrap gap-1 border-b border-input px-2 py-1.5 bg-muted/30">
        {btn(() => editor.chain().focus().toggleBold().run(), 'B', editor.isActive('bold'))}
        {btn(() => editor.chain().focus().toggleItalic().run(), 'I', editor.isActive('italic'))}
        {btn(() => editor.chain().focus().toggleStrike().run(), 'S̶', editor.isActive('strike'))}
        <span className="w-px bg-border mx-1" />
        {btn(() => editor.chain().focus().toggleHeading({ level: 2 }).run(), 'H2', editor.isActive('heading', { level: 2 }))}
        {btn(() => editor.chain().focus().toggleHeading({ level: 3 }).run(), 'H3', editor.isActive('heading', { level: 3 }))}
        <span className="w-px bg-border mx-1" />
        {btn(() => editor.chain().focus().toggleBulletList().run(), '• List', editor.isActive('bulletList'))}
        {btn(() => editor.chain().focus().toggleOrderedList().run(), '1. List', editor.isActive('orderedList'))}
        <span className="w-px bg-border mx-1" />
        {btn(() => editor.chain().focus().toggleBlockquote().run(), '❝', editor.isActive('blockquote'))}
        {btn(() => editor.chain().focus().toggleCodeBlock().run(), '</>', editor.isActive('codeBlock'))}
        <span className="w-px bg-border mx-1" />
        <button
          type="button"
          aria-label="Insert link"
          onMouseDown={(e) => {
            e.preventDefault();
            const url = window.prompt('Enter URL');
            if (url) editor.chain().focus().setLink({ href: url }).run();
          }}
          className={`px-2 py-1 text-xs rounded hover:bg-muted transition-colors ${editor.isActive('link') ? 'bg-muted font-bold' : ''}`}
        >
          🔗
        </button>
        <button
          type="button"
          aria-label="Insert YouTube/Loom embed"
          onMouseDown={(e) => {
            e.preventDefault();
            const url = window.prompt('Enter YouTube or Loom URL');
            if (!url) return;
            const isYoutube = /youtube\.com|youtu\.be/.test(url);
            const isLoom = /loom\.com/.test(url);
            if (!isYoutube && !isLoom) { alert('Only YouTube and Loom URLs are supported.'); return; }
            let embedUrl = url;
            if (isYoutube) {
              const id = url.match(/(?:v=|youtu\.be\/)([^&?/]+)/)?.[1];
              if (id) embedUrl = `https://www.youtube.com/embed/${id}`;
            } else if (isLoom) {
              embedUrl = url.replace('loom.com/share/', 'loom.com/embed/');
            }
            editor.chain().focus().insertContent(
              `<div class="video-embed"><iframe src="${embedUrl}" allowfullscreen frameborder="0" class="w-full aspect-video rounded"></iframe></div>`
            ).run();
          }}
          className="px-2 py-1 text-xs rounded hover:bg-muted transition-colors"
        >
          ▶ Embed
        </button>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}

/** Read-only renderer for sanitized HTML stored from the editor */
export function RichTextContent({ html, className }: { html: string; className?: string }) {
  const clean = DOMPurify.sanitize(html);
  return (
    <div
      className={`prose prose-sm dark:prose-invert max-w-none ${className ?? ''}`}
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}
