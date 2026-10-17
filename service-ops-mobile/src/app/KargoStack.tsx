import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import KargoTakipScreen from '../pages/technician/KargoTakipScreen';

const Stack = createNativeStackNavigator();

export default function KargoStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: '#111' },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: 'bold' },
      }}
    >
      <Stack.Screen name="KargoList" component={KargoTakipScreen} options={{ title: 'Kargo Takibi' }} />
    </Stack.Navigator>
  );
}
