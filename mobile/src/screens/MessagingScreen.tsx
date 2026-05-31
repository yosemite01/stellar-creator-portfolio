/**
 * MessagingScreen — Issue #558 + #617
 * "Develop specific distinct interactive Direct Messaging layout architectures"
 * + Real-Time Multi-Language Translation in Chat
 *
 * Features:
 *  - Real-time message display with optimized FlatList
 *  - Message bubbles with sender/receiver styling
 *  - Typing indicators
 *  - Message timestamps
 *  - Input field with send button
 *  - Keyboard-aware layout
 *  - Pull-to-refresh for message history
 *  - Full dark mode support
 *  - Zero frame drops with optimized rendering
 *  - Accessibility support
 *  - [#617] Inline per-message translation toggle
 *  - [#617] Dynamic locale switcher for translation target
 *  - [#617] Low-latency translation with in-memory cache
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../theme/ThemeProvider';
import { FontSize, FontWeight, Radius, Spacing } from '../theme/tokens';
import i18n, { AppLocale, LOCALE_INFO, SUPPORTED_LOCALES } from '../i18n';
import { useChatTranslation } from '../hooks/useChatTranslation';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Message {
  id: string;
  text: string;
  senderId: string;
  senderName: string;
  timestamp: Date;
  status: 'sending' | 'sent' | 'delivered' | 'read' | 'failed';
}

interface MessagingScreenProps {
  conversationId: string;
  currentUserId: string;
  recipientName: string;
  onBack?: () => void;
}

// ─── Mock Data ────────────────────────────────────────────────────────────────

const MOCK_MESSAGES: Message[] = [
  {
    id: '1',
    text: "Hey! I saw your portfolio and I'm really impressed with your design work.",
    senderId: 'user-2',
    senderName: 'Alice Johnson',
    timestamp: new Date(Date.now() - 3600000),
    status: 'read',
  },
  {
    id: '2',
    text: "Thank you! I appreciate that. What kind of project are you working on?",
    senderId: 'user-1',
    senderName: 'You',
    timestamp: new Date(Date.now() - 3500000),
    status: 'read',
  },
  {
    id: '3',
    text: "We're building a new fintech app and need help with the UI/UX design. Would you be interested in discussing a potential collaboration?",
    senderId: 'user-2',
    senderName: 'Alice Johnson',
    timestamp: new Date(Date.now() - 3400000),
    status: 'read',
  },
  {
    id: '4',
    text: "Absolutely! That sounds exciting. I'd love to learn more about the project scope and timeline.",
    senderId: 'user-1',
    senderName: 'You',
    timestamp: new Date(Date.now() - 3300000),
    status: 'read',
  },
  {
    id: '5',
    text: "Perfect! Let me send you the project brief. We're looking to start in the next 2 weeks.",
    senderId: 'user-2',
    senderName: 'Alice Johnson',
    timestamp: new Date(Date.now() - 300000),
    status: 'delivered',
  },
];

// ─── Component ────────────────────────────────────────────────────────────────

export function MessagingScreen({
  conversationId,
  currentUserId = 'user-1',
  recipientName,
  onBack,
}: MessagingScreenProps) {
  const { colors, isDark } = useTheme();
  const [messages, setMessages] = useState<Message[]>(MOCK_MESSAGES);
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // ── Translation state ──────────────────────────────────────────────────────
  const [translationLocale, setTranslationLocale] = useState<AppLocale>(i18n.locale);
  const [showLocalePicker, setShowLocalePicker] = useState(false);
  const { translations, toggleTranslation, clearTranslations } = useChatTranslation(translationLocale);

  const flatListRef = useRef<FlatList<Message>>(null);

  // Simulate typing indicator
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsTyping(Math.random() > 0.7);
    }, 3000);
    return () => clearTimeout(timer);
  }, [messages]);

  // Clear cached translations when locale changes
  useEffect(() => {
    clearTranslations();
  }, [translationLocale, clearTranslations]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleSend = useCallback(() => {
    if (inputText.trim().length === 0) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const newMessage: Message = {
      id: Date.now().toString(),
      text: inputText.trim(),
      senderId: currentUserId,
      senderName: 'You',
      timestamp: new Date(),
      status: 'sending',
    };

    setMessages((prev) => [...prev, newMessage]);
    setInputText('');

    setTimeout(() => {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === newMessage.id ? { ...msg, status: 'sent' } : msg
        )
      );
    }, 500);

    setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated: true });
    }, 100);
  }, [inputText, currentUserId]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    setRefreshing(false);
  }, []);

  const handleLocaleChange = useCallback((locale: AppLocale) => {
    setTranslationLocale(locale);
    setShowLocalePicker(false);
  }, []);

  // ── Format Time ───────────────────────────────────────────────────────────

  const formatTime = useCallback((date: Date) => {
    return i18n.formatRelativeTime(date);
  }, []);

  // ── Render Message ────────────────────────────────────────────────────────

  const renderMessage = useCallback(
    ({ item }: { item: Message }) => {
      const isCurrentUser = item.senderId === currentUserId;
      const translation = translations[item.id];
      const isTranslated = translation?.isVisible && !translation.isLoading && !translation.error;

      return (
        <View
          style={[
            styles.messageContainer,
            isCurrentUser ? styles.messageRight : styles.messageLeft,
          ]}
        >
          <View
            style={[
              styles.messageBubble,
              isCurrentUser
                ? { backgroundColor: colors.primary }
                : { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
            ]}
          >
            {/* Original or translated text */}
            <Text
              style={[
                styles.messageText,
                { color: isCurrentUser ? '#ffffff' : colors.text },
              ]}
            >
              {isTranslated ? translation.translatedText : item.text}
            </Text>

            {/* Inline translated label */}
            {isTranslated && (
              <Text
                style={[
                  styles.translatedLabel,
                  { color: isCurrentUser ? 'rgba(255,255,255,0.6)' : colors.textTertiary },
                ]}
              >
                {LOCALE_INFO[translationLocale].nativeLabel}
              </Text>
            )}

            {/* Translation loading */}
            {translation?.isLoading && (
              <View style={styles.translatingRow}>
                <ActivityIndicator
                  size="small"
                  color={isCurrentUser ? 'rgba(255,255,255,0.7)' : colors.primary}
                />
                <Text
                  style={[
                    styles.translatingText,
                    { color: isCurrentUser ? 'rgba(255,255,255,0.7)' : colors.textTertiary },
                  ]}
                >
                  {i18n.t('chat.translating')}
                </Text>
              </View>
            )}

            {/* Translation error */}
            {translation?.error && translation.isVisible && (
              <Text style={styles.translationError}>{i18n.t('chat.translationFailed')}</Text>
            )}

            <View style={styles.messageFooter}>
              <Text
                style={[
                  styles.messageTime,
                  { color: isCurrentUser ? 'rgba(255,255,255,0.7)' : colors.textTertiary },
                ]}
              >
                {formatTime(item.timestamp)}
              </Text>
              {isCurrentUser && (
                <Text style={styles.messageStatus}>
                  {item.status === 'sending' && i18n.t('chat.messageSending')}
                  {item.status === 'sent' && i18n.t('chat.messageSent')}
                  {item.status === 'delivered' && i18n.t('chat.messageDelivered')}
                  {item.status === 'read' && i18n.t('chat.messageRead')}
                  {item.status === 'failed' && i18n.t('chat.messageFailed')}
                </Text>
              )}
            </View>
          </View>

          {/* Translate toggle button */}
          {translationLocale !== 'en' && (
            <Pressable
              onPress={() => toggleTranslation(item.id, item.text)}
              style={[
                styles.translateButton,
                isCurrentUser ? styles.translateButtonRight : styles.translateButtonLeft,
              ]}
              accessibilityRole="button"
              accessibilityLabel={
                translation?.isVisible
                  ? i18n.t('chat.showOriginal')
                  : `${i18n.t('chat.translate')} ${LOCALE_INFO[translationLocale].nativeLabel}`
              }
            >
              <Text style={[styles.translateButtonText, { color: colors.primary }]}>
                {translation?.isVisible
                  ? i18n.t('chat.showOriginal')
                  : i18n.t('chat.translate')}
              </Text>
            </Pressable>
          )}
        </View>
      );
    },
    [currentUserId, colors, formatTime, translations, translationLocale, toggleTranslation]
  );

  // ── Render Typing Indicator ──────────────────────────────────────────────

  const renderTypingIndicator = useCallback(() => {
    if (!isTyping) return null;

    return (
      <View style={[styles.messageContainer, styles.messageLeft]}>
        <View
          style={[
            styles.messageBubble,
            styles.typingBubble,
            { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
          ]}
        >
          <View style={styles.typingDots}>
            <View style={[styles.typingDot, { backgroundColor: colors.textTertiary }]} />
            <View style={[styles.typingDot, { backgroundColor: colors.textTertiary }]} />
            <View style={[styles.typingDot, { backgroundColor: colors.textTertiary }]} />
          </View>
        </View>
      </View>
    );
  }, [isTyping, colors]);

  // ── Locale Picker Modal ───────────────────────────────────────────────────

  const renderLocalePicker = () => (
    <Modal
      visible={showLocalePicker}
      transparent
      animationType="slide"
      onRequestClose={() => setShowLocalePicker(false)}
    >
      <Pressable
        style={styles.modalOverlay}
        onPress={() => setShowLocalePicker(false)}
      >
        <View
          style={[
            styles.modalSheet,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.modalTitle, { color: colors.text }]}>
            {i18n.t('chat.translateTo')}
          </Text>
          <ScrollView>
            {SUPPORTED_LOCALES.map((locale) => {
              const info = LOCALE_INFO[locale];
              const isSelected = locale === translationLocale;
              return (
                <Pressable
                  key={locale}
                  onPress={() => handleLocaleChange(locale)}
                  style={[
                    styles.localeRow,
                    { borderBottomColor: colors.border },
                    isSelected && { backgroundColor: colors.primary + '20' },
                  ]}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: isSelected }}
                >
                  <Text style={[styles.localeLabel, { color: colors.text }]}>
                    {info.nativeLabel}
                  </Text>
                  <Text style={[styles.localeSubLabel, { color: colors.textSecondary }]}>
                    {info.label}
                  </Text>
                  {isSelected && (
                    <Text style={[styles.localeCheck, { color: colors.primary }]}>✓</Text>
                  )}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </Pressable>
    </Modal>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        {onBack && (
          <Pressable
            onPress={onBack}
            style={styles.backButton}
            accessibilityRole="button"
            accessibilityLabel={i18n.t('common.back')}
          >
            <Text style={[styles.backIcon, { color: colors.primary }]}>←</Text>
          </Pressable>
        )}
        <View style={styles.headerInfo}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>{recipientName}</Text>
          <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
            {isTyping ? i18n.t('chat.typing') : i18n.t('chat.activeNow')}
          </Text>
        </View>

        {/* Translation locale selector */}
        <Pressable
          onPress={() => setShowLocalePicker(true)}
          style={[styles.translateLocaleButton, { borderColor: colors.border, backgroundColor: colors.surface }]}
          accessibilityRole="button"
          accessibilityLabel={i18n.t('chat.translationLanguage')}
        >
          <Text style={[styles.translateLocaleText, { color: colors.primary }]}>
            🌐 {LOCALE_INFO[translationLocale].code.toUpperCase()}
          </Text>
        </Pressable>
      </View>

      {/* Messages List */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={renderMessage}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.messagesList}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
          ListFooterComponent={renderTypingIndicator}
        />

        {/* Input Bar */}
        <View style={[styles.inputBar, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: colors.background,
                borderColor: colors.border,
                color: colors.text,
              },
            ]}
            value={inputText}
            onChangeText={setInputText}
            placeholder={i18n.t('chat.typeMessage')}
            placeholderTextColor={colors.textTertiary}
            multiline
            maxLength={1000}
            accessibilityLabel={i18n.t('chat.typeMessage')}
          />
          <Pressable
            style={[
              styles.sendButton,
              {
                backgroundColor: inputText.trim().length > 0 ? colors.primary : colors.border,
              },
            ]}
            onPress={handleSend}
            disabled={inputText.trim().length === 0}
            accessibilityRole="button"
            accessibilityLabel={i18n.t('chat.send')}
          >
            <Text style={styles.sendIcon}>➤</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      {renderLocalePicker()}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backButton: {
    marginRight: Spacing.sm,
    padding: Spacing.xs,
  },
  backIcon: {
    fontSize: 24,
    fontWeight: FontWeight.bold,
  },
  headerInfo: {
    flex: 1,
  },
  headerTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
  },
  headerSubtitle: {
    fontSize: FontSize.xs,
    marginTop: 2,
  },
  translateLocaleButton: {
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    marginLeft: Spacing.sm,
  },
  translateLocaleText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
  },
  messagesList: {
    padding: Spacing.base,
    gap: Spacing.sm,
  },
  messageContainer: {
    maxWidth: '80%',
    marginVertical: Spacing.xs,
  },
  messageLeft: {
    alignSelf: 'flex-start',
  },
  messageRight: {
    alignSelf: 'flex-end',
  },
  messageBubble: {
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.xl,
  },
  messageText: {
    fontSize: FontSize.base,
    lineHeight: 20,
  },
  translatedLabel: {
    fontSize: 10,
    marginTop: 2,
    fontStyle: 'italic',
  },
  translatingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  translatingText: {
    fontSize: FontSize.xs,
    fontStyle: 'italic',
  },
  translationError: {
    fontSize: FontSize.xs,
    color: '#ef4444',
    marginTop: 2,
  },
  messageFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: Spacing.xs,
    gap: Spacing.xs,
  },
  messageTime: {
    fontSize: FontSize.xs,
  },
  messageStatus: {
    fontSize: 10,
  },
  translateButton: {
    marginTop: 2,
    paddingVertical: 2,
  },
  translateButtonLeft: {
    alignSelf: 'flex-start',
  },
  translateButtonRight: {
    alignSelf: 'flex-end',
  },
  translateButtonText: {
    fontSize: 11,
    textDecorationLine: 'underline',
  },
  typingBubble: {
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.sm,
  },
  typingDots: {
    flexDirection: 'row',
    gap: 4,
  },
  typingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: Spacing.sm,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: Radius.xl,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.sm,
    fontSize: FontSize.base,
    maxHeight: 100,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendIcon: {
    fontSize: 18,
    color: '#ffffff',
  },
  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    borderWidth: 1,
    maxHeight: '60%',
    paddingTop: Spacing.base,
  },
  modalTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    paddingHorizontal: Spacing.base,
    paddingBottom: Spacing.sm,
  },
  localeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: Spacing.sm,
  },
  localeLabel: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    flex: 1,
  },
  localeSubLabel: {
    fontSize: FontSize.sm,
  },
  localeCheck: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.bold,
  },
});
