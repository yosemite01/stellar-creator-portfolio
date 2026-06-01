/**
 * #602 — usePromptSuggestions hook
 *
 * Provides predictive text suggestions powered by the on-device SLM.
 * Debounces inference calls so typing doesn't saturate the CPU.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { PromptSuggestionEngine } from './prompt-suggestions'

const DEBOUNCE_MS = 300

export function usePromptSuggestions(partial: string, count = 3) {
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const run = useCallback(
    async (text: string) => {
      if (!text.trim()) {
        setSuggestions([])
        return
      }
      setLoading(true)
      try {
        const engine = await PromptSuggestionEngine.getInstance()
        const results = await engine.suggest(text, count)
        setSuggestions(results)
      } catch {
        setSuggestions([])
      } finally {
        setLoading(false)
      }
    },
    [count],
  )

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => run(partial), DEBOUNCE_MS)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [partial, run])

  return { suggestions, loading }
}
