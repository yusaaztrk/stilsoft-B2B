import React, { useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { Briefcase, Clock, CheckCircle, AlertTriangle, Package, User, ChevronRight } from 'lucide-react-native';
import { useSessionStore } from '../../shared/session/store';
import { useThemeColors, useThemeStore, type ThemeColors } from '../../shared/theme/store';
import { getStatusLabel, getStatusBadgeType } from '../../shared/utils/statusTranslator';
import { fetchDelayedServices, fetchStatusCounts, fetchTodayServices } from './serviceRecordsApi';
import type { ServiceRecord } from './serviceRecordsApi';
import { useAutoRefetch } from '../../shared/hooks/useAutoRefetch';
import { useSignalR } from '../../shared/hooks/useSignalR';
import Card from '../../components/ui/Card';
import Badge, { BadgeType } from '../../components/ui/Badge';
import Spinner from '../../components/ui/Spinner';
import StatCard from '../../components/ui/StatCard';
import EmptyState from '../../components/ui/EmptyState';

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

const STATUS_MAPPING: Record<string, { label: string; type: BadgeType }> = {
  Delivered: { label: 'Teslim Edildi', type: 'success' },
  Ready: { label: 'Hazır', type: 'success' },
  New: { label: 'Yeni', type: 'info' },
  Workshop: { label: 'Atölyede', type: 'warning' },
  delayed: { label: 'Gecikmiş', type: 'error' },
};

function ServiceCard({
  record,
  variant = 'default',
}: {
  record: ServiceRecord;
  variant?: 'default' | 'delayed';
}) {
  const isDelayed = variant === 'delayed';
  const navigation = useNavigation<any>();

  const handlePress = () => {
    if (record.type === 'Installation') {
      navigation.navigate('InstallationDetail', { serviceId: record.id });
    } else if (record.type === 'Repair') {
      navigation.navigate('RepairDetail', { serviceId: record.id });
    } else {
      navigation.navigate('ServiceRecordDetail', { serviceId: record.id });
    }
  };

  const colors = useThemeColors();
  const theme = useThemeStore((s) => s.theme);
  const isDark = theme === 'dark';
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);

  const lookupKey = Object.keys(STATUS_MAPPING).find(
    (k) => k.toLowerCase() === (record.status ?? '').toLowerCase()
  );
  const badgeInfo = isDelayed
    ? STATUS_MAPPING.delayed
    : (lookupKey ? STATUS_MAPPING[lookupKey] : { label: getStatusLabel(record.status, record.statusLabel), type: getStatusBadgeType(record.status) });

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={handlePress}
    >
      <Card style={[styles.serviceCard, isDelayed && styles.serviceCardDelayed]}>
        <View style={styles.serviceCardHeader}>
          <View style={styles.serviceNumberWrap}>
            <Text style={styles.serviceNumber}>#{record.serviceNumber}</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Badge label={badgeInfo.label} type={badgeInfo.type} />
            <ChevronRight color={colors.textSub} size={16} />
          </View>
        </View>

        <View style={styles.serviceCardBody}>
          {record.customerName ? (
            <View style={styles.serviceDetailRow}>
              <User size={13} color={colors.textSub} />
              <Text style={styles.serviceDetailText} numberOfLines={1}>
                {record.customerName}
              </Text>
            </View>
          ) : null}

          {record.productName ? (
            <View style={styles.serviceDetailRow}>
              <Package size={13} color={colors.textSub} />
              <Text style={styles.serviceDetailText} numberOfLines={1}>
                {record.productName}
              </Text>
            </View>
          ) : null}
        </View>
      </Card>
    </TouchableOpacity>
  );
}

function SectionHeader({
  icon,
  title,
  count,
  styles,
}: {
  icon: React.ReactNode;
  title: string;
  count?: number;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionHeaderLeft}>
        {icon}
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      {count !== undefined && (
        <View style={styles.sectionCountBadge}>
          <Text style={styles.sectionCountText}>{count}</Text>
        </View>
      )}
    </View>
  );
}

