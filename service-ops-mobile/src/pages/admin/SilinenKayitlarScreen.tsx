import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Trash2, RotateCcw, ArrowLeft, User, Wrench, MapPin, Layers } from 'lucide-react-native';
import { useThemeColors, useThemeStore, type ThemeColors } from '../../shared/theme/store';
import Spinner from '../../components/ui/Spinner';
import Card from '../../components/ui/Card';
import { fetchDeletedServiceRecords, restoreServiceRecord } from '../technician/serviceRecordsApi';

// Subcomponent: Deleted Record Card Item
function DeletedRecordItem({ item, colors, onRestore }: { item: any; colors: ThemeColors; onRestore: (id: string, serviceNumber: string) => void }) {
  return (
    <Card style={[styles.card, { backgroundColor: colors.card, borderColor: colors.surfaceBorder }]}>
      <View style={styles.cardHeader}>
        <View style={styles.recordNoRow}>
          <Trash2 color="#ef4444" size={16} style={{ marginRight: 6 }} />
          <Text style={[styles.recordNo, { color: colors.text }]}>{item.serviceNumber}</Text>
        </View>
        <TouchableOpacity
          style={styles.restoreBtn}
          onPress={() => onRestore(item.id, item.serviceNumber)}
        >
          <RotateCcw color="#10b981" size={16} style={{ marginRight: 4 }} />
          <Text style={styles.restoreBtnText}>Geri Yükle</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.cardBody}>
        <View style={styles.infoRow}>
          <User color={colors.textSub} size={14} style={styles.iconMargin} />
          <Text style={[styles.infoLabel, { color: colors.textSub }]}>Müşteri:</Text>
          <Text style={[styles.infoValue, { color: colors.text }]} numberOfLines={1}>
            {item.customerName || '-'}
          </Text>
        </View>

        <View style={styles.infoRow}>
          <Layers color={colors.textSub} size={14} style={styles.iconMargin} />
          <Text style={[styles.infoLabel, { color: colors.textSub }]}>Ürün:</Text>
          <Text style={[styles.infoValue, { color: colors.text }]} numberOfLines={1}>
            {item.productName || '-'}
          </Text>
        </View>

        <View style={styles.divider} />

        <View style={styles.deletedRow}>
          <View style={styles.metaCol}>
            <Text style={styles.metaLabel}>SİLEN KULLANICI</Text>
            <Text style={[styles.metaValue, { color: colors.text }]}>{item.deletedBy || 'Bilinmiyor'}</Text>
          </View>
          <View style={styles.metaCol}>
            <Text style={styles.metaLabel}>SİLİNME TARİHİ</Text>
            <Text style={[styles.metaValue, { color: colors.text }]}>
              {item.deletedAt ? new Date(item.deletedAt).toLocaleDateString('tr-TR') : '-'}
            </Text>
          </View>
        </View>
      </View>
    </Card>
  );
}

// Subcomponent: Tab Button
function TabButton({ active, label, icon: Icon, onPress, colors }: { active: boolean; label: string; icon: any; onPress: () => void; colors: ThemeColors }) {
  return (
    <TouchableOpacity
      style={[styles.tab, active && styles.tabActive]}
      onPress={onPress}
    >
      <Icon color={active ? '#B91C1C' : colors.textSub} size={14} style={{ marginRight: 4 }} />
      <Text style={[styles.tabText, { color: active ? '#B91C1C' : colors.textSub }]}>{label}</Text>
    </TouchableOpacity>
  );
}

