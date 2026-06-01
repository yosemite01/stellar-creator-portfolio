/**
 * #602 — PromptSuggestionBar
 *
 * Renders a horizontal strip of on-device AI suggestions beneath any input.
 * Tap a chip to inject the full suggestion into the parent's onChange handler.
 */

import React from 'react'
import {
  View,
  ScrollView,
  TouchableOpacity,
  Text,
  ActivityIndicator,
  StyleSheet,
} from 'react-native'
import { usePromptSuggestions } from './usePromptSuggestions'

interface Props {
  /** Current value of the text input being assisted */
  value: string
  /** Called with the full injected suggestion text */
  onInject: (text: string) => void
}

export function PromptSuggestionBar({ value, onInject }: Props) {
  const { suggestions, loading } = usePromptSuggestions(value)

  if (!loading && suggestions.length === 0) return null

  return (
    <View style={styles.container} accessibilityRole="toolbar" accessibilityLabel="AI prompt suggestions">
      {loading ? (
        <ActivityIndicator size="small" color="#8b5cf6" style={styles.spinner} />
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {suggestions.map((s, i) => (
            <TouchableOpacity
              key={i}
              style={styles.chip}
              onPress={() => onInject(s)}
              accessibilityRole="button"
              accessibilityLabel={`Suggestion: ${s}`}
            >
              <Text style={styles.chipText} numberOfLines={1}>
                {s}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    height: 40,
    backgroundColor: '#1e1b4b',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#4c1d95',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  spinner: { alignSelf: 'center' },
  chip: {
    backgroundColor: '#4c1d95',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 8,
    maxWidth: 220,
  },
  chipText: {
    color: '#e9d5ff',
    fontSize: 13,
  },
})
