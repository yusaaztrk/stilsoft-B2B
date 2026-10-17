import React from 'react';
import { StyleSheet, View, ViewStyle, StyleProp } from 'react-native';

interface ProgressBarProps {
  progress: number; // Percentage value (0 - 100)
  color?: string;
  height?: number;
  style?: StyleProp<ViewStyle>;
}

import { useThemeStore } from '../../shared/theme/store';

export default function ProgressBar({
  progress,
  color = '#10b981',
  height = 6,
  style,
}: ProgressBarProps) {
  const theme = useThemeStore((s) => s.theme);
  const isDark = theme === 'dark';
  const clampedProgress = Math.max(0, Math.min(100, progress));

  return (
    <View
      style={[
        styles.container,
        {
          height,
          borderRadius: height / 2,
          backgroundColor: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.08)',
        },
        style,
      ]}
    >
      <View
        style={[
          styles.fill,
          {
            width: `${clampedProgress}%`,
            backgroundColor: color,
            borderRadius: height / 2,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
  },
});
