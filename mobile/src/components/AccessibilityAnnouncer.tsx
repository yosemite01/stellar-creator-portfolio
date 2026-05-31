import React, { useEffect, useRef } from 'react';
import {
  View,
  type ViewStyle,
  AccessibilityInfo,
} from 'react-native';

/**
 * Props for the AccessibilityAnnouncer component.
 */
export interface AccessibilityAnnouncerProps {
  /**
   * The message to announce to screen readers.
   * When this changes, the announcement will be made.
   */
  message: string;
  /**
   * The politeness level of the announcement.
   * Defaults to 'polite'.
   */
  importance?: 'auto' | 'assertive' | 'polite' | 'none';
}

/**
 * Component that announces messages to screen readers using a live region.
 * When the message prop changes, the screen reader will read the new message.
 */
export function AccessibilityAnnouncer({
  message,
  importance = 'polite',
}: AccessibilityAnnouncerProps) {
  const messageRef = useRef(message);

  useEffect(() => {
    if (messageRef.current !== message) {
      messageRef.current = message;
      // The live region will automatically announce when its children change
    }
  }, [message]);

  // We render a hidden live region that contains the message
  return (
    <View
      style={{
        position: 'absolute',
        left: -9999,
        top: -9999,
        width: 1,
        height: 1,
        overflow: 'hidden',
      }}
    >
      <View accessibilityLiveRegion={importance}>
        {/* The screen reader will read the content of this view when it changes */}
        {message}
      </View>
    </View>
  );
}