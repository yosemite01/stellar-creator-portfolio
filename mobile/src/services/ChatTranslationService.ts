/**
 * ChatTranslationService — Issue #617
 * Real-time multi-language translation for chat messages.
 *
 * Uses a low-latency mock translation engine that can be swapped for
 * any real translation API (LibreTranslate, DeepL, Google Translate, etc.)
 * by replacing the `translateText` implementation.
 */

import { AppLocale } from '../i18n';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TranslationResult {
  translatedText: string;
  sourceLocale: AppLocale;
  targetLocale: AppLocale;
  cached: boolean;
}

// ─── Mock translation dictionary ─────────────────────────────────────────────
// In production, replace with a real API call.

const MOCK_TRANSLATIONS: Record<string, Record<AppLocale, string>> = {
  "Hey! I saw your portfolio and I'm really impressed with your design work.": {
    en: "Hey! I saw your portfolio and I'm really impressed with your design work.",
    es: '¡Hola! Vi tu portafolio y estoy muy impresionado con tu trabajo de diseño.',
    fr: 'Salut ! J\'ai vu ton portfolio et je suis vraiment impressionné par ton travail de design.',
    de: 'Hey! Ich habe dein Portfolio gesehen und bin wirklich beeindruckt von deiner Designarbeit.',
    ar: 'مرحباً! رأيت محفظتك وأنا معجب جداً بعملك في التصميم.',
  },
  "Thank you! I appreciate that. What kind of project are you working on?": {
    en: "Thank you! I appreciate that. What kind of project are you working on?",
    es: '¡Gracias! Lo aprecio. ¿En qué tipo de proyecto estás trabajando?',
    fr: 'Merci ! Je l\'apprécie. Sur quel type de projet travaillez-vous ?',
    de: 'Danke! Das schätze ich. An welcher Art von Projekt arbeiten Sie?',
    ar: 'شكراً! أقدر ذلك. ما نوع المشروع الذي تعمل عليه؟',
  },
  "We're building a new fintech app and need help with the UI/UX design. Would you be interested in discussing a potential collaboration?": {
    en: "We're building a new fintech app and need help with the UI/UX design. Would you be interested in discussing a potential collaboration?",
    es: 'Estamos construyendo una nueva aplicación fintech y necesitamos ayuda con el diseño UI/UX. ¿Estarías interesado en discutir una posible colaboración?',
    fr: 'Nous construisons une nouvelle application fintech et avons besoin d\'aide pour la conception UI/UX. Seriez-vous intéressé à discuter d\'une collaboration potentielle ?',
    de: 'Wir bauen eine neue Fintech-App und brauchen Hilfe beim UI/UX-Design. Wären Sie daran interessiert, eine mögliche Zusammenarbeit zu besprechen?',
    ar: 'نحن نبني تطبيق تقنية مالية جديد ونحتاج إلى مساعدة في تصميم واجهة المستخدم. هل أنت مهتم بمناقشة تعاون محتمل؟',
  },
  "Absolutely! That sounds exciting. I'd love to learn more about the project scope and timeline.": {
    en: "Absolutely! That sounds exciting. I'd love to learn more about the project scope and timeline.",
    es: '¡Por supuesto! Eso suena emocionante. Me encantaría saber más sobre el alcance del proyecto y el cronograma.',
    fr: 'Absolument ! Ça semble passionnant. J\'adorerais en savoir plus sur la portée du projet et le calendrier.',
    de: 'Absolut! Das klingt aufregend. Ich würde gerne mehr über den Projektumfang und den Zeitplan erfahren.',
    ar: 'بالتأكيد! يبدو ذلك مثيراً. أود معرفة المزيد عن نطاق المشروع والجدول الزمني.',
  },
  "Perfect! Let me send you the project brief. We're looking to start in the next 2 weeks.": {
    en: "Perfect! Let me send you the project brief. We're looking to start in the next 2 weeks.",
    es: '¡Perfecto! Déjame enviarte el resumen del proyecto. Esperamos comenzar en las próximas 2 semanas.',
    fr: 'Parfait ! Laissez-moi vous envoyer le brief du projet. Nous espérons commencer dans les 2 prochaines semaines.',
    de: 'Perfekt! Lassen Sie mich Ihnen das Projektbriefing schicken. Wir planen, in den nächsten 2 Wochen zu beginnen.',
    ar: 'ممتاز! دعني أرسل لك ملخص المشروع. نتطلع إلى البدء في الأسبوعين القادمين.',
  },
};

// ─── Cache ────────────────────────────────────────────────────────────────────

const translationCache = new Map<string, string>();

function cacheKey(text: string, target: AppLocale): string {
  return `${target}:${text}`;
}

// ─── Core translation function ────────────────────────────────────────────────

/**
 * Translate `text` to `targetLocale`.
 * Swap the body of this function to call a real translation API.
 */
async function translateText(text: string, targetLocale: AppLocale): Promise<string> {
  const key = cacheKey(text, targetLocale);
  if (translationCache.has(key)) {
    return translationCache.get(key)!;
  }

  // Simulate network latency (50–150 ms)
  await new Promise((r) => setTimeout(r, 50 + Math.random() * 100));

  // Look up mock dictionary
  const entry = MOCK_TRANSLATIONS[text];
  const translated = entry?.[targetLocale] ?? text;

  translationCache.set(key, translated);
  return translated;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export const ChatTranslationService = {
  /**
   * Translate a single message text.
   */
  async translate(
    text: string,
    targetLocale: AppLocale,
    sourceLocale: AppLocale = 'en',
  ): Promise<TranslationResult> {
    if (targetLocale === sourceLocale) {
      return { translatedText: text, sourceLocale, targetLocale, cached: true };
    }

    const key = cacheKey(text, targetLocale);
    const cached = translationCache.has(key);
    const translatedText = await translateText(text, targetLocale);

    return { translatedText, sourceLocale, targetLocale, cached };
  },

  /**
   * Translate multiple messages in parallel.
   */
  async translateBatch(
    texts: string[],
    targetLocale: AppLocale,
    sourceLocale: AppLocale = 'en',
  ): Promise<TranslationResult[]> {
    return Promise.all(
      texts.map((text) => ChatTranslationService.translate(text, targetLocale, sourceLocale)),
    );
  },

  clearCache(): void {
    translationCache.clear();
  },
};

export default ChatTranslationService;
