'use client';

/**
 * SemanticSearchBar
 *
 * Visually dynamic search bar that queries vector embeddings and renders
 * fuzzy-matched results with tag-based filtering.
 *
 * Features:
 *  - Debounced input → vector search API call.
 *  - Animated loading indicator while embedding is computed.
 *  - Fuzzy-matched result list with highlighted matched tags.
 *  - Dynamic tag chips for high-dimension filtering.
 */

import React, { useState, useCallback, useTransition, useRef } from 'react';
import { Search, Loader2, X, Tag } from 'lucide-react';
import { vectorSearch, filterByTags, VectorSearchResult } from '@/lib/search/vectorSearch';
import { cn } from '@/lib/utils';

interface SemanticSearchBarProps {
  onSelect?: (result: VectorSearchResult) => void;
  placeholder?: string;
  className?: string;
}

const DEBOUNCE_MS = 350;

const SUGGESTED_TAGS = [
  'UI/UX Design', 'Brand Strategy', 'Content Writing',
  'Marketing', 'Product Management', 'Data Analysis',
];

export function SemanticSearchBar({
  onSelect,
  placeholder = 'Search creators by skill, style, or intent…',
  className,
}: SemanticSearchBarProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<VectorSearchResult[]>([]);
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(
    (q: string, tags: string[]) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (!q.trim()) {
        setResults([]);
        setOpen(false);
        return;
      }
      debounceRef.current = setTimeout(() => {
        startTransition(async () => {
          try {
            const raw = await vectorSearch(q, { limit: 8, tags });
            setResults(filterByTags(raw, tags));
            setOpen(true);
          } catch {
            setResults([]);
          }
        });
      }, DEBOUNCE_MS);
    },
    [],
  );

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value;
    setQuery(q);
    search(q, activeTags);
  };

  const toggleTag = (tag: string) => {
    const next = activeTags.includes(tag)
      ? activeTags.filter((t) => t !== tag)
      : [...activeTags, tag];
    setActiveTags(next);
    search(query, next);
  };

  const clear = () => {
    setQuery('');
    setResults([]);
    setActiveTags([]);
    setOpen(false);
  };

  return (
    <div className={cn('relative w-full', className)}>
      {/* Input row */}
      <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-4 py-2 shadow-sm transition-shadow focus-within:shadow-md">
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : (
          <Search className="h-4 w-4 text-muted-foreground" />
        )}
        <input
          type="text"
          value={query}
          onChange={handleInput}
          onFocus={() => results.length && setOpen(true)}
          placeholder={placeholder}
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          aria-label="Semantic portfolio search"
          aria-autocomplete="list"
          aria-expanded={open}
        />
        {query && (
          <button onClick={clear} aria-label="Clear search">
            <X className="h-4 w-4 text-muted-foreground hover:text-foreground" />
          </button>
        )}
      </div>

      {/* Tag chips */}
      <div className="mt-2 flex flex-wrap gap-2">
        {SUGGESTED_TAGS.map((tag) => (
          <button
            key={tag}
            onClick={() => toggleTag(tag)}
            className={cn(
              'flex items-center gap-1 rounded-full border px-3 py-1 text-xs transition-colors',
              activeTags.includes(tag)
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-muted text-muted-foreground hover:border-primary hover:text-primary',
            )}
          >
            <Tag className="h-3 w-3" />
            {tag}
          </button>
        ))}
      </div>

      {/* Results dropdown */}
      {open && results.length > 0 && (
        <ul
          role="listbox"
          className="absolute z-50 mt-1 w-full rounded-xl border border-border bg-background shadow-lg"
        >
          {results.map((r) => (
            <li
              key={r.id}
              role="option"
              aria-selected={false}
              onClick={() => {
                onSelect?.(r);
                setOpen(false);
              }}
              className="flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-muted"
            >
              <div className="flex-1 min-w-0">
                <p className="truncate text-sm font-medium">{r.name}</p>
                <p className="truncate text-xs text-muted-foreground">{r.title}</p>
                {r.matchedTags.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {r.matchedTags.map((t) => (
                      <span
                        key={t}
                        className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">
                {Math.round(r.score * 100)}% match
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
