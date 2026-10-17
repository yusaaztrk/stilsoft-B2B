import React, { useMemo, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { UrunKabulStackParamList } from '../../app/UrunKabulStack';
import { fetchServiceRecordsPaged, PagedResult, ServiceRecord } from '../technician/serviceRecordsApi';
import { ChevronLeft, ChevronRight, Filter, Plus, Search, Shield, ShieldOff, Package, X } from 'lucide-react-native';
import Card from '../../components/ui/Card';
import Badge, { BadgeType } from '../../components/ui/Badge';
import Spinner from '../../components/ui/Spinner';
import EmptyState from '../../components/ui/EmptyState';
import { useThemeColors, useThemeStore, type ThemeColors } from '../../shared/theme/store';

const STATUS_MAP: Record<string, { label: string; type: BadgeType }> = {
  New: { label: 'Yeni Kayıt', type: 'neutral' },
  Planned: { label: 'Planlandı', type: 'info' },
  Workshop: { label: 'Atölyede', type: 'warning' },
  InRepair: { label: 'Tamirde', type: 'info' },
  WaitingForParts: { label: 'Parça Bekliyor', type: 'warning' },
  Ready: { label: 'Hazır', type: 'success' },
  Delivered: { label: 'Teslim Edildi', type: 'success' },
  Delayed: { label: 'Gecikti', type: 'error' },
  Cancelled: { label: 'İptal', type: 'error' },
};

export default function UrunKabulListScreen() {
  const colors = useThemeColors();
  const theme = useThemeStore((s) => s.theme);
  const isDark = theme === 'dark';
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);
  const { width } = useWindowDimensions();
  const navigation = useNavigation<NativeStackNavigationProp<UrunKabulStackParamList>>();
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [searchVal, setSearchVal] = useState('');
  const [q, setQ] = useState<string | undefined>(undefined);
  const [selectedStatus, setSelectedStatus] = useState<string | undefined>(undefined);
  const [selectedWarranty, setSelectedWarranty] = useState<'all' | 'yes' | 'no'>('all');
  const [showFilters, setShowFilters] = useState(false);

  const query = useQuery<PagedResult<ServiceRecord>>({
    queryKey: ['urun-kabul', 'paged', page, q, selectedStatus],
    queryFn: ({ signal }) =>
      fetchServiceRecordsPaged(
        {
          q: q || undefined,
          status: selectedStatus || undefined,
          page,
          pageSize,
        },
        signal
      ),
    placeholderData: keepPreviousData,
  });

  const data = query.data;
  const items = useMemo(() => {
    return data?.items ?? [];
  }, [data?.items]);

  const filteredItems = useMemo(() => {
    let list = items;
    if (selectedWarranty === 'yes') {
      list = list.filter((item) => Boolean((item as any).isUnderWarranty));
    } else if (selectedWarranty === 'no') {
      list = list.filter((item) => !Boolean((item as any).isUnderWarranty));
    }
    return list;
  }, [items, selectedWarranty]);

  const isLarge = width > 600;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
      <View style={[styles.orb, styles.orb1]} />
      <View style={[styles.orb, styles.orb2]} />

      <KeyboardAvoidingView style={styles.flex1} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.container}>
          <View style={styles.headerRow}>
            <View>
              <Text style={[styles.title, { color: colors.text }]}>Ürün Kabul</Text>
              <Text style={[styles.subtitle, { color: colors.textSub }]}>Gelen cihaz kayıtları</Text>
            </View>
            <TouchableOpacity style={styles.newBtn} onPress={() => navigation.navigate('UrunKabulCreate')}>
              <Plus color="#fff" size={20} />
            </TouchableOpacity>
          </View>

          {/* Search bar & Filter trigger */}
          <View style={[styles.searchContainer, { backgroundColor: isDark ? 'rgba(255,255,255,0.07)' : '#ffffff', borderColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)' }]}>
            <Search color={colors.textSub} size={18} style={styles.searchIcon} />
            <TextInput
              style={[styles.searchInput, { color: colors.text }]}
              value={searchVal}
              onChangeText={setSearchVal}
              onSubmitEditing={() => {
                setQ(searchVal.trim());
                setPage(1);
              }}
              placeholder="Fiş no, isim, tlf veya seri no..."
              placeholderTextColor={colors.placeholder}
            />
            {searchVal ? (
              <TouchableOpacity onPress={() => { setSearchVal(''); setQ(undefined); setPage(1); }} style={{ padding: 4, marginRight: 8 }}>
                <X color={colors.textSub} size={16} />
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity style={styles.filterBtnIcon} onPress={() => setShowFilters(!showFilters)}>
              <Filter color={showFilters ? '#B91C1C' : colors.textSub} size={20} />
            </TouchableOpacity>
          </View>

          {/* Filter Panel */}
          {showFilters && (
            <Card style={styles.filterPanel}>
              <Text style={[styles.filterLabel, { color: colors.textSub }]}>DURUM FİLTRESİ</Text>
              <View style={styles.presetRow}>
                <TouchableOpacity
                  style={[
                    styles.presetBtn,
                    { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : '#ffffff', borderColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)' },
                    !selectedStatus && styles.presetBtnActive
                  ]}
                  onPress={() => setSelectedStatus(undefined)}
                >
                  <Text style={[styles.presetBtnText, { color: colors.textSub }, !selectedStatus && styles.presetBtnTextActive]}>Tümü</Text>
                </TouchableOpacity>
                {Object.keys(STATUS_MAP).map((statusKey) => (
                  <TouchableOpacity
                    key={statusKey}
                    style={[
                      styles.presetBtn,
                      { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : '#ffffff', borderColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)' },
                      selectedStatus === statusKey && styles.presetBtnActive
                    ]}
                    onPress={() => setSelectedStatus(statusKey)}
                  >
                    <Text style={[styles.presetBtnText, { color: colors.textSub }, selectedStatus === statusKey && styles.presetBtnTextActive]}>
                      {STATUS_MAP[statusKey].label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={[styles.filterLabel, { color: colors.textSub }]}>GARANTİ FİLTRESİ</Text>
              <View style={styles.presetRow}>
                {(['all', 'yes', 'no'] as const).map((wty) => {
                  const labelMap = { all: 'Farketmez', yes: 'Garantili', no: 'Garantisiz' };
                  return (
                    <TouchableOpacity
                      key={wty}
                      style={[
                        styles.presetBtn,
                        { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : '#ffffff', borderColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)' },
                        selectedWarranty === wty && styles.presetBtnActive
                      ]}
                      onPress={() => setSelectedWarranty(wty)}
                    >
                      <Text style={[styles.presetBtnText, { color: colors.textSub }, selectedWarranty === wty && styles.presetBtnTextActive]}>
                        {labelMap[wty]}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
                <TouchableOpacity
                  style={[styles.applyFilterBtn, { flex: 1, backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.inputBorder }]}
                  onPress={() => {
                    setSelectedStatus(undefined);
                    setSelectedWarranty('all');
                    setSearchVal('');
                    setQ(undefined);
                    setPage(1);
                    setShowFilters(false);
                  }}
                >
                  <Text style={[styles.applyFilterBtnText, { color: colors.text }]}>Temizle</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.applyFilterBtn, { flex: 1 }]}
                  onPress={() => {
                    setQ(searchVal.trim());
                    setPage(1);
                    setShowFilters(false);
                  }}
                >
                  <Text style={styles.applyFilterBtnText}>Uygula</Text>
                </TouchableOpacity>
              </View>
            </Card>
          )}

          {query.isLoading && !query.data ? (
            <Spinner style={styles.loader} />
          ) : query.isError ? (
            <Text style={styles.error}>Hata: {query.error instanceof Error ? query.error.message : 'Bilinmeyen hata'}</Text>
          ) : (
            <FlatList
              data={filteredItems}
              keyExtractor={(x) => x.id}
              style={{ flex: 1 }}
              contentContainerStyle={styles.list}
              showsVerticalScrollIndicator={false}
              onRefresh={() => query.refetch()}
              refreshing={false}
              ListEmptyComponent={() => (
                <EmptyState message="Kayıt bulunamadı." />
              )}
              renderItem={({ item }) => {
                const isWty = Boolean((item as any).isUnderWarranty);
                const statusInfo = STATUS_MAP[item.status] || { label: item.statusLabel ?? item.status, type: 'info' };
                return (
                  <TouchableOpacity onPress={() => navigation.navigate('ServiceRecordDetail', { serviceId: item.id })}>
                    <Card style={styles.card}>
                      <View style={styles.cardHeader}>
                        <Text style={styles.serviceNumber}>{item.serviceNumber}</Text>
                        <Badge label={statusInfo.label} type={statusInfo.type} />
                      </View>
                      <Text style={[styles.cardMainText, { color: colors.text }]} numberOfLines={1}>{item.customerName ?? 'İsimsiz Müşteri'}</Text>
                      
                      <View style={[styles.cardFooter, { borderTopColor: colors.divider }]}>
                        <View style={styles.productRow}>
                          <Package color={colors.textSub} size={14} style={{marginRight: 4}} />
                          <Text style={[styles.cardSubText, { color: colors.textSub }]} numberOfLines={1}>{item.productName ?? 'Ürün Belirtilmemiş'}</Text>
                        </View>
                        {isWty ? (
                          <View style={[styles.wtyBadge, { backgroundColor: colors.inputBg }]}><Shield color="#10b981" size={12} /><Text style={styles.wtyText}>Garantili</Text></View>
                        ) : (
                          <View style={[styles.wtyBadge, { backgroundColor: colors.inputBg }]}><ShieldOff color="#ef4444" size={12} /><Text style={[styles.wtyText, {color: '#ef4444'}]}>Garantisiz</Text></View>
                        )}
                      </View>
                    </Card>
                  </TouchableOpacity>
                );
              }}
            />
          )}

          <View style={[styles.pagerRow, { borderTopColor: colors.divider }]}>
            <TouchableOpacity 
              style={[styles.pageBtn, { backgroundColor: colors.inputBg }, page <= 1 && styles.pageBtnDisabled]} 
              onPress={() => setPage((p) => Math.max(1, p - 1))} 
              disabled={page <= 1}
            >
              <ChevronLeft color={page <= 1 ? colors.textMuted : colors.text} size={24} />
            </TouchableOpacity>
            
            <View style={styles.pageInfo}>
              <Text style={[styles.pageInfoText, { color: colors.text }]}>Sayfa {data?.page ?? page} / {data?.totalPages ?? '-'}</Text>
              <Text style={[styles.totalText, { color: colors.textSub }]}>Toplam: {data?.totalCount ?? '-'}</Text>
            </View>

            <TouchableOpacity 
              style={[styles.pageBtn, { backgroundColor: colors.inputBg }, (data?.totalPages ? page >= data.totalPages : items.length < pageSize) && styles.pageBtnDisabled]} 
              onPress={() => setPage((p) => p + 1)} 
              disabled={data?.totalPages ? page >= data.totalPages : items.length < pageSize}
            >
              <ChevronRight color={(data?.totalPages ? page >= data.totalPages : items.length < pageSize) ? colors.textMuted : colors.text} size={24} />
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const createStyles = (colors: ThemeColors, isDark: boolean) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex1: { flex: 1 },
  orb: { position: 'absolute', borderRadius: 9999 },
  orb1: { top: '-10%', left: '-10%', width: '60%', height: '40%', backgroundColor: colors.orb1 },
  orb2: { bottom: '0%', right: '-20%', width: '70%', height: '50%', backgroundColor: colors.orb2 },

  container: { flex: 1, padding: 16, maxWidth: 650, width: '100%', alignSelf: 'center' },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  title: { fontSize: 24, fontWeight: '800' },
  subtitle: { fontSize: 13, marginTop: 2, fontWeight: '600' },
  newBtn: { backgroundColor: '#B91C1C', width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },

  searchContainer: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, marginBottom: 12 },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, height: 44, fontSize: 14 },
  filterBtnIcon: { padding: 8 },

  filterPanel: { padding: 16, marginBottom: 16 },
  filterLabel: { fontSize: 11, fontWeight: '800', marginBottom: 8, letterSpacing: 0.5 },
  presetRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 16 },
  presetBtn: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  presetBtnActive: { backgroundColor: 'rgba(185, 28, 28, 0.12)', borderColor: '#B91C1C' },
  presetBtnText: { fontSize: 12, fontWeight: '600' },
  presetBtnTextActive: { color: '#ef4444' },
  applyFilterBtn: { backgroundColor: '#B91C1C', borderRadius: 8, padding: 12, alignItems: 'center', width: '100%' },
  applyFilterBtnText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  
  loader: { marginTop: 40 },
  error: { color: '#ef4444', textAlign: 'center', marginTop: 20 },
  
  list: { gap: 12, paddingBottom: 95 },
  card: { padding: 16 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  serviceNumber: { fontSize: 14, fontWeight: '800', color: '#B91C1C', letterSpacing: 0.5 },
  cardMainText: { fontSize: 16, fontWeight: '700', marginBottom: 12 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, paddingTop: 12 },
  productRow: { flexDirection: 'row', alignItems: 'center', flex: 1, paddingRight: 8 },
  cardSubText: { fontSize: 13 },
  wtyBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  wtyText: { fontSize: 10, fontWeight: '700', color: '#10b981' },

  pagerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, paddingTop: 12, paddingBottom: 16, paddingRight: 64, marginTop: 4 },
  pageBtn: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  pageBtnDisabled: { opacity: 0.3 },
  pageInfo: { alignItems: 'center' },
  pageInfoText: { fontWeight: '700', fontSize: 14 },
  totalText: { fontSize: 11, marginTop: 2 },
  dateInputWrapper: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 8,
    paddingHorizontal: 12,
    marginBottom: 16,
    height: 40,
    justifyContent: 'center',
  },
});
