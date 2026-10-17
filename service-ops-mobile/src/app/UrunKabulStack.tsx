import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import UrunKabulListScreen from '../pages/admin/UrunKabulListScreen';
import UrunKabulCreateScreen from '../pages/admin/UrunKabulCreateScreen';
import ServiceRecordDetailScreen from '../pages/technician/ServiceRecordDetailScreen';

export type UrunKabulStackParamList = {
  UrunKabulList: undefined;
  UrunKabulCreate: undefined;
  ServiceRecordDetail: { serviceId: string };
};

const Stack = createNativeStackNavigator<UrunKabulStackParamList>();

export default function UrunKabulStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="UrunKabulList" component={UrunKabulListScreen} />
      <Stack.Screen
        name="UrunKabulCreate"
        component={UrunKabulCreateScreen}
        options={{ presentation: 'modal' }}
      />
      <Stack.Screen name="ServiceRecordDetail" component={ServiceRecordDetailScreen} />
    </Stack.Navigator>
  );
}
