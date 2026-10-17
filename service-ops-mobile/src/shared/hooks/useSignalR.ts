import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback } from 'react';
import * as signalR from '@microsoft/signalr';
import { API_BASE_URL } from '../config';
import { getAccessToken } from '../session/storage';
import { speak } from '../speech';

const HUB_URL = `${API_BASE_URL}/hubs/serviceops`;

// Map of event name → query keys to invalidate
const EVENT_QUERY_MAP: Record<string, readonly unknown[][]> = {
  cargo_updated: [['cargo'], ['kargoTakibi']],
  service_record_updated: [['servicerecords'], ['ariza'], ['stock']],
  installation_updated: [['installations'], ['servicerecords'], ['stock']],
  technician_location_updated: [['locations'], ['technicians']],
  // "Sana iş atandı". Sunucu bu olayı yalnızca ilgili teknisyenin grubuna gönderir,
  // yani buraya düşen her mesaj bu telefonun sahibine aittir.
  notification_created: [['notifications']],
};

/** Yeni atama bildirimi. */
export type AssignmentNotification = {
  id: string;
  title: string;
  message: string;
  jobType?: string | null;
  jobId?: string | null;
  createdAt?: string;
  /** Sunucudan gelen, sesli okunacak tam metin. */
  speech?: string;
};

type Listener = (n: AssignmentNotification) => void;
const listeners = new Set<Listener>();

/**
 * Atama bildirimi dinleyicisi. Ekranlar (örn. bildirim listesi) abone olup kendini
 * tazeleyebilir; sesli okuma zaten merkezî olarak yapılır.
 */
export function onAssignmentNotification(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * useSignalR (Mobile)
 *
 * Connects to ServiceOps SignalR hub on screen focus, disconnects on blur.
 * Invalidates React Query caches when events are received.
 *
 * Usage:
 *   useSignalR();                             // all events
 *   useSignalR(['cargo_updated']);            // specific events only
 */
export function useSignalR(events?: string[]) {
  const qc = useQueryClient();
  const connectionRef = useRef<signalR.HubConnection | null>(null);

  useFocusEffect(
    useCallback(() => {
      const eventsToListen = events ?? Object.keys(EVENT_QUERY_MAP);

      // HUB KİMLİK İSTİYOR.
      //
      // Bağlantı eskiden token'sız kuruluyordu; sunucuda hub [Authorize] olduğu için el sıkışma
      // reddediliyor ve mobil hiçbir canlı olay ALMIYORDU (sessizce yoklamaya düşüyordu).
      // Token sorgu parametresiyle taşınır — WebSocket el sıkışmasına başlık eklenemediği için
      // SignalR'ın standart yolu budur (bkz. Program.cs'teki OnMessageReceived).
      //
      // `skipNegotiation` de kaldırıldı: görüşme adımı atlanınca WebSocket kurulamayan ağlarda
      // uzun yoklamaya düşülemiyor, bağlantı tamamen kopuyordu.
      const connection = new signalR.HubConnectionBuilder()
        .withUrl(HUB_URL, {
          accessTokenFactory: async () => (await getAccessToken()) ?? '',
        })
        .withAutomaticReconnect([0, 1000, 3000, 5000, 10000, 30000])
        .configureLogging(signalR.LogLevel.Warning)
        .build();

      connectionRef.current = connection;

      eventsToListen.forEach((event) => {
        connection.on(event, (payload: any) => {
          const keysToInvalidate = EVENT_QUERY_MAP[event] ?? [[event]];
          keysToInvalidate.forEach((key) => {
            qc.invalidateQueries({ queryKey: key });
          });

          if (event === 'notification_created' && payload) {
            handleAssignmentNotification(payload);
          }
        });
      });

      connection
        .start()
        .then(() => console.log('[SignalR] Connected'))
        .catch((err) => console.warn('[SignalR] Connection failed, falling back to polling:', err));

      connection.onreconnected(() => {
        // Refresh all on reconnect to avoid stale data
        eventsToListen.forEach((event) => {
          const keysToInvalidate = EVENT_QUERY_MAP[event] ?? [[event]];
          keysToInvalidate.forEach((key) => qc.invalidateQueries({ queryKey: key }));
        });
      });

      return () => {
        connection.stop().catch(() => {});
        connectionRef.current = null;
      };
    }, []) // eslint-disable-line react-hooks/exhaustive-deps
  );
}

/**
 * AYNI BİLDİRİM İKİ KEZ OKUNMAZ.
 *
 * Hub bağlantısı ekran değiştikçe yeniden kuruluyor ve yeniden bağlanmada olay tekrarlanabiliyor;
 * kimlik hatırlanmazsa teknisyen aynı işi üst üste dinlerdi.
 */
const spokenIds = new Set<string>();

/**
 * Dışarıdan (kök dinleyiciden) gelen bildirim yükünü aynı kapıdan geçirir.
 * Tekilleştirme ve sesli okuma tek yerde kalsın diye ayrı bir yol açılmıyor.
 */
export function notifyAssignment(payload: any) {
  handleAssignmentNotification(payload);
}

function handleAssignmentNotification(payload: any) {
  const notification: AssignmentNotification = {
    id: String(payload.id ?? ''),
    title: String(payload.title ?? 'Yeni iş'),
    message: String(payload.message ?? ''),
    jobType: payload.jobType ?? null,
    jobId: payload.jobId ?? null,
    createdAt: payload.createdAt,
    speech: payload.speech,
  };

  if (notification.id && spokenIds.has(notification.id)) return;
  if (notification.id) {
    spokenIds.add(notification.id);
    // Küme sonsuza kadar büyümesin.
    if (spokenIds.size > 200) {
      const oldest = spokenIds.values().next().value;
      if (oldest !== undefined) spokenIds.delete(oldest);
    }
  }

  speak(notification.speech || `${notification.title}. ${notification.message}`);

  listeners.forEach((listener) => {
    try {
      listener(notification);
    } catch (err) {
      console.warn('[SignalR] Bildirim dinleyicisi hata verdi:', err);
    }
  });
}

/** Atama bildirimini React tarafında dinlemek için kısayol. */
export function useAssignmentNotification(listener: Listener) {
  const ref = useRef(listener);
  ref.current = listener;

  useEffect(() => onAssignmentNotification((n) => ref.current(n)), []);
}
