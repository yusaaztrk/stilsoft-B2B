import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import JobsScreen from '../pages/technician/JobsScreen';
import RepairDetailScreen from '../pages/technician/RepairDetailScreen';
import InstallationDetailScreen from '../pages/technician/InstallationDetailScreen';
import ServiceRecordDetailScreen from '../pages/technician/ServiceRecordDetailScreen';

export type JobsStackParamList = {
  JobsHome: undefined;
  RepairDetail: { serviceId: string };
  InstallationDetail: { serviceId: string };
  ServiceRecordDetail: { serviceId: string };
};

const Stack = createNativeStackNavigator<JobsStackParamList>();

export default function JobsStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="JobsHome" component={JobsScreen} />
      <Stack.Screen name="RepairDetail" component={RepairDetailScreen} />
      <Stack.Screen name="InstallationDetail" component={InstallationDetailScreen} />
      <Stack.Screen name="ServiceRecordDetail" component={ServiceRecordDetailScreen} />
    </Stack.Navigator>
  );
}
