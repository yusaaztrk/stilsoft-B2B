import React, { useMemo, useState, useEffect } from 'react';
import {
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useSessionStore } from '../../shared/session/store';
import { fetchErpProducts } from '../admin/erpApi';
import type { RepairStackParamList } from '../../app/RepairStack';
import { fetchServiceRecordsPaged, PagedResult, ServiceRecord } from './serviceRecordsApi';
import { ChevronLeft, ChevronRight, MapPin, Package } from 'lucide-react-native';
import Card from '../../components/ui/Card';
import Badge, { BadgeType } from '../../components/ui/Badge';
import Spinner from '../../components/ui/Spinner';
import { useThemeColors, useThemeStore, type ThemeColors } from '../../shared/theme/store';
import { getStatusLabel, getStatusBadgeType } from '../../shared/utils/statusTranslator';
import { useAutoRefetch } from '../../shared/hooks/useAutoRefetch';
import { useSignalR } from '../../shared/hooks/useSignalR';

const STATUS_MAPPING: Record<string, { label: string; type: BadgeType }> = {
  New: { label: 'Yeni', type: 'neutral' },
  Planned: { label: 'Planlandı', type: 'info' },
  Workshop: { label: 'Atölyede', type: 'warning' },
  InRepair: { label: 'Tamirde', type: 'warning' },
  WaitingForParts: { label: 'Parça Bekliyor', type: 'error' },
  Ready: { label: 'Hazır', type: 'success' },
  Delivered: { label: 'Teslim Edildi', type: 'success' },
  Cancelled: { label: 'İptal', type: 'error' },
};

export default function RepairsScreen() {
  const colors = useThemeColors();
  const theme = useThemeStore((s) => s.theme);
  const isDark = theme === 'dark';
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);

  const navigation = useNavigation<NativeStackNavigationProp<RepairStackParamList>>();
  const route = useRoute<any>();
  const repairKind = route.params?.repairKind ?? 'saha';

  const technicianId = useSessionStore((s) => s.technicianId);
  const [tab, setTab] = useState<'pending' | 'active'>('pending');
  const [page, setPage] = useState(1);
  const pageSize = 20;

  // Auto-refresh when screen gains focus + every 30s while focused (polling fallback)
  useAutoRefetch(['servicerecords', 'all-repairs']);
  // Real-time sync via SignalR
  useSignalR(['service_record_updated']);

  const erpProductsQuery = useQuery({
    queryKey: ['erpProducts'],
    queryFn: () => fetchErpProducts(),
  });
  const erpProducts = erpProductsQuery.data ?? [];
  const erpLoading = erpProductsQuery.isLoading;

  const query = useQuery<PagedResult<ServiceRecord>>({
    queryKey: ['servicerecords', 'all-repairs', technicianId],
    queryFn: ({ signal }) =>
      fetchServiceRecordsPaged(
        {
          type: 'Repair',
          statuses: 'New,Planned,Workshop,InRepair,WaitingForParts,Ready',
          technicianId: technicianId ?? undefined,
          page: 1,
          pageSize: 1000,
        },
        signal
      ),
    placeholderData: keepPreviousData,
  });

  const rawItems = query.data?.items ?? [];

  const filteredItems = useMemo(() => {
    if (erpLoading) return [];

    const installableNames = new Set(
      erpProducts.filter((p) => p.isInstallable).map((p) => p.name.trim().toLowerCase())
    );

    // Saha vs Atolye filter
    const kindFiltered = rawItems.filter((r) => {
      const isInstallable = installableNames.has((r.productName || '').trim().toLowerCase());
      return repairKind === 'saha' ? isInstallable : !isInstallable;
    });

    // Tab filter
    return kindFiltered.filter((r) => {
      if (tab === 'pending') {
        return r.status === 'New' || r.status === 'Planned';
      } else {
        return r.status !== 'New' && r.status !== 'Planned' && r.status !== 'Cancelled';
      }
    });
  }, [rawItems, erpProducts, erpLoading, repairKind, tab]);

  const totalCount = filteredItems.length;
  const totalPages = Math.ceil(totalCount / pageSize) || 1;
  const items = useMemo(() => {
    return filteredItems.slice((page - 1) * pageSize, page * pageSize);
  }, [filteredItems, page, pageSize]);

  const onChangeTab = (next: 'pending' | 'active') => {
    setTab(next);
    setPage(1);
  };

  const renderItem = ({ item }: { item: ServiceRecord }) => {
    const lookupKey = Object.keys(STATUS_MAPPING).find(
      (k) => k.toLowerCase() === (item.status ?? '').toLowerCase()
    );
    const badgeInfo = lookupKey ? STATUS_MAPPING[lookupKey] : { label: getStatusLabel(item.status, item.statusLabel), type: getStatusBadgeType(item.status) };

    return (
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => navigation.navigate('RepairDetail', { serviceId: item.id })}
      >
        <Card style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.serviceNumber}>{item.serviceNumber}</Text>
            <Badge label={badgeInfo.label} type={badgeInfo.type} />
          </View>

          <Text style={styles.customerName} numberOfLines={1}>{item.customerName || 'İsimsiz Müşteri'}</Text>
          
          <View style={styles.infoRow}>
            <Package color={colors.textMuted} size={14} style={{marginRight: 6}} />
            <Text style={styles.infoText} numberOfLines={1}>{item.productName || 'Ürün Belirtilmemiş'}</Text>
          </View>

          <View style={styles.infoRow}>
            <MapPin color={colors.textMuted} size={14} style={{marginRight: 6}} />
            <Text style={styles.infoText} numberOfLines={1}>{item.regionName || 'Bölge Belirtilmemiş'}</Text>
          </View>
        </Card>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={[styles.orb, styles.orb1]} />
      <View style={[styles.orb, styles.orb2]} />

      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>{repairKind === 'saha' ? 'Saha Arıza' : 'Atölye Arıza'}</Text>
          <Text style={styles.subtitle}>{repairKind === 'saha' ? 'Saha arıza kayıtları' : 'Atölye arıza kayıtları'}</Text>
        </View>

        <View style={styles.tabContainer}>
          <TouchableOpacity
            style={[styles.tab, tab === 'pending' && styles.tabActive]}
            onPress={() => onChangeTab('pending')}
          >
            <Text style={[styles.tabText, tab === 'pending' && styles.tabTextActive]}>BEKLEYEN</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, tab === 'active' && styles.tabActive]}
            onPress={() => onChangeTab('active')}
          >
            <Text style={[styles.tabText, tab === 'active' && styles.tabTextActive]}>AKTİF</Text>
          </TouchableOpacity>
        </View>

        {query.isLoading && !query.data ? (
          <Spinner style={styles.loader} />
        ) : query.isError ? (
          <Text style={styles.errorText}>Hata: {query.error instanceof Error ? query.error.message : 'Bilinmeyen hata'}</Text>
        ) : (
          <FlatList
            data={items}
            keyExtractor={(x) => x.id}
            showsVerticalScrollIndicator={false}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            onRefresh={() => query.refetch()}
            refreshing={false}
            ListEmptyComponent={() => (
              <Text style={styles.emptyText}>Bu kategoride kayıt bulunamadı.</Text>
            )}
          />
        )}

        <View style={styles.pagerRow}>
          <TouchableOpacity 
            style={[styles.pageBtn, page <= 1 && styles.pageBtnDisabled]} 
            onPress={() => setPage((p) => Math.max(1, p - 1))} 
            disabled={page <= 1}
          >
            <ChevronLeft color={page <= 1 ? colors.textMuted : colors.text} size={24} />
          </TouchableOpacity>
          
          <View style={styles.pageInfo}>
            <Text style={styles.pageInfoText}>Sayfa {page} / {totalPages}</Text>
            <Text style={styles.totalText}>Toplam: {totalCount}</Text>
          </View>
 
          <TouchableOpacity 
            style={[styles.pageBtn, page >= totalPages && styles.pageBtnDisabled]} 
            onPress={() => setPage((p) => p + 1)} 
            disabled={page >= totalPages}
          >
            <ChevronRight color={page >= totalPages ? colors.textMuted : colors.text} size={24} />
          </TouchableOpacity>
        </View>

      </View>
    </SafeAreaView>
  );
}

