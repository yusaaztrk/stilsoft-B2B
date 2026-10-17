import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import RepairsScreen from '../pages/technician/RepairsScreen';
import RepairDetailScreen from '../pages/technician/RepairDetailScreen';
import ServiceRecordDetailScreen from '../pages/technician/ServiceRecordDetailScreen';

export type RepairStackParamList = {
  RepairList: { repairKind: 'saha' | 'atolye' } | undefined;
  RepairDetail: { serviceId: string };
  ServiceRecordDetail: { serviceId: string };
};

const Stack = createNativeStackNavigator<RepairStackParamList>();

export default function RepairStack({ route }: any) {
  const kind = route?.params?.repairKind ?? 'saha';
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen 
        name="RepairList" 
        component={RepairsScreen} 
        initialParams={{ repairKind: kind }}
      />
      <Stack.Screen name="RepairDetail" component={RepairDetailScreen} />
      <Stack.Screen name="ServiceRecordDetail" component={ServiceRecordDetailScreen} />
    </Stack.Navigator>
  );
}
