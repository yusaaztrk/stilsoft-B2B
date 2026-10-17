import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import TechniciansScreen from '../pages/admin/TechniciansScreen';
import TechnicianDetailScreen from '../pages/admin/TechnicianDetailScreen';

export type TechniciansStackParamList = {
  TechniciansHome: undefined;
  TechnicianDetail: { technicianId: string };
};

const Stack = createNativeStackNavigator<TechniciansStackParamList>();

export default function TechniciansStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="TechniciansHome" component={TechniciansScreen} />
      <Stack.Screen name="TechnicianDetail" component={TechnicianDetailScreen} />
    </Stack.Navigator>
  );
}
