'use client';

import { useState, useCallback, useEffect } from 'react';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface SearchBarProps {
  placeholder?: string;
  onSearch: (query: string) => void;
  onSearchChange?: (query: string) => void;
  debounceMs?: number;
  initialValue?: string;
  showSuggestions?: boolean;
}

export function SearchBar({
  placeholder = 'Search creators, bounties, or projects...',
  onSearch,
  onSearchChange,
  debounceMs = 300,
  initialValue = '',
  showSuggestions = false,
}: SearchBarProps) {
  const [query, setQuery] = useState(initialValue);
  const [isFocused, setIsFocused] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (query) {
        onSearchChange?.(query);
        
        // Fetch suggestions if enabled
        if (showSuggestions) {
          fetchSuggestions(query);
        }
      } else {
        setSuggestions([]);
      }
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [query, debounceMs, onSearchChange, showSuggestions]);

  const fetchSuggestions = useCallback(async (searchQuery: string) => {
    try {
      setIsLoading(true);
      // This would call your API endpoint for suggestions
      // const res = await fetch(`/api/search/suggestions?q=${searchQuery}`);
      // const data = await res.json();
      // setSuggestions(data);
    } catch (error) {
      console.error('Error fetching suggestions:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch(query);
  };

  const handleClear = () => {
    setQuery('');
    setSuggestions([]);
    onSearch('');
  };

  const handleSuggestionClick = (suggestion: string) => {
    setQuery(suggestion);
    setSuggestions([]);
    onSearch(suggestion);
  };

  return (
    <div className="relative w-full">
      <form onSubmit={handleSearch} className="relative">
        <div className="relative flex items-center">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground pointer-events-none" size={18} />
          
          <Input
            type="text"
            placeholder={placeholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setTimeout(() => setIsFocused(false), 200)}
            className="pl-10 pr-10"
          />

          {query && (
            <button
              type="button"
              onClick={handleClear}
              className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Clear search"
            >
              <X size={18} />
            </button>
          )}
        </div>
      </form>

      {/* Suggestions dropdown */}
      {isFocused && suggestions.length > 0 && (
        <div className="absolute top-full left-0 right-0 bg-card border border-border rounded-lg mt-2 shadow-lg z-50">
          {suggestions.map((suggestion, index) => (
            <button
              key={index}
              onClick={() => handleSuggestionClick(suggestion)}
              className="w-full text-left px-4 py-2 hover:bg-muted transition-colors first:rounded-t-lg last:rounded-b-lg"
            >
              <div className="flex items-center gap-2">
                <Search size={14} className="text-muted-foreground" />
                <span className="text-sm">{suggestion}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {isFocused && isLoading && (
        <div className="absolute top-full left-0 right-0 bg-card border border-border rounded-lg mt-2 shadow-lg z-50">
          <div className="px-4 py-2 text-sm text-muted-foreground text-center">
            Loading suggestions...
          </div>
        </div>
      )}
    </div>
  );
}
