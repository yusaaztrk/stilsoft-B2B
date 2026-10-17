import { useEffect, useRef } from 'react';
import * as signalR from '@microsoft/signalr';
import { getAccessToken } from '../auth/storage';
import { API_BASE_URL } from '../config';

const HUB_URL = `${API_BASE_URL}/hubs/serviceops`;

/**
 * useSignalR (Web)
 *
 * Connects to ServiceOps SignalR hub and dispatches CustomEvents on the window
 * whenever the server broadcasts a real-time notification.
 *
 * Pages can listen with:
 *   window.addEventListener('signalr:cargo_updated', () => refetch())
 *   window.addEventListener('signalr:service_record_updated', () => refetch())
 *   window.addEventListener('signalr:installation_updated', () => refetch())
 *
 * Usage (in App.tsx — single global connection):
 *   useSignalR();
 */
export function useSignalR(events?: string[]) {
  const connectionRef = useRef<signalR.HubConnection | null>(null);

  useEffect(() => {
    const allEvents = events ?? [
      'cargo_updated',
      'service_record_updated',
      'ReceiveServiceRecordUpdate',
      'ServiceRecordUpdated',
      'installation_updated',
      'technician_location_updated',
      // Kişisel bildirim: "sana iş atandı". Diğerlerinden farklı olarak herkese değil, yalnızca
      // ilgili teknisyenin grubuna gönderilir (sunucuda ServiceOpsHub.TechnicianGroup).
      'notification_created',
    ];

    // Hub artık kimlik istiyor (eskiden anonimdi: ağdan erişen herkes bütün firmaların canlı
    // güncellemelerini dinleyebiliyordu). accessTokenFactory her yeniden bağlanmada çağrılır,
    // yani token yenilendiğinde bağlantı bayat token'la takılı kalmaz.
    const connection = new signalR.HubConnectionBuilder()
      .withUrl(HUB_URL, {
        accessTokenFactory: () => getAccessToken() ?? '',
        skipNegotiation: true,
        transport: signalR.HttpTransportType.WebSockets
      })
      .withAutomaticReconnect([0, 2000, 5000, 10000, 30000])
      .configureLogging(signalR.LogLevel.Warning)
      .build();

    connectionRef.current = connection;

    allEvents.forEach((event) => {
      connection.on(event, (payload) => {
        // Dispatch a browser CustomEvent so any page can react without coupling
        window.dispatchEvent(
          new CustomEvent(`signalr:${event}`, { detail: payload })
        );
      });
    });

    connection
      .start()
      .then(() => console.log('[SignalR] Connected to ServiceOps hub'))
      .catch((err) =>
        console.warn('[SignalR] Could not connect (falling back to polling):', err)
      );

    connection.onreconnected(() => {
      console.log('[SignalR] Reconnected — connection restored');
    });

    return () => {
      connection.stop().catch(() => {});
      connectionRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * useSignalREvent (Web)
 *
 * Subscribe to a specific SignalR event in any page component.
 *
 * Usage:
 *   useSignalREvent('cargo_updated', () => refetch())
 *   useSignalREvent('service_record_updated', () => loadData())
 */
export function useSignalREvent(event: string, handler: (payload?: unknown) => void) {
  useEffect(() => {
    const listener = (e: Event) => handler((e as CustomEvent).detail);
    window.addEventListener(`signalr:${event}`, listener);
    return () => window.removeEventListener(`signalr:${event}`, listener);
  }, [event, handler]);
}
