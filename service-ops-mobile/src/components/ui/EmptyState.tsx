import React from 'react';
import { StyleSheet, Text, View, ViewStyle, StyleProp } from 'react-native';

interface EmptyStateProps {
  message: string;
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

import { useThemeStore } from '../../shared/theme/store';

export default function EmptyState({ message, icon, style }: EmptyStateProps) {
  const theme = useThemeStore((s) => s.theme);
  const isDark = theme === 'dark';

  return (
    <View style={[styles.container, style]}>
      {icon && <View style={styles.iconContainer}>{icon}</View>}
      <Text style={[styles.text, { color: isDark ? 'rgba(255, 255, 255, 0.4)' : 'rgba(0, 0, 0, 0.4)' }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconContainer: {
    marginBottom: 12,
    opacity: 0.5,
  },
  text: {
    color: 'rgba(255, 255, 255, 0.4)',
    textAlign: 'center',
    fontSize: 14,
    fontStyle: 'italic',
    lineHeight: 20,
  },
});
