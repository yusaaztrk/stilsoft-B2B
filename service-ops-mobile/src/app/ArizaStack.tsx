import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import ArizaListScreen from '../pages/admin/ArizaListScreen';
import AtolyeArizaScreen from '../pages/admin/AtolyeArizaScreen';
import SahaArizaScreen from '../pages/admin/SahaArizaScreen';
import ServiceRecordDetailScreen from '../pages/technician/ServiceRecordDetailScreen';

export type ArizaStackParamList = {
  ArizaList: undefined;
  AtolyeAriza: undefined;
  SahaAriza: undefined;
  ServiceRecordDetail: { serviceId: string };
};

const Stack = createNativeStackNavigator<ArizaStackParamList>();

export default function ArizaStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="ArizaList" component={ArizaListScreen} />
      <Stack.Screen name="AtolyeAriza" component={AtolyeArizaScreen} />
      <Stack.Screen name="SahaAriza" component={SahaArizaScreen} />
      <Stack.Screen name="ServiceRecordDetail" component={ServiceRecordDetailScreen} />
    </Stack.Navigator>
  );
}
