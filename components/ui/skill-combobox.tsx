'use client';

import { useCallback, useEffect, useRef, useState, useId } from 'react';
import { getSkillById, resolveSkillId, searchSkills, type SkillNode } from '@/lib/skills-taxonomy';

interface SkillComboboxProps {
  value: string[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
  maxItems?: number;
}

export function SkillCombobox({
  value,
  onChange,
  placeholder = 'Search skills…',
  maxItems = 10,
}: SkillComboboxProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SkillNode[]>([]);
  const [open, setOpen] = useState(false);
  const listboxId = useId();
  const [highlightIndex, setHighlightIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (query.trim()) {
        const hits = searchSkills(query, 8).filter((s) => !value.includes(s.id));
        setResults(hits);
        setOpen(hits.length > 0);
        setHighlightIndex(0);
      } else {
        setResults([]);
        setOpen(false);
      }
    }, 150);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, value]);

  const addSkill = useCallback(
    (id: string) => {
      if (value.length >= maxItems) return;
      if (!value.includes(id)) onChange([...value, id]);
      setQuery('');
      setResults([]);
      setOpen(false);
      inputRef.current?.focus();
    },
    [value, onChange, maxItems],
  );

  const removeSkill = useCallback(
    (id: string) => onChange(value.filter((v) => v !== id)),
    [value, onChange],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && results[highlightIndex]) {
        addSkill(results[highlightIndex].id);
      } else if (query.trim()) {
        // Free-text fallback — try to resolve canonical, else add as custom
        const resolved = resolveSkillId(query.trim());
        if (resolved && !value.includes(resolved)) {
          addSkill(resolved);
        } else {
          const customId = `custom:${query.trim()}`;
          if (!value.includes(customId)) addSkill(customId);
        }
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    } else if (e.key === 'Backspace' && query === '' && value.length > 0) {
      removeSkill(value[value.length - 1]);
    }
  };

  const chipLabel = (id: string): string => {
    if (id.startsWith('custom:')) return id.slice(7);
    return getSkillById(id)?.name ?? id;
  };

  const isCustom = (id: string) => id.startsWith('custom:');

  return (
    <div className="relative w-full">
      {/* Selected chips */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {value.map((id) => (
            <span
              key={id}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-accent/15 text-accent border border-accent/30"
            >
              {isCustom(id) && (
                <span title="Not in taxonomy — will be flagged for moderation" className="text-yellow-400">
                  ⚠
                </span>
              )}
              {chipLabel(id)}
              <button
                type="button"
                aria-label={`Remove ${chipLabel(id)}`}
                onClick={() => removeSkill(id)}
                className="ml-0.5 text-accent/60 hover:text-accent transition-colors leading-none"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Input */}
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => query.trim() && results.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={value.length >= maxItems ? `Max ${maxItems} skills` : placeholder}
        disabled={value.length >= maxItems}
        className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent/50 disabled:opacity-50 disabled:cursor-not-allowed"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open && results.length > 0}
        aria-controls={listboxId}
        aria-activedescendant={
          open && results[highlightIndex] ? `${listboxId}-option-${highlightIndex}` : undefined
        }
      />

      {/* Dropdown */}
      {open && results.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-50 mt-1 w-full rounded-md border border-border bg-card shadow-lg max-h-56 overflow-y-auto"
        >
          {results.map((skill, idx) => (
            <li
              key={skill.id}
              id={`${listboxId}-option-${idx}`}
              role="option"
              aria-selected={idx === highlightIndex}
              onMouseDown={() => addSkill(skill.id)}
              onMouseEnter={() => setHighlightIndex(idx)}
              className={`flex items-center justify-between px-3 py-2 text-sm cursor-pointer transition-colors ${
                idx === highlightIndex
                  ? 'bg-accent/10 text-foreground'
                  : 'text-muted-foreground hover:bg-muted/50'
              }`}
            >
              <span className="font-medium text-foreground">{skill.name}</span>
              <span className="text-xs text-muted-foreground ml-2">{skill.category}</span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-1 text-xs text-muted-foreground">
        Press Enter to add a custom skill if not found in suggestions.
      </p>
    </div>
  );
}
