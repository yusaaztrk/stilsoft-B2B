import React, { useMemo } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { useSessionStore } from '../../shared/session/store';
import { apiJson } from '../../shared/api/client';
import {
  Wrench,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Users,
  Timer,
  TrendingUp,
  Package,
  ChevronRight,
} from 'lucide-react-native';
import Card from '../../components/ui/Card';
import { useThemeColors, useThemeStore, type ThemeColors } from '../../shared/theme/store';
import StatCard from '../../components/ui/StatCard';
import ProgressBar from '../../components/ui/ProgressBar';
import Badge from '../../components/ui/Badge';
import Spinner from '../../components/ui/Spinner';

const TURKISH_MONTHS = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
];
const TURKISH_DAYS = [
  'Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi',
];

function getTurkishDate(): string {
  const d = new Date();
  return `${d.getDate()} ${TURKISH_MONTHS[d.getMonth()]} ${d.getFullYear()}, ${TURKISH_DAYS[d.getDay()]}`;
}

function getStatusLabel(status: string) {
  const map: Record<string, string> = {
    'New': 'Yeni',
    'Planned': 'Planlandı',
    'Workshop': 'Atölyede',
    'OnField': 'Sahada',
    'Ready': 'Hazır',
    'Completed': 'Tamamlandı',
    'Delivered': 'Teslim Edildi',
    'Cancelled': 'İptal',
    'Deferred': 'Ertelendi',
  };
  return map[status] ?? status;
}

