import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import CustomersScreen from '../pages/admin/CustomersScreen';

export type CustomersStackParamList = {
  CustomersHome: undefined;
};

const Stack = createNativeStackNavigator<CustomersStackParamList>();

export default function CustomersStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="CustomersHome" component={CustomersScreen} />
    </Stack.Navigator>
  );
}
