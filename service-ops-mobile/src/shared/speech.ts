import { Platform } from 'react-native';

/**
 * Sesli okuma (TTS).
 *
 * Teknisyen sahada, elinde ürünle ve çoğu zaman telefona bakamayacak durumda oluyor; atanan işin
 * ekranda yazması tek başına yetmiyor. Bu yüzden atama bildirimi geldiğinde metin sesli okunur.
 *
 * PAKET ZORUNLU DEĞİL: `react-native-tts` yerli (native) bir modül, yani `npm install` sonrası
 * uygulamanın yeniden derlenmesi gerekiyor. Paket yoksa uygulama ÇÖKMEZ — ses sessizce atlanır,
 * bildirim yine listeye düşer ve ekranda görünür. Aksi halde paketi kurmamış bir cihazda
 * bildirim gelen her an uygulama patlardı.
 */

type TtsModule = {
  setDefaultLanguage: (lang: string) => Promise<unknown>;
  setDefaultRate: (rate: number, skipTransform?: boolean) => Promise<unknown>;
  setDucking?: (enabled: boolean) => Promise<unknown>;
  stop: () => Promise<unknown>;
  speak: (text: string, options?: Record<string, unknown>) => unknown;
  getInitStatus?: () => Promise<unknown>;
};

let tts: TtsModule | null | undefined;
let initPromise: Promise<void> | null = null;
let enabled = true;

function loadTts(): TtsModule | null {
  if (tts !== undefined) return tts;
  try {
    // Koşullu require bilinçli: paket kurulmamışsa import satırı derlemeyi kırardı.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('react-native-tts');
    tts = (mod?.default ?? mod) as TtsModule;
  } catch {
    console.warn(
      '[TTS] react-native-tts kurulu değil — sesli okuma devre dışı. Kurulum: npm install, sonra uygulamayı yeniden derleyin.'
    );
    tts = null;
  }
  return tts;
}

async function ensureReady(engine: TtsModule): Promise<void> {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      // Android'de motor hazır olmadan speak çağrısı sessizce yutuluyor.
      if (engine.getInitStatus) await engine.getInitStatus();
      await engine.setDefaultLanguage('tr-TR');
      // Varsayılan hız İngilizce metin için ayarlı; Türkçe cümlelerde biraz yavaş daha anlaşılır.
      await engine.setDefaultRate(Platform.OS === 'ios' ? 0.5 : 0.45, true);
      // Navigasyon/müzik çalıyorsa sesi kısıp üstüne konuşur.
      await engine.setDucking?.(true);
    } catch (err) {
      console.warn('[TTS] Başlatılamadı:', err);
    }
  })();

  return initPromise;
}

/** Sesli okumayı kullanıcı tercihi olarak aç/kapa. */
export function setSpeechEnabled(value: boolean) {
  enabled = value;
  if (!value) loadTts()?.stop().catch(() => {});
}

export function isSpeechEnabled() {
  return enabled;
}

/**
 * Metni sesli okur. Okuma sırasında yeni bir bildirim gelirse öncekini keser — teknisyen için
 * güncel iş, yarım kalmış eski cümleden önemli.
 */
export async function speak(text: string) {
  if (!enabled) return;
  const trimmed = (text ?? '').trim();
  if (!trimmed) return;

  const engine = loadTts();
  if (!engine) return;

  try {
    await ensureReady(engine);
    await engine.stop();
    engine.speak(trimmed, {
      androidParams: { KEY_PARAM_STREAM: 'STREAM_NOTIFICATION' },
      iosVoiceId: undefined,
      rate: undefined,
    });
  } catch (err) {
    console.warn('[TTS] Okunamadı:', err);
  }
}