export default function SilinenKayitlarScreen() {
  const navigation = useNavigation();
  const colors = useThemeColors();
  const theme = useThemeStore((s) => s.theme);
  const isDark = theme === 'dark';

  const [activeTab, setActiveTab] = useState<'saha' | 'atolye' | 'montaj'>('saha');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [items, setItems] = useState<any[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const stylesObj = useMemo(() => createStyles(colors), [colors]);

  const loadData = useCallback(async (pageNum = page, isRef = false) => {
    if (isRef) setIsRefreshing(true);
    else setIsLoading(true);

    try {
      const data = await fetchDeletedServiceRecords(activeTab, pageNum, pageSize);
      setItems(data.items ?? []);
      setTotalCount(data.totalCount ?? 0);
      setTotalPages(data.totalPages ?? 0);
    } catch (err: any) {
      Alert.alert('Hata', err.message || 'Silinen kayıtlar getirilemedi.');
      setItems([]);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [activeTab, page, pageSize]);

  useEffect(() => {
    loadData(1, false);
    setPage(1);
  }, [activeTab]);

  useEffect(() => {
    loadData(page, false);
  }, [page]);

  const handleRestore = (id: string, serviceNumber: string) => {
    Alert.alert(
      'Kayıt Geri Yükleme',
      `${serviceNumber} numaralı kaydı geri yüklemek istediğinize emin misiniz?`,
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'Geri Yükle',
          style: 'default',
          onPress: async () => {
            try {
              setIsLoading(true);
              await restoreServiceRecord(id);
              Alert.alert('Başarılı', 'Kayıt başarıyla geri yüklendi.');
              loadData(1, false);
              setPage(1);
            } catch (err: any) {
              Alert.alert('Hata', err.message || 'Kayıt geri yüklenemedi.');
            } finally {
              setIsLoading(false);
            }
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={[stylesObj.safe, { backgroundColor: colors.bg }]}>
      {/* Decorative Orbs */}
      <View style={[stylesObj.orb, stylesObj.orb1]} />
      <View style={[stylesObj.orb, stylesObj.orb2]} />

      <View style={stylesObj.container}>
        {/* Header Row */}
        <View style={stylesObj.headerRow}>
          <TouchableOpacity style={stylesObj.backBtn} onPress={() => navigation.goBack()}>
            <ArrowLeft color={colors.text} size={24} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={[stylesObj.title, { color: colors.text }]}>Silinen Kayıtlar</Text>
            <Text style={[stylesObj.subtitle, { color: colors.textSub }]}>Silinen saha, atölye ve montaj kayıtları</Text>
          </View>
        </View>

        {/* Tabs */}
        <View style={styles.tabsRow}>
          <TabButton
            active={activeTab === 'saha'}
            label="Saha"
            icon={MapPin}
            onPress={() => setActiveTab('saha')}
            colors={colors}
          />
          <TabButton
            active={activeTab === 'atolye'}
            label="Atölye"
            icon={Wrench}
            onPress={() => setActiveTab('atolye')}
            colors={colors}
          />
          <TabButton
            active={activeTab === 'montaj'}
            label="Montaj"
            icon={Layers}
            onPress={() => setActiveTab('montaj')}
            colors={colors}
          />
        </View>

        {/* List content */}
        <View style={styles.content}>
          {isLoading && !isRefreshing ? (
            <Spinner style={{ marginTop: 40 }} />
          ) : (
            <FlatList
              data={items}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <DeletedRecordItem
                  item={item}
                  colors={colors}
                  onRestore={handleRestore}
                />
              )}
              contentContainerStyle={styles.listContainer}
              onRefresh={() => loadData(page, true)}
              refreshing={isRefreshing}
              ListEmptyComponent={() => (
                <View style={styles.emptyContainer}>
                  <Trash2 color={colors.textMuted} size={48} style={{ marginBottom: 12 }} />
                  <Text style={[styles.emptyText, { color: colors.textSub }]}>Silinmiş kayıt bulunamadı.</Text>
                </View>
              )}
            />
          )}
        </View>

        {/* Pagination Footer */}
        {totalPages > 1 && (
          <View style={[styles.pagination, { borderTopColor: colors.divider }]}>
            <Text style={[styles.totalText, { color: colors.textSub }]}>
              Toplam {totalCount} kayıt
            </Text>
            <View style={styles.pagerRow}>
              <TouchableOpacity
                style={[styles.pagerBtn, { backgroundColor: colors.inputBg }, page <= 1 && { opacity: 0.3 }]}
                disabled={page <= 1}
                onPress={() => setPage((p) => Math.max(1, p - 1))}
              >
                <Text style={{ color: colors.text, fontWeight: '800' }}>{'<'}</Text>
              </TouchableOpacity>
              <View style={styles.pageBadge}>
                <Text style={styles.pageBadgeText}>{page}</Text>
              </View>
              <TouchableOpacity
                style={[styles.pagerBtn, { backgroundColor: colors.inputBg }, page >= totalPages && { opacity: 0.3 }]}
                disabled={page >= totalPages}
                onPress={() => setPage((p) => p + 1)}
              >
                <Text style={{ color: colors.text, fontWeight: '800' }}>{'>'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  safe: {
    flex: 1,
  },
  orb: {
    position: 'absolute',
    borderRadius: 9999,
  },
  orb1: {
    top: '-10%',
    left: '-10%',
    width: '60%',
    height: '40%',
    backgroundColor: colors.orb1,
  },
  orb2: {
    bottom: '0%',
    right: '-20%',
    width: '70%',
    height: '50%',
    backgroundColor: colors.orb2,
  },
  container: {
    flex: 1,
    padding: 16,
    width: '100%',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
  },
  subtitle: {
    fontSize: 13,
    marginTop: 2,
    fontWeight: '600',
  },
  backBtn: {
    padding: 6,
    borderRadius: 8,
  },
});

const styles = StyleSheet.create({
  tabsRow: {
    flexDirection: 'row',
    marginTop: 4,
    marginBottom: 16,
    gap: 8,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: 'rgba(0,0,0,0.02)',
  },
  tabActive: {
    backgroundColor: 'rgba(185, 28, 28, 0.08)',
    borderColor: 'rgba(185, 28, 28, 0.15)',
  },
  tabText: {
    fontSize: 13,
    fontWeight: '700',
  },
  content: {
    flex: 1,
  },
  listContainer: {
    paddingBottom: 24,
  },
  card: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 10,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.04)',
  },
  recordNoRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  recordNo: {
    fontSize: 14,
    fontFamily: 'mono',
    fontWeight: '700',
  },
  restoreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.15)',
  },
  restoreBtnText: {
    color: '#10b981',
    fontSize: 11,
    fontWeight: '700',
  },
  cardBody: {
    paddingTop: 10,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  iconMargin: {
    marginRight: 6,
  },
  infoLabel: {
    fontSize: 12,
    marginRight: 4,
  },
  infoValue: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(0,0,0,0.04)',
    marginVertical: 10,
  },
  deletedRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  metaCol: {
    width: '48%',
  },
  metaLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: '#ef4444',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  metaValue: {
    fontSize: 12,
    fontWeight: '600',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 80,
  },
  emptyText: {
    fontSize: 14,
    fontWeight: '600',
  },
  pagination: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderTopWidth: 1,
  },
  totalText: {
    fontSize: 12,
  },
  pagerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pagerBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageBadge: {
    backgroundColor: '#B91C1C',
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageBadgeText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 12,
  },
});
