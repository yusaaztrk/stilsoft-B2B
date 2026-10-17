import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus, Platform } from 'react-native';
import Geolocation from 'react-native-geolocation-service';
import { useSessionStore } from '../session/store';
import { apiJson } from '../api/client';

export function useLocationTracker() {
  const { technicianId } = useSessionStore();
  const appState = useRef(AppState.currentState);
  const watchId = useRef<number | null>(null);

  useEffect(() => {
    if (!technicianId) return;

    let isActive = true;

    const requestPermissions = async () => {
      if (Platform.OS === 'ios') {
        const auth = await Geolocation.requestAuthorization('always');
        if (auth !== 'granted') return false;
      } else if (Platform.OS === 'android') {
        const { PermissionsAndroid } = require('react-native');
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          {
            title: 'Konum İzni',
            message: 'Teknisyen konumunuzu takip edebilmemiz için konum izni gereklidir.',
            buttonPositive: 'İzin Ver',
            buttonNegative: 'Reddet',
          }
        );
        if (granted !== PermissionsAndroid.RESULTS.GRANTED) return false;
      }
      return true;
    };

    const sendLocation = async (lat: number, lon: number) => {
      try {
        await apiJson(`/api/technicians/${technicianId}/location`, {
          method: 'POST',
          body: JSON.stringify({
            latitude: lat,
            longitude: lon
          })
        });
      } catch (e) {
        console.warn('Failed to send location', e);
      }
    };

    let intervalId: any = null;

    const startTracking = async () => {
      const hasPermission = await requestPermissions();
      if (!hasPermission || !isActive) return;

      // 1. Get current position immediately and send it
      Geolocation.getCurrentPosition(
        (position) => {
          sendLocation(position.coords.latitude, position.coords.longitude);
        },
        (error) => {
          console.warn('Tracker: Failed to get initial position', error.code, error.message);
        },
        { 
          enableHighAccuracy: true, 
          timeout: 15000, 
          maximumAge: 10000 
        }
      );

      // 2. Watch position for changes (battery efficient OS-level batching)
      watchId.current = Geolocation.watchPosition(
        (position) => {
          sendLocation(position.coords.latitude, position.coords.longitude);
        },
        (error) => {
          console.log('Tracker: watchPosition error', error.code, error.message);
        },
        { 
          enableHighAccuracy: true, 
          distanceFilter: 50, // Send only if moved 50 meters
          interval: 5 * 60 * 1000, // Send max once every 5 minutes on Android
          fastestInterval: 60000,
          showsBackgroundLocationIndicator: true
        }
      );

      // 3. Fallback interval for periodic updates when technician remains in the same spot
      intervalId = setInterval(() => {
        Geolocation.getCurrentPosition(
          (position) => {
            sendLocation(position.coords.latitude, position.coords.longitude);
          },
          (error) => {
            console.warn('Tracker: Failed to get periodic position', error.code, error.message);
          },
          { 
            enableHighAccuracy: true, 
            timeout: 15000, 
            maximumAge: 10000 
          }
        );
      }, 5 * 60 * 1000); // 5 minutes
    };

    startTracking();

    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      appState.current = nextAppState;
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      isActive = false;
      subscription.remove();
      if (watchId.current !== null) {
        Geolocation.clearWatch(watchId.current);
      }
      if (intervalId !== null) {
        clearInterval(intervalId);
      }
    };
  }, [technicianId]);
}
