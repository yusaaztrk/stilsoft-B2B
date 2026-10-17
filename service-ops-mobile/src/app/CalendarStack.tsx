import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import CalendarScreen from '../pages/technician/CalendarScreen';
import RouteDetailScreen from '../pages/technician/RouteDetailScreen';
import ServiceRecordDetailScreen from '../pages/technician/ServiceRecordDetailScreen';

export type CalendarStackParamList = {
  CalendarHome: undefined;
  RouteDetail: { routeId: string };
  ServiceRecordDetail: { serviceId: string };
};

const Stack = createNativeStackNavigator<CalendarStackParamList>();

export default function CalendarStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="CalendarHome" component={CalendarScreen} />
      <Stack.Screen name="RouteDetail" component={RouteDetailScreen} />
      <Stack.Screen name="ServiceRecordDetail" component={ServiceRecordDetailScreen} />
    </Stack.Navigator>
  );
}
