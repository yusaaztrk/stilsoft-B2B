import React, { useState } from 'react';
import { StyleSheet, Text, View, ViewStyle, StyleProp, TouchableOpacity } from 'react-native';

interface StatCardProps {
  icon: React.ReactNode;
  value: string | number;
  label: string;
  iconBgColor?: string;
  style?: StyleProp<ViewStyle>;
}

import { useThemeStore } from '../../shared/theme/store';

export default function StatCard({
  icon,
  value,
  label,
  iconBgColor = 'rgba(255, 255, 255, 0.05)',
  style,
}: StatCardProps) {
  const theme = useThemeStore((s) => s.theme);
  const isDark = theme === 'dark';
  const [showFull, setShowFull] = useState(false);

  const displayVal = (() => {
    const parsed = Number(value);
    if (!isNaN(parsed) && parsed > 999) {
      return showFull ? String(value) : '999+';
    }
    return String(value);
  })();

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={() => setShowFull(!showFull)}
      style={[
        styles.card,
        {
          backgroundColor: isDark ? 'rgba(255, 255, 255, 0.03)' : '#ffffff',
          borderColor: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.07)',
        },
        style,
      ]}
    >
      <View style={[styles.iconContainer, { backgroundColor: iconBgColor }]}>
        {icon}
      </View>
      <Text style={[styles.value, { color: isDark ? '#fff' : '#111827' }]} numberOfLines={1}>
        {displayVal}
      </Text>
      <Text style={[styles.label, { color: isDark ? 'rgba(255, 255, 255, 0.45)' : '#6b7280' }]} numberOfLines={1}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minWidth: '30%',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 14,
    padding: 12,
    alignItems: 'flex-start',
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  value: {
    fontSize: 20,
    fontWeight: '800',
    color: '#fff',
    marginBottom: 2,
  },
  label: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.45)',
    fontWeight: '600',
  },
});