const createStyles = (colors: ThemeColors, isDark: boolean) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  orb: { position: 'absolute', borderRadius: 9999 },
  orb1: { top: '-10%', left: '-10%', width: '60%', height: '40%', backgroundColor: isDark ? 'rgba(183, 58, 11, 0.1)' : 'rgba(183, 58, 11, 0.03)' },
  orb2: { bottom: '0%', right: '-20%', width: '70%', height: '50%', backgroundColor: isDark ? 'rgba(122, 12, 12, 0.1)' : 'rgba(122, 12, 12, 0.03)' },

  container: { flex: 1, padding: 16, maxWidth: 650, width: '100%', alignSelf: 'center' },
  header: { marginBottom: 16 },
  title: { fontSize: 24, fontWeight: '800', color: colors.text },
  subtitle: { fontSize: 13, color: colors.textSub, marginTop: 4, fontWeight: '600' },

  tabContainer: { flexDirection: 'row', backgroundColor: colors.inputBg, borderRadius: 12, padding: 4, marginBottom: 16, borderWidth: 1, borderColor: colors.inputBorder },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 8 },
  tabActive: { backgroundColor: '#B91C1C' },
  tabText: { fontSize: 12, fontWeight: '700', color: colors.textSub },
  tabTextActive: { color: '#fff' },

  loader: { marginTop: 40 },
  errorText: { color: '#ef4444', textAlign: 'center', marginTop: 20 },
  emptyText: { color: colors.textMuted, textAlign: 'center', marginTop: 40, fontSize: 14 },

  list: { paddingBottom: 20, gap: 12 },
  card: { marginBottom: 12 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  serviceNumber: { fontSize: 15, fontWeight: '800', color: '#B91C1C', letterSpacing: 0.5 },
  
  customerName: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 8 },
  
  infoRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  infoText: { color: colors.textSub, fontSize: 13 },

  pagerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.inputBorder, paddingTop: 16, marginTop: 4 },
  pageBtn: { backgroundColor: colors.inputBg, width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.inputBorder },
  pageBtnDisabled: { opacity: 0.5 },
  pageInfo: { alignItems: 'center' },
  pageInfoText: { color: colors.text, fontWeight: '700', fontSize: 14 },
  totalText: { color: colors.textSub, fontSize: 11, marginTop: 2 },
});
