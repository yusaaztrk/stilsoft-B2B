import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import PlanningScreen from '../pages/admin/PlanningScreen';
import ServiceRecordDetailScreen from '../pages/technician/ServiceRecordDetailScreen';

export type PlanningStackParamList = {
  PlanningHome: { planningKind: 'repair' | 'installation'; serviceId?: string };
  ServiceRecordDetail: { serviceId: string };
};

const Stack = createNativeStackNavigator<PlanningStackParamList>();

export default function PlanningStack({ route }: any) {
  const kind = route?.params?.planningKind ?? 'repair';
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen 
        name="PlanningHome" 
        component={PlanningScreen} 
        initialParams={{ planningKind: kind }}
      />
      <Stack.Screen name="ServiceRecordDetail" component={ServiceRecordDetailScreen} />
    </Stack.Navigator>
  );
}