export default function JobsScreen() {
  const username = useSessionStore((s) => s.username);
  const [todayExpanded, setTodayExpanded] = useState(false);
  const [delayedExpanded, setDelayedExpanded] = useState(false);
  const colors = useThemeColors();
  const theme = useThemeStore((s) => s.theme);
  const isDark = theme === 'dark';
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);

  // Refresh data on screen focus for cross-device sync (polling fallback)
  useAutoRefetch(['servicerecords']);
  // Real-time sync via SignalR
  useSignalR(['service_record_updated', 'installation_updated']);

  const statusCountsQuery = useQuery({
    queryKey: ['servicerecords', 'status-counts'],
    queryFn: ({ signal }) => fetchStatusCounts(signal),
    refetchInterval: 60_000,
  });

  const todayQuery = useQuery({
    queryKey: ['servicerecords', 'today'],
    queryFn: ({ signal }) => fetchTodayServices(signal),
    refetchInterval: 60_000,
  });

  const delayedQuery = useQuery({
    queryKey: ['servicerecords', 'delayed'],
    queryFn: ({ signal }) => fetchDelayedServices(signal),
    refetchInterval: 60_000,
  });

  const isLoading =
    statusCountsQuery.isLoading || todayQuery.isLoading || delayedQuery.isLoading;
  const hasError =
    statusCountsQuery.isError || todayQuery.isError || delayedQuery.isError;
  const errorMessage =
    (statusCountsQuery.error instanceof Error ? statusCountsQuery.error.message : null) ||
    (todayQuery.error instanceof Error ? todayQuery.error.message : null) ||
    (delayedQuery.error instanceof Error ? delayedQuery.error.message : null) ||
    null;

  const statusCounts = statusCountsQuery.data ?? {};
  const today = todayQuery.data ?? [];
  const delayed = delayedQuery.data ?? [];

  const stats = useMemo(() => {
    const total = Object.values(statusCounts).reduce((a, n) => a + (Number(n) || 0), 0);
    const pending = (statusCounts['New'] ?? 0) + (statusCounts['Workshop'] ?? 0);
    const completedToday = today.filter(
      (s) => s.status === 'Delivered' || s.status === 'Ready',
    ).length;
    return { total, pending, completedToday, delayedCount: delayed.length };
  }, [statusCounts, today, delayed]);

  const turkishDate = useMemo(() => getTurkishDate(), []);

  return (
    <SafeAreaView style={styles.safe}>
      {/* Decorative gradient orbs */}
      <View style={styles.orbTopRight} />
      <View style={styles.orbBottomLeft} />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={false}
            onRefresh={() => {
              statusCountsQuery.refetch();
              todayQuery.refetch();
              delayedQuery.refetch();
            }}
            tintColor="#B91C1C"
            colors={['#B91C1C']}
          />
        }
      >
        {/* Greeting */}
        <View style={styles.greetingSection}>
          <Text style={styles.greetingSmall}>Merhabaa,</Text>
          <Text style={styles.greetingName}>{username ?? 'Teknisyen'}</Text>
          <Text style={styles.greetingDate}>{turkishDate}</Text>
        </View>

        {/* Loading / Error */}
        {isLoading && (
          <Spinner style={styles.loaderSpinner} />
        )}

        {hasError && (
          <View style={styles.errorCard}>
            <AlertTriangle size={18} color="#ef4444" />
            <Text style={styles.errorText}>
              {errorMessage ?? 'Bilinmeyen bir hata oluştu'}
            </Text>
          </View>
        )}

        {/* Summary Stats 2×2 */}
        {!isLoading && (
          <View style={styles.statsGrid}>
            <StatCard
              icon={<Briefcase size={20} color="#3b82f6" />}
              label="Toplam Servis"
              value={stats.total}
              iconBgColor="rgba(59, 130, 246, 0.1)"
            />
            <StatCard
              icon={<Clock size={20} color="#eab308" />}
              label="Bekleyen İşler"
              value={stats.pending}
              iconBgColor="rgba(234, 179, 8, 0.1)"
            />
            <StatCard
              icon={<CheckCircle size={20} color="#22c55e" />}
              label="Bugün Tamamlanan"
              value={stats.completedToday}
              iconBgColor="rgba(34, 197, 94, 0.1)"
            />
            <StatCard
              icon={<AlertTriangle size={20} color="#ef4444" />}
              label="Geciken İşler"
              value={stats.delayedCount}
              iconBgColor="rgba(239, 68, 68, 0.1)"
            />
          </View>
        )}

        {/* Today's Jobs */}
        {!isLoading && today.length > 0 && (
          <View style={styles.section}>
            <SectionHeader
              icon={<Briefcase size={18} color="#B91C1C" />}
              title="Bugünkü İşlerim"
              count={today.length}
              styles={styles}
            />
            {(todayExpanded ? today : today.slice(0, 5)).map((record) => (
              <ServiceCard key={record.id} record={record} />
            ))}
            {today.length > 5 && (
              <TouchableOpacity onPress={() => setTodayExpanded(!todayExpanded)} style={{ paddingVertical: 10 }}>
                <Text style={styles.moreText}>
                  {todayExpanded ? '▲ Daha az göster' : `▼ +${today.length - 5} iş daha… (Tümünü Göster)`}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {!isLoading && today.length === 0 && !hasError && (
          <View style={styles.section}>
            <SectionHeader
              icon={<Briefcase size={18} color="#B91C1C" />}
              title="Bugünkü İşlerim"
              styles={styles}
            />
            <EmptyState message="Bugün için planlanmış iş yok" />
          </View>
        )}

        {/* Delayed Jobs */}
        {!isLoading && delayed.length > 0 && (
          <View style={styles.section}>
            <SectionHeader
              icon={<AlertTriangle size={18} color="#ef4444" />}
              title="Geciken İşler"
              count={delayed.length}
              styles={styles}
            />
            {(delayedExpanded ? delayed : delayed.slice(0, 5)).map((record) => (
              <ServiceCard key={record.id} record={record} variant="delayed" />
            ))}
            {delayed.length > 5 && (
              <TouchableOpacity onPress={() => setDelayedExpanded(!delayedExpanded)} style={{ paddingVertical: 10 }}>
                <Text style={styles.moreText}>
                  {delayedExpanded ? '▲ Daha az göster' : `▼ +${delayed.length - 5} iş daha… (Tümünü Göster)`}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        <View style={styles.bottomSpacer} />
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (colors: ThemeColors, isDark: boolean) => StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 40,
    maxWidth: 650,
    width: '100%',
    alignSelf: 'center',
  },
  bottomSpacer: {
    height: 24,
  },
  orbTopRight: {
    position: 'absolute',
    top: -80,
    right: -80,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: colors.orb1,
  },
  orbBottomLeft: {
    position: 'absolute',
    bottom: -60,
    left: -60,
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: colors.orb2,
  },

  greetingSection: {
    marginBottom: 28,
    marginTop: 8,
  },
  greetingSmall: {
    fontSize: 16,
    color: colors.textSub,
    fontWeight: '400',
  },
  greetingName: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.text,
    marginTop: 2,
  },
  greetingDate: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 6,
    letterSpacing: 0.3,
  },

  loaderSpinner: {
    paddingVertical: 40,
  },
  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(239,68,68,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.25)',
    borderRadius: 12,
    padding: 14,
    marginBottom: 20,
  },
  errorText: {
    color: '#ef4444',
    fontSize: 14,
    flex: 1,
  },

  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 28,
  },

  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  sectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
  },
  sectionCountBadge: {
    backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
  },
  sectionCountText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSub,
  },

  serviceCard: {
    marginBottom: 10,
  },
  serviceCardDelayed: {
    borderColor: 'rgba(239,68,68,0.3)',
    backgroundColor: 'rgba(239,68,68,0.05)',
  },
  serviceCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  serviceNumberWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  serviceNumber: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  serviceCardBody: {
    gap: 6,
  },
  serviceDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  serviceDetailText: {
    fontSize: 13,
    color: colors.textSub,
    flex: 1,
  },

  moreText: {
    textAlign: 'center',
    color: colors.textMuted,
    fontSize: 13,
    marginTop: 4,
  },
});
