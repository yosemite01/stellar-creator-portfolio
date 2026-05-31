/**
 * useChatTranslation — Issue #617
 * Hook for real-time per-message translation with locale switching.
 */

import { useCallback, useState } from 'react';
import { AppLocale } from '../i18n';
import { ChatTranslationService } from '../services/ChatTranslationService';

export interface MessageTranslation {
  translatedText: string;
  isLoading: boolean;
  error: string | null;
  isVisible: boolean;
}

export function useChatTranslation(targetLocale: AppLocale) {
  const [translations, setTranslations] = useState<Record<string, MessageTranslation>>({});

  const toggleTranslation = useCallback(
    async (messageId: string, originalText: string, sourceLocale: AppLocale = 'en') => {
      const current = translations[messageId];

      // If already visible, hide it
      if (current?.isVisible) {
        setTranslations((prev) => ({
          ...prev,
          [messageId]: { ...prev[messageId], isVisible: false },
        }));
        return;
      }

      // If already translated (cached), just show it
      if (current?.translatedText && !current.error) {
        setTranslations((prev) => ({
          ...prev,
          [messageId]: { ...prev[messageId], isVisible: true },
        }));
        return;
      }

      // Start loading
      setTranslations((prev) => ({
        ...prev,
        [messageId]: { translatedText: '', isLoading: true, error: null, isVisible: true },
      }));

      try {
        const result = await ChatTranslationService.translate(
          originalText,
          targetLocale,
          sourceLocale,
        );
        setTranslations((prev) => ({
          ...prev,
          [messageId]: {
            translatedText: result.translatedText,
            isLoading: false,
            error: null,
            isVisible: true,
          },
        }));
      } catch {
        setTranslations((prev) => ({
          ...prev,
          [messageId]: {
            translatedText: '',
            isLoading: false,
            error: 'Translation failed',
            isVisible: true,
          },
        }));
      }
    },
    [targetLocale, translations],
  );

  const clearTranslations = useCallback(() => {
    setTranslations({});
  }, []);

  return { translations, toggleTranslation, clearTranslations };
}
