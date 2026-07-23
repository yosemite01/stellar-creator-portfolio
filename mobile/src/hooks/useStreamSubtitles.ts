/**
 * useStreamSubtitles — Issue #780
 * Hook for managing live stream speech-to-text subtitles with CC toggle
 */

import { useCallback, useState, useRef, useEffect } from 'react';
import {
  startSession,
  stopSession,
  appendCue,
  SubtitleSession,
  createSubtitleSession,
} from '@/mobile/src/subtitling/SpeechSubtitler';
import { useChatTranslation } from './useChatTranslation';
import type { AppLocale } from '@/mobile/src/i18n';

export interface StreamSubtitle {
  id: string;
  text: string;
  startTime: number;
  isPartial: boolean;
}

/**
 * Manage live stream subtitles with auto-translation
 * Processes audio chunks and displays live transcription
 */
export function useStreamSubtitles(language: AppLocale = 'en') {
  const [ccEnabled, setCCEnabled] = useState(false);
  const [currentSubtitle, setCurrentSubtitle] = useState<StreamSubtitle | null>(null);
  const [subtitleHistory, setSubtitleHistory] = useState<StreamSubtitle[]>([]);
  const sessionRef = useRef<SubtitleSession>(createSubtitleSession());
  const chunkTimerRef = useRef<NodeJS.Timeout | null>(null);
  const chunkBufferRef = useRef<string[]>([]);
  const startTimeRef = useRef<number>(0);

  const { translations, toggleTranslation } = useChatTranslation(language);

  /**
   * Start subtitle capture session
   */
  const startSubtitles = useCallback(() => {
    sessionRef.current = startSession(createSubtitleSession());
    startTimeRef.current = Date.now() / 1000;
    setCurrentSubtitle(null);
    setSubtitleHistory([]);
  }, []);

  /**
   * Stop subtitle capture session
   */
  const stopSubtitles = useCallback(() => {
    if (chunkTimerRef.current) {
      clearTimeout(chunkTimerRef.current);
    }
    sessionRef.current = stopSession(sessionRef.current);
  }, []);

  /**
   * Process audio chunk for transcription
   * Accumulates chunks and processes every ~3 seconds
   */
  const processAudioChunk = useCallback((transcribedText: string, isPartial: boolean) => {
    chunkBufferRef.current.push(transcribedText);

    if (chunkTimerRef.current) {
      clearTimeout(chunkTimerRef.current);
    }

    // Wait for more input or timeout after 3 seconds
    chunkTimerRef.current = setTimeout(() => {
      const fullText = chunkBufferRef.current.join(' ').trim();
      if (fullText.length > 0) {
        const now = Date.now() / 1000;
        const startTime = Math.max(startTimeRef.current, now - 3);
        const endTime = now;

        const subtitle: StreamSubtitle = {
          id: `sub_${Date.now()}`,
          text: fullText,
          startTime,
          isPartial: false,
        };

        // Add to session for export
        sessionRef.current = appendCue(
          sessionRef.current,
          fullText,
          startTime,
          endTime,
        );

        // Update UI
        setCurrentSubtitle(subtitle);
        setSubtitleHistory((prev) => [...prev, subtitle]);
      }

      chunkBufferRef.current = [];
      startTimeRef.current = now;
    }, 3000);

    // Show partial transcription in real-time if not final
    if (isPartial) {
      setCurrentSubtitle({
        id: 'partial',
        text: transcribedText,
        startTime: startTimeRef.current,
        isPartial: true,
      });
    }
  }, []);

  /**
   * Translate subtitle and toggle visibility
   */
  const translateSubtitle = useCallback(
    (subtitleId: string, text: string) => {
      toggleTranslation(subtitleId, text, language);
    },
    [language, toggleTranslation],
  );

  /**
   * Get translated text if available
   */
  const getTranslatedText = useCallback(
    (subtitleId: string): string | null => {
      const translation = translations[subtitleId];
      if (translation?.isVisible && translation?.translatedText) {
        return translation.translatedText;
      }
      return null;
    },
    [translations],
  );

  return {
    // State
    ccEnabled,
    currentSubtitle,
    subtitleHistory,

    // Controls
    setCCEnabled,
    startSubtitles,
    stopSubtitles,
    processAudioChunk,
    translateSubtitle,
    getTranslatedText,

    // Session data
    session: sessionRef.current,
  };
}
