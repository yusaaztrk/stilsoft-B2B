import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import StockScreen from '../pages/admin/StockScreen';

export type StockStackParamList = {
  StockHome: undefined;
};

const Stack = createNativeStackNavigator<StockStackParamList>();

export default function StockStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="StockHome" component={StockScreen} />
    </Stack.Navigator>
  );
}
