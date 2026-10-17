import React, { useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { fetchErpCustomers, type ErpCustomerDto } from './customersApi';
import { Search, Filter, X, Phone, Mail, MapPin, Building2, UserCircle, Briefcase, Users, Store, Tag } from 'lucide-react-native';
import Card from '../../components/ui/Card';
import Badge, { BadgeType } from '../../components/ui/Badge';
import Spinner from '../../components/ui/Spinner';
import EmptyState from '../../components/ui/EmptyState';
import { useThemeColors, useThemeStore, type ThemeColors } from '../../shared/theme/store';

const TYPE_OPTIONS = ['', 'Customer', 'Dealer', 'Employee', 'Branch', 'Retail', 'Store'] as const;
type TypeOption = (typeof TYPE_OPTIONS)[number];

const getTypeIcon = (type: string, colors: ThemeColors) => {
  const iconColor = colors.textSub;
  switch (type?.toLowerCase()) {
    case 'dealer': return <Briefcase color={iconColor} size={14} style={{ marginRight: 4 }} />;
    case 'branch': return <Building2 color={iconColor} size={14} style={{ marginRight: 4 }} />;
    case 'employee': return <Users color={iconColor} size={14} style={{ marginRight: 4 }} />;
    case 'retail': return <Tag color={iconColor} size={14} style={{ marginRight: 4 }} />;
    case 'store': return <Store color={iconColor} size={14} style={{ marginRight: 4 }} />;
    case 'customer':
    default: return <UserCircle color={iconColor} size={14} style={{ marginRight: 4 }} />;
  }
};

const getTypeBadgeType = (type: string): BadgeType => {
  switch (type?.toLowerCase()) {
    case 'dealer': return 'success';
    case 'branch': return 'info';
    case 'employee': return 'warning';
    default: return 'neutral';
  }
};

export default function CustomersScreen() {
  const [q, setQ] = useState('');
  const [type, setType] = useState<TypeOption>('');
  const { width } = useWindowDimensions();

  const [typeModalOpen, setTypeModalOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailItem, setDetailItem] = useState<ErpCustomerDto | null>(null);

  const colors = useThemeColors();
  const theme = useThemeStore((s) => s.theme);
  const isDark = theme === 'dark';
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);

  const query = useQuery({
    queryKey: ['admin', 'customers', 'erp', q, type],
    queryFn: ({ signal }) => fetchErpCustomers({ q: q.trim() || undefined, type: type || undefined }, signal),
  });

  const items: ErpCustomerDto[] = useMemo(() => {
    const all = query.data ?? [];
    const s = q.trim().toLowerCase();
    if (!s) return all;
    return all.filter((c) => {
      const hay = `${c.fullName ?? ''} ${c.customerNumber ?? ''} ${c.phone ?? ''} ${c.email ?? ''}`.toLowerCase();
      return hay.includes(s);
    });
  }, [query.data, q]);

  const isLarge = width > 600;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={[styles.orb, styles.orb1]} />
      <View style={[styles.orb, styles.orb2]} />

      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Müşteriler & Cariler</Text>
        </View>

        <View style={styles.searchContainer}>
          <Search color={colors.textSub} size={20} style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Müşteri, bayi, cari kod ara..."
            placeholderTextColor={colors.placeholder}
            value={q}
            onChangeText={setQ}
          />
          <TouchableOpacity style={styles.filterBtn} onPress={() => setTypeModalOpen(true)}>
            <Filter color={colors.textSub} size={20} />
          </TouchableOpacity>
        </View>

        {type !== '' && (
          <View style={styles.activeFilterRow}>
             <View style={styles.activeFilterBadge}>
               <Text style={styles.activeFilterText}>Tip: {type}</Text>
               <TouchableOpacity onPress={() => setType('')}>
                 <X color={colors.accent} size={14} style={{marginLeft: 4}} />
               </TouchableOpacity>
             </View>
          </View>
        )}

        <Text style={styles.metaText}>Toplam: {items.length} kayıt bulundu</Text>

        {query.isLoading ? (
          <Spinner style={styles.loader} />
        ) : query.isError ? (
          <Text style={styles.errorText}>Hata: {query.error instanceof Error ? query.error.message : 'Bilinmeyen hata'}</Text>
        ) : (
          <FlatList
            data={items}
            keyExtractor={(x) => x.id}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.list}
            onRefresh={() => query.refetch()}
            refreshing={false}
            ListEmptyComponent={() => (
              <EmptyState message="Kayıt bulunamadı." />
            )}
            renderItem={({ item }) => (
              <TouchableOpacity
                onPress={() => {
                  setDetailItem(item);
                  setDetailOpen(true);
                }}
              >
                <Card style={styles.card}>
                  <View style={styles.cardHeader}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      {getTypeIcon(item.typeLabel ?? item.type ?? '', colors)}
                      <Badge 
                        label={item.typeLabel ?? item.type ?? 'Customer'} 
                        type={getTypeBadgeType(item.typeLabel ?? item.type ?? '')} 
                      />
                    </View>
                    <Text style={styles.customerCode}>{item.customerNumber ?? item.id}</Text>
                  </View>

                  <Text style={styles.customerName} numberOfLines={2}>{item.fullName ?? 'İsimsiz Cari'}</Text>
                  
                  <View style={styles.infoRow}>
                    <Phone color={colors.textMuted} size={14} style={{marginRight: 6}} />
                    <Text style={styles.infoText} numberOfLines={1}>{item.phone || 'Telefon Yok'}</Text>
                  </View>
                  
                  <View style={styles.infoRow}>
                    <MapPin color={colors.textMuted} size={14} style={{marginRight: 6}} />
                    <Text style={styles.infoText} numberOfLines={1}>{item.regionName ?? item.city ?? 'Bölge Yok'}</Text>
                  </View>
                </Card>
              </TouchableOpacity>
            )}
          />
        )}

        {/* Type Filter Modal */}
        <Modal visible={typeModalOpen} animationType="slide" transparent={true}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, isLarge && styles.modalContentLarge]}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Tip Seç</Text>
                <TouchableOpacity onPress={() => setTypeModalOpen(false)}><X color={colors.text} size={24}/></TouchableOpacity>
              </View>
              <FlatList
                data={TYPE_OPTIONS as unknown as TypeOption[]}
                keyExtractor={(x) => x || 'any'}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.modalRow}
                    onPress={() => {
                      setType(item);
                      setTypeModalOpen(false);
                    }}
                  >
                    <Text style={styles.modalRowTitle}>{item ? item : 'Tümü'}</Text>
                  </TouchableOpacity>
                )}
              />
            </View>
          </View>
        </Modal>

        {/* Detail Modal */}
        <Modal visible={detailOpen} animationType="fade" transparent={true}>
          <View style={styles.modalOverlay}>
            <View style={[styles.detailModalContent, isLarge && styles.detailModalContentLarge]}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Cari Detay</Text>
                <TouchableOpacity onPress={() => setDetailOpen(false)}><X color={colors.text} size={24}/></TouchableOpacity>
              </View>
              
              <View style={styles.detailBody}>
                <Text style={styles.detailName}>{detailItem?.fullName ?? 'İsimsiz Cari'}</Text>
                
                <View style={styles.detailSection}>
                  <Text style={styles.detailLabel}>Cari Kodu</Text>
                  <Text style={styles.detailValue}>{detailItem?.customerNumber ?? detailItem?.id ?? '-'}</Text>
                </View>
                
                <View style={styles.detailSection}>
                  <Text style={styles.detailLabel}>Tip</Text>
                  <Text style={styles.detailValue}>{detailItem?.typeLabel ?? detailItem?.type ?? '-'}</Text>
                </View>

                <View style={styles.detailSectionRow}>
                  <View style={styles.detailSectionHalf}>
                    <Text style={styles.detailLabel}>Telefon</Text>
                    <Text style={styles.detailValue}>{detailItem?.phone ?? '-'}</Text>
                  </View>
                  <View style={styles.detailSectionHalf}>
                    <Text style={styles.detailLabel}>Email</Text>
                    <Text style={styles.detailValue}>{detailItem?.email ?? '-'}</Text>
                  </View>
                </View>

                <View style={styles.detailSection}>
                  <Text style={styles.detailLabel}>Bölge</Text>
                  <Text style={styles.detailValue}>{detailItem?.regionName ?? detailItem?.city ?? '-'}</Text>
                </View>
                
                <View style={styles.detailSection}>
                  <Text style={styles.detailLabel}>Adres</Text>
                  <Text style={styles.detailValue}>{detailItem?.address ?? '-'}</Text>
                </View>

                <View style={styles.detailSectionRow}>
                  <View style={styles.detailSectionHalf}>
                    <Text style={styles.detailLabel}>Toplam Servis</Text>
                    <Text style={[styles.detailValue, {color: colors.accent}]}>{detailItem?.totalServices ?? 0}</Text>
                  </View>
                  <View style={styles.detailSectionHalf}>
                    <Text style={styles.detailLabel}>Son Servis</Text>
                    <Text style={styles.detailValue}>{detailItem?.lastServiceDate ?? '-'}</Text>
                  </View>
                </View>

              </View>
            </View>
          </View>
        </Modal>

      </View>
    </SafeAreaView>
  );
}

