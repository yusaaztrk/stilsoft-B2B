import { useEffect, useRef } from 'react';
import * as signalR from '@microsoft/signalr';
import { useQueryClient } from '@tanstack/react-query';
import { API_BASE_URL } from '../config';
import { getAccessToken } from '../session/storage';
import { useSessionStore } from '../session/store';
import { notifyAssignment } from '../hooks/useSignalR';

const HUB_URL = `${API_BASE_URL}/hubs/serviceops`;

/**
 * "Sana iş atandı" bildirimini uygulama açık olduğu SÜRECE dinler ve sesli okutur.
 *
 * Neden ayrı bir bağlantı: <see cref="useSignalR"/> ekran odağına bağlı (`useFocusEffect`) —
 * teknisyen o kancayı kullanmayan bir ekrana geçtiği anda bildirim kanalı kapanıyor, atanan iş
 * sesli okunmuyordu. Bildirim, hangi ekranda olunduğundan bağımsız çalışmak zorunda.
 *
 * Bileşen hiçbir şey çizmez; yalnızca bağlantıyı yönetir. Oturum kapanınca bağlantı da kapanır.
 */
export default function AssignmentNotificationListener() {
  const accessToken = useSessionStore((s) => s.accessToken);
  const qc = useQueryClient();
  const connectionRef = useRef<signalR.HubConnection | null>(null);

  useEffect(() => {
    if (!accessToken) return;

    const connection = new signalR.HubConnectionBuilder()
      .withUrl(HUB_URL, {
        accessTokenFactory: async () => (await getAccessToken()) ?? '',
      })
      .withAutomaticReconnect([0, 1000, 3000, 5000, 10000, 30000])
      .configureLogging(signalR.LogLevel.Warning)
      .build();

    connectionRef.current = connection;

    connection.on('notification_created', (payload: any) => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
      notifyAssignment(payload);
    });

    connection
      .start()
      .catch((err) => console.warn('[Bildirim] Bağlanılamadı:', err));

    return () => {
      connection.stop().catch(() => {});
      connectionRef.current = null;
    };
  }, [accessToken, qc]);

  return null;
}
