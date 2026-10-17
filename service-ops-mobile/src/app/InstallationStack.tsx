import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import InstallationsScreen from '../pages/technician/InstallationsScreen';
import InstallationDetailScreen from '../pages/technician/InstallationDetailScreen';
import ServiceRecordDetailScreen from '../pages/technician/ServiceRecordDetailScreen';

export type InstallationStackParamList = {
  InstallationList: undefined;
  InstallationDetail: { serviceId: string };
  ServiceRecordDetail: { serviceId: string };
};

const Stack = createNativeStackNavigator<InstallationStackParamList>();

export default function InstallationStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="InstallationList" component={InstallationsScreen} />
      <Stack.Screen name="InstallationDetail" component={InstallationDetailScreen} />
      <Stack.Screen name="ServiceRecordDetail" component={ServiceRecordDetailScreen} />
    </Stack.Navigator>
  );
}
