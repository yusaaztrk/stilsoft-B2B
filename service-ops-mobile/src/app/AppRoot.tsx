import React, { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import LoginScreen from '../pages/auth/LoginScreen';
import UnauthorizedScreen from '../pages/auth/UnauthorizedScreen';
import { useSessionStore } from '../shared/session/store';
import SharedSessionGuard from '../shared/session/SharedSessionGuard';
import AssignmentNotificationListener from '../shared/notifications/AssignmentNotificationListener';
import TechnicianTabs from './TechnicianTabs';
import AdminTabs from './AdminTabs';

const queryClient = new QueryClient();

type RootStackParamList = {
  Login: undefined;
  Technician: undefined;
  Admin: undefined;
  Unauthorized: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

function RootNavigator() {
  const hydrated = useSessionStore((s) => s.hydrated);
  const accessToken = useSessionStore((s) => s.accessToken);
  const role = useSessionStore((s) => s.role);
  const hydrate = useSessionStore((s) => s.hydrate);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  if (!hydrated) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {accessToken ? (
        role?.toLowerCase() === 'technician' ? (
          <Stack.Screen name="Technician" component={TechnicianTabs} />
        ) : (role?.toLowerCase() === 'admin' || role?.toLowerCase() === 'superadmin' || role?.toLowerCase() === 'user' || role?.toLowerCase() === 'supersuperadmin') ? (
          <Stack.Screen name="Admin" component={AdminTabs} />
        ) : (
          <Stack.Screen name="Unauthorized" component={UnauthorizedScreen} />
        )
      ) : (
        <Stack.Screen name="Login" component={LoginScreen} />
      )}
    </Stack.Navigator>
  );
}

export default function AppRoot() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <NavigationContainer>
          <RootNavigator />
          {/* Bayi ile ortak oturum: geri sayım, uzatma ekranı ve karşı taraftaki çıkışın burada
              da uygulanması. Oturum yokken kendini hiç göstermez. */}
          <SharedSessionGuard />
          {/* "Sana iş atandı" bildirimi: hangi ekranda olunursa olunsun çalışır, gelen mesajı
              sesli okur. Ekran odağına bağlı useSignalR bunu tek başına karşılamıyordu. */}
          <AssignmentNotificationListener />
        </NavigationContainer>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

