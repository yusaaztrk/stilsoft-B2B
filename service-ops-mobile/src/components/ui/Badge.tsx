import React from 'react';
import { StyleSheet, Text, View, ViewStyle, TextStyle, StyleProp } from 'react-native';

export type BadgeType = 'success' | 'warning' | 'error' | 'info' | 'neutral';

interface BadgeProps {
  label: string;
  type?: BadgeType;
  customBg?: string;
  customText?: string;
  style?: StyleProp<ViewStyle>;
}

import { useThemeStore } from '../../shared/theme/store';

const BADGE_STYLES: Record<Exclude<BadgeType, 'neutral'>, { bg: string; text: string }> = {
  success: { bg: 'rgba(16, 185, 129, 0.15)', text: '#10b981' },
  warning: { bg: 'rgba(245, 158, 11, 0.15)', text: '#f59e0b' },
  error: { bg: 'rgba(239, 68, 68, 0.15)', text: '#ef4444' },
  info: { bg: 'rgba(59, 130, 246, 0.15)', text: '#3b82f6' },
};

export default function Badge({
  label,
  type = 'neutral',
  customBg,
  customText,
  style,
}: BadgeProps) {
  const theme = useThemeStore((s) => s.theme);
  const isDark = theme === 'dark';

  const neutralStyle = isDark
    ? { bg: 'rgba(255, 255, 255, 0.08)', text: 'rgba(255, 255, 255, 0.6)' }
    : { bg: 'rgba(0, 0, 0, 0.06)', text: 'rgba(0, 0, 0, 0.6)' };

  const selectedStyle = type === 'neutral' ? neutralStyle : (BADGE_STYLES[type] || neutralStyle);
  const bgStyle: ViewStyle = { backgroundColor: customBg || selectedStyle.bg };
  const textStyle: TextStyle = { color: customText || selectedStyle.text };

  return (
    <View style={[styles.badge, bgStyle, style]}>
      <Text style={[styles.text, textStyle]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  text: {
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
});
