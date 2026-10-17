import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import RoutesListScreen from '../pages/admin/RoutesListScreen';
import RouteDetailScreen from '../pages/technician/RouteDetailScreen';
import ServiceRecordDetailScreen from '../pages/technician/ServiceRecordDetailScreen';

export type RoutesStackParamList = {
  RoutesHome: undefined;
  RouteDetail: { routeId: string };
  ServiceRecordDetail: { serviceId: string };
};

const Stack = createNativeStackNavigator<RoutesStackParamList>();

export default function RoutesStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="RoutesHome" component={RoutesListScreen} />
      <Stack.Screen name="RouteDetail" component={RouteDetailScreen} />
      <Stack.Screen name="ServiceRecordDetail" component={ServiceRecordDetailScreen} />
    </Stack.Navigator>
  );
}
