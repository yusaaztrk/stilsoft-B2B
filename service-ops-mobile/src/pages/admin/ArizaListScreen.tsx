import React from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { ArizaStackParamList } from '../../app/ArizaStack';
import { useQuery } from '@tanstack/react-query';
import { fetchServiceRecordsPaged } from '../technician/serviceRecordsApi';
import { Wrench, Truck, ChevronRight } from 'lucide-react-native';
import { useThemeColors, useThemeStore, type ThemeColors } from '../../shared/theme/store';

export default function ArizaListScreen() {
  const colors = useThemeColors();
  const theme = useThemeStore((s) => s.theme);
  const isDark = theme === 'dark';
  const styles = React.useMemo(() => createStyles(colors, isDark), [colors, isDark]);

  const navigation = useNavigation<NativeStackNavigationProp<ArizaStackParamList>>();

  // Bekleyen sayıları için özet sorgular
  const atolyePendingQuery = useQuery({
    queryKey: ['ariza', 'count', 'atolye'],
    queryFn: ({ signal }) =>
      fetchServiceRecordsPaged({ type: 'Repair', statuses: 'New,Planned', pageSize: 1 }, signal),
    staleTime: 30_000,
  });

  const sahaPendingQuery = useQuery({
    queryKey: ['ariza', 'count', 'saha'],
    queryFn: ({ signal }) =>
      fetchServiceRecordsPaged({ type: 'Repair', statuses: 'Workshop,InRepair,WaitingForParts', pageSize: 1 }, signal),
    staleTime: 30_000,
  });

  const atolyeCount = atolyePendingQuery.data?.totalCount ?? 0;
  const sahaCount = sahaPendingQuery.data?.totalCount ?? 0;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={[styles.orb, styles.orb1]} />
      <View style={[styles.orb, styles.orb2]} />

      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Arıza Yönetimi</Text>
          <Text style={styles.subtitle}>Atölye ve saha ürün arızalarını yönetin.</Text>
        </View>

        {/* Atölye Arıza Kartı */}
        <TouchableOpacity
          style={styles.card}
          activeOpacity={0.8}
          onPress={() => navigation.navigate('AtolyeAriza')}
        >
          <View style={[styles.cardIcon, { backgroundColor: 'rgba(245,127,23,0.15)' }]}>
            <Wrench color="#F57F17" size={28} />
          </View>
          <View style={styles.cardContent}>
            <Text style={styles.cardTitle}>Atölye Ürün Arıza</Text>
            <Text style={styles.cardDesc}>Küçük ev aletleri ve atölyeye teslim edilen cihazlar</Text>
            {atolyeCount > 0 && (
              <View style={styles.countBadge}>
                <Text style={styles.countBadgeText}>{atolyeCount} bekleyen</Text>
              </View>
            )}
          </View>
          <ChevronRight color={colors.textSub} size={20} />
        </TouchableOpacity>

        {/* Saha Arıza Kartı */}
        <TouchableOpacity
          style={styles.card}
          activeOpacity={0.8}
          onPress={() => navigation.navigate('SahaAriza')}
        >
          <View style={[styles.cardIcon, { backgroundColor: 'rgba(185,28,28,0.15)' }]}>
            <Truck color="#B91C1C" size={28} />
          </View>
          <View style={styles.cardContent}>
            <Text style={styles.cardTitle}>Saha Ürün Arıza</Text>
            <Text style={styles.cardDesc}>Montajlı ve büyük hacimli saha ürünlerinin arıza takibi</Text>
            {sahaCount > 0 && (
              <View style={[styles.countBadge, { backgroundColor: 'rgba(185,28,28,0.2)', borderColor: 'rgba(185,28,28,0.4)' }]}>
                <Text style={[styles.countBadgeText, { color: '#ef4444' }]}>{sahaCount} aktif</Text>
              </View>
            )}
          </View>
          <ChevronRight color={colors.textSub} size={20} />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const createStyles = (colors: ThemeColors, isDark: boolean) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  orb: { position: 'absolute', borderRadius: 9999 },
  orb1: { top: '-10%', left: '-10%', width: '60%', height: '40%', backgroundColor: colors.orb1 },
  orb2: { bottom: 0, right: '-20%', width: '70%', height: '50%', backgroundColor: colors.orb2 },

  container: { flex: 1, padding: 20, maxWidth: 650, width: '100%', alignSelf: 'center' },

  header: { marginBottom: 32, paddingTop: 8 },
  title: { fontSize: 30, fontWeight: '800', color: colors.text },
  subtitle: { fontSize: 14, color: colors.textSub, marginTop: 4 },

  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    borderRadius: 20,
    padding: 20,
    marginBottom: 16,
    gap: 16,
  },
  cardIcon: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardContent: { flex: 1 },
  cardTitle: { fontSize: 18, fontWeight: '800', color: colors.text, marginBottom: 4 },
  cardDesc: { fontSize: 13, color: colors.textSub, lineHeight: 18 },
  countBadge: {
    marginTop: 8,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(245,127,23,0.2)',
    borderWidth: 1,
    borderColor: 'rgba(245,127,23,0.4)',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  countBadgeText: { fontSize: 12, fontWeight: '700', color: '#F57F17' },
});