export default function AdminDashboardScreen() {
  const colors = useThemeColors();
  const theme = useThemeStore((s) => s.theme);
  const isDark = theme === 'dark';
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);

  const navigation = useNavigation<any>();
  const { username, tenantCode } = useSessionStore();

  const statusCountsQ = useQuery({
    queryKey: ['servicerecords', 'status-counts'],
    queryFn: ({ signal }) => apiJson<Record<string, number>>('/api/servicerecords/status-counts', { signal }),
    refetchInterval: 60_000,
  });

  const todayQ = useQuery({
    queryKey: ['servicerecords', 'today'],
    queryFn: ({ signal }) => apiJson<any[]>('/api/servicerecords/today', { signal }),
    refetchInterval: 60_000,
  });

  const delayedQ = useQuery({
    queryKey: ['servicerecords', 'delayed'],
    queryFn: ({ signal }) => apiJson<any[]>('/api/servicerecords/delayed', { signal }),
    refetchInterval: 60_000,
  });

  const techniciansQ = useQuery({
    queryKey: ['technicians', 'available'],
    queryFn: ({ signal }) => apiJson<any[]>('/api/technicians?availableOnly=true', { signal }).catch(() => []),
    refetchInterval: 120_000,
  });

  const statusCounts = statusCountsQ.data ?? {};
  const today = todayQ.data ?? [];
  const delayed = delayedQ.data ?? [];
  const technicians = techniciansQ.data ?? [];

  const total = useMemo(() => Object.values(statusCounts).reduce((a, n) => a + (Number(n) || 0), 0), [statusCounts]);
  const pending = (statusCounts['New'] ?? 0) + (statusCounts['Workshop'] ?? 0) + (statusCounts['WaitingForParts'] ?? 0);
  const completedToday = today.filter((s: any) => s.status === 'Delivered' || s.status === 'Ready' || s.status === 'Completed').length;
  const isLoading = statusCountsQ.isLoading;

  const completionRate = total > 0 ? Math.round(((statusCounts['Delivered'] ?? 0) + (statusCounts['Ready'] ?? 0) + (statusCounts['Completed'] ?? 0)) / total * 100) : 0;
  const delayRate = total > 0 ? Math.round(delayed.length / total * 100) : 0;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={[styles.orb, styles.orb1]} />
      <View style={[styles.orb, styles.orb2]} />

      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.greeting}>Hoş geldin, {username}</Text>
          <Text style={styles.dateText}>📅 {getTurkishDate()}</Text>
        </View>

        {isLoading ? (
          <Spinner style={{ marginTop: 60 }} />
        ) : (
          <>
            {/* Stats Grid */}
            <View style={styles.statsGrid}>
              <StatCard
                icon={<Wrench color="#3b82f6" size={22} />}
                value={today.length}
                label="Bugünkü İşler"
                iconBgColor="rgba(59, 130, 246, 0.12)"
              />
              <StatCard
                icon={<Clock color="#f59e0b" size={22} />}
                value={pending}
                label="Bekleyen İşler"
                iconBgColor="rgba(245, 158, 11, 0.12)"
              />
              <StatCard
                icon={<Package color="#10b981" size={22} />}
                value={total}
                label="Toplam Servis"
                iconBgColor="rgba(16, 185, 129, 0.12)"
              />
            </View>

            <View style={[styles.statsGrid, { marginTop: 14 }]}>
              <StatCard
                icon={<CheckCircle2 color="#10b981" size={22} />}
                value={completedToday}
                label="Tamamlanan Bugün"
                iconBgColor="rgba(16, 185, 129, 0.12)"
              />
              <StatCard
                icon={<Users color="#3b82f6" size={22} />}
                value={technicians.length}
                label="Aktif Teknisyen"
                iconBgColor="rgba(59, 130, 246, 0.12)"
              />
              <StatCard
                icon={<AlertTriangle color="#ef4444" size={22} />}
                value={delayed.length}
                label="Geciken İşler"
                iconBgColor="rgba(239, 68, 68, 0.12)"
              />
            </View>

            {/* Operasyon Nabzı */}
            <Card style={styles.sectionCard}>
              <View style={styles.sectionHeader}>
                <TrendingUp color="#B91C1C" size={18} />
                <Text style={styles.sectionTitle}>Operasyon Nabzı</Text>
              </View>

              <View style={styles.progressRow}>
                <View style={styles.progressLabel}>
                  <View style={[styles.dot, { backgroundColor: '#10b981' }]} />
                  <Text style={styles.progressText}>Tamamlanma</Text>
                </View>
                <Text style={styles.progressValue}>{completionRate}%</Text>
              </View>
              <ProgressBar progress={completionRate} color="#10b981" style={{ marginBottom: 16 }} />

              <View style={styles.progressRow}>
                <View style={styles.progressLabel}>
                  <View style={[styles.dot, { backgroundColor: '#ef4444' }]} />
                  <Text style={styles.progressText}>Geciken</Text>
                </View>
                <Text style={styles.progressValue}>{delayRate}%</Text>
              </View>
              <ProgressBar progress={delayRate} color="#ef4444" />

              {/* Summary counts */}
              <View style={styles.summaryRow}>
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryCount}>{total}</Text>
                  <Text style={styles.summaryLabel}>Toplam</Text>
                </View>
                <View style={[styles.summaryItem, styles.summaryDivider]}>
                  <Text style={styles.summaryCount}>{pending}</Text>
                  <Text style={styles.summaryLabel}>Aktif</Text>
                </View>
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryCount}>{(statusCounts['Cancelled'] ?? 0)}</Text>
                  <Text style={styles.summaryLabel}>İptal</Text>
                </View>
              </View>
            </Card>

            {/* Son Servis Kayıtları */}
            <Card style={styles.sectionCard}>
              <View style={styles.sectionHeader}>
                <Timer color="#B91C1C" size={18} />
                <Text style={styles.sectionTitle}>Son Servis Kayıtları</Text>
              </View>

              {today.length === 0 ? (
                <Text style={styles.emptyText}>Bugün için kayıt bulunmuyor.</Text>
              ) : (
                today.slice(0, 6).map((s: any, i: number) => (
                  <TouchableOpacity
                    key={s.id || i}
                    style={styles.recentRow}
                    activeOpacity={0.7}
                    onPress={() => navigation.navigate('ServiceRecordDetail', { serviceId: s.id })}
                  >
                    <View style={styles.recentLeft}>
                      <Text style={styles.recentNumber}>{s.serviceNumber}</Text>
                      <Text style={styles.recentCustomer} numberOfLines={1}>
                        {s.customerName || '-'}
                      </Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Badge
                        label={getStatusLabel(s.statusLabel || s.status)}
                        type={
                          s.status === 'New' ? 'info' :
                          s.status === 'Workshop' ? 'warning' :
                          s.status === 'Delivered' || s.status === 'Ready' || s.status === 'Completed' ? 'success' :
                          'neutral'
                        }
                      />
                      <ChevronRight color="rgba(255,255,255,0.3)" size={16} />
                    </View>
                  </TouchableOpacity>
                ))
              )}
            </Card>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (colors: ThemeColors, isDark: boolean) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  orb: { position: 'absolute', borderRadius: 9999 },
  orb1: { top: '-10%', left: '-10%', width: '60%', height: '40%', backgroundColor: colors.orb1 },
  orb2: { bottom: '0%', right: '-20%', width: '70%', height: '50%', backgroundColor: colors.orb2 },

  container: { padding: 16, paddingBottom: 95, maxWidth: 650, width: '100%', alignSelf: 'center' },

  header: { marginBottom: 20, paddingTop: 8 },
  greeting: { fontSize: 26, fontWeight: '800', color: colors.text, marginBottom: 6 },
  dateText: { fontSize: 14, color: colors.textSub, fontWeight: '500' },

  statsGrid: { flexDirection: 'row', gap: 10, width: '100%' },

  sectionCard: {
    padding: 18,
    marginBottom: 16,
    marginTop: 22,
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.text, marginLeft: 8 },

  progressRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  progressLabel: { flexDirection: 'row', alignItems: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  progressText: { fontSize: 13, color: colors.textSub, fontWeight: '600' },
  progressValue: { fontSize: 13, color: colors.text, fontWeight: '700' },

  summaryRow: {
    flexDirection: 'row',
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryDivider: { borderLeftWidth: 1, borderRightWidth: 1, borderColor: colors.divider },
  summaryCount: { fontSize: 20, fontWeight: '800', color: colors.text, marginBottom: 2 },
  summaryLabel: { fontSize: 11, color: colors.textSub, fontWeight: '600' },

  emptyText: { color: colors.textSub, textAlign: 'center', paddingVertical: 16 },

  recentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  recentLeft: { flex: 1, paddingRight: 12 },
  recentNumber: { fontSize: 13, fontWeight: '700', color: '#B91C1C', marginBottom: 2 },
  recentCustomer: { fontSize: 12, color: colors.textSub },
});