const createStyles = (colors: ThemeColors, isDark: boolean) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  orb: { position: 'absolute', borderRadius: 9999 },
  orb1: { top: '-10%', left: '-10%', width: '60%', height: '40%', backgroundColor: colors.orb1 },
  orb2: { bottom: '0%', right: '-20%', width: '70%', height: '50%', backgroundColor: colors.orb2 },

  container: { flex: 1, padding: 16, maxWidth: 650, width: '100%', alignSelf: 'center' },
  header: { marginBottom: 16 },
  title: { fontSize: 24, fontWeight: '800', color: colors.text },

  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: 12,
    paddingHorizontal: 12,
    marginBottom: 12
  },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, height: 44, color: colors.text, fontSize: 14 },
  filterBtn: { padding: 8 },

  activeFilterRow: { flexDirection: 'row', marginBottom: 12 },
  activeFilterBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.accentLight,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.accent
  },
  activeFilterText: { color: colors.accent, fontSize: 12, fontWeight: '700' },

  metaText: { color: colors.textSub, fontSize: 13, marginBottom: 12 },
  loader: { marginTop: 40 },
  errorText: { color: '#ef4444', textAlign: 'center' },

  list: { paddingBottom: 95, gap: 12 },
  card: { padding: 16 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  customerCode: { fontSize: 12, color: colors.textSub, fontWeight: '700' },
  
  customerName: { fontSize: 18, fontWeight: '700', color: colors.text, marginBottom: 12 },
  
  infoRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  infoText: { color: colors.textSub, fontSize: 13 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: colors.tabBarBg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, height: '60%', width: '100%' },
  modalContentLarge: { maxWidth: 600, alignSelf: 'center' },
  detailModalContent: { backgroundColor: colors.tabBarBg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, height: '80%', width: '100%' },
  detailModalContentLarge: { maxWidth: 600, alignSelf: 'center' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { color: colors.text, fontSize: 20, fontWeight: '800' },
  modalRow: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.divider },
  modalRowTitle: { color: colors.text, fontSize: 16, fontWeight: '600' },

  detailBody: { marginTop: 8 },
  detailName: { fontSize: 22, fontWeight: '800', color: colors.text, marginBottom: 20 },
  detailSection: { marginBottom: 16 },
  detailSectionRow: { flexDirection: 'row', gap: 16, marginBottom: 16 },
  detailSectionHalf: { flex: 1 },
  detailLabel: { color: colors.textMuted, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', marginBottom: 4 },
  detailValue: { color: colors.text, fontSize: 15, fontWeight: '600' },
});
