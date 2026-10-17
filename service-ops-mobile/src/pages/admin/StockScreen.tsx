import React, { useMemo, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
  Image,
  Alert,
  ScrollView,
} from 'react-native';
import { API_BASE_URL } from '../../shared/config';

function toImgSrc(url?: string | null) {
  if (!url) return null;
  if (url.startsWith('http') || url.startsWith('data:') || url.startsWith('blob:')) {
    return { uri: url };
  }
  const prefix = url.startsWith('/') ? '' : '/';
  return { uri: `${API_BASE_URL}${prefix}${url}` };
}
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createSparePartOrderRequest,
  fetchSparePartOrderRequests,
  fetchStockItems,
  type SparePartOrderRequestDto,
  type StockItemDto,
} from './stockApi';
import { useSessionStore } from '../../shared/session/store';
import { useSignalR } from '../../shared/hooks/useSignalR';
import { Archive, ChevronRight, History, PackageOpen, Search, X, Plus } from 'lucide-react-native';
import Card from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';
import Spinner from '../../components/ui/Spinner';
import EmptyState from '../../components/ui/EmptyState';
import { useThemeColors, useThemeStore, type ThemeColors } from '../../shared/theme/store';

type ProductStatus = 'ok' | 'critical' | 'out';

export default function StockScreen() {
  const colors = useThemeColors();
  const theme = useThemeStore((s) => s.theme);
  const isDark = theme === 'dark';
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);

  const qc = useQueryClient();
  useSignalR(['service_record_updated', 'installation_updated']);
  const [q, setQ] = useState('');
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [partsModalOpen, setPartsModalOpen] = useState(false);
  const { width } = useWindowDimensions();

  const [recentModalOpen, setRecentModalOpen] = useState(false);
  const [orderModalOpen, setOrderModalOpen] = useState(false);
  const [orderTarget, setOrderTarget] = useState<StockItemDto | null>(null);
  const [orderQty, setOrderQty] = useState('1');

  const [zoomModalOpen, setZoomModalOpen] = useState(false);
  const [zoomImageUrl, setZoomImageUrl] = useState<string | null>(null);
  const [zoomImageTitle, setZoomImageTitle] = useState('');

  const stockQuery = useQuery({
    queryKey: ['stock', 'items', q],
    queryFn: ({ signal }) => fetchStockItems(q.trim() || undefined, signal),
  });

  const items = stockQuery.data ?? [];
  const products = useMemo(() => items.filter((i) => i.type === 'Product'), [items]);


  const partsByProductCode = useMemo(() => {
    const map = new Map<string, StockItemDto[]>();
    for (const item of items) {
      if (item.type !== 'SparePart') continue;
      const key = String(item.productId ?? '').trim() || '__unlinked__';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return map;
  }, [items]);

  const filteredProducts = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return products;
    return products.filter((p) => {
      return p.name.toLowerCase().includes(s) || String(p.partNumber ?? '').toLowerCase().includes(s);
    });
  }, [products, q]);

  const selectedProduct = useMemo(() => {
    if (!selectedProductId) return null;
    return items.find((i) => i.type === 'Product' && i.id === selectedProductId) ?? null;
  }, [items, selectedProductId]);

  const selectedParts = useMemo(() => {
    if (!selectedProduct) return [];
    const key = String(selectedProduct.productId ?? '').trim();
    return partsByProductCode.get(key) ?? [];
  }, [selectedProduct, partsByProductCode]);

  const totalParts = useMemo(() => items.filter((i) => i.type === 'SparePart').length, [items]);
  const outOfStock = useMemo(() => items.filter((i) => i.type === 'SparePart' && (i.quantity ?? 0) === 0).length, [items]);

  const getStatus = (product: StockItemDto): ProductStatus => {
    const parts = partsByProductCode.get(String(product.productId ?? '').trim()) ?? [];
    if (parts.length === 0) return 'ok';
    if (parts.some((p) => (p.quantity ?? 0) === 0)) return 'out';
    if (parts.some((p) => (p.minStockLevel ?? 0) > 0 && (p.quantity ?? 0) <= (p.minStockLevel ?? 0))) return 'critical';
    return 'ok';
  };

  const recentQuery = useQuery<SparePartOrderRequestDto[]>({
    queryKey: ['admin', 'stock', 'recent-requests'],
    queryFn: ({ signal }) => fetchSparePartOrderRequests(undefined, signal),
    enabled: recentModalOpen,
  });

  const orderMutation = useMutation({
    mutationFn: async () => {
      if (!orderTarget) throw new Error('Target yok');
      const qty = Math.max(1, Number(orderQty) || 1);
      return await createSparePartOrderRequest({
        erpProductId: String(orderTarget.id),
        stockCode: String(orderTarget.partNumber ?? ''),
        partName: String(orderTarget.name ?? ''),
        quantityRequested: qty,
      });
    },
    onSuccess: async () => {
      setOrderModalOpen(false);
      setOrderTarget(null);
      setOrderQty('1');
      await qc.invalidateQueries({ queryKey: ['admin', 'stock', 'recent-requests'] });
    },
  });

  const isLarge = width > 600;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={[styles.orb, styles.orb1]} />
      <View style={[styles.orb, styles.orb2]} />

      <KeyboardAvoidingView style={styles.flex1} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.container}>
          
          {/* Header */}
          <View style={styles.header}>
            <View style={{ flex: 1, marginRight: 8 }}>
              <Text style={styles.title}>Stok Yönetimi</Text>
              <Text style={styles.subtitle}>Ürünler ve yedek parçalar</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <TouchableOpacity style={styles.recentBtn} onPress={() => setRecentModalOpen(true)}>
                <History color="#fff" size={18} style={{ marginRight: 6 }} />
                <Text style={styles.recentBtnText}>İstekler</Text>
              </TouchableOpacity>
            </View>
          </View>


          {/* Stats */}
          <View style={styles.statsContainer}>
            <Card style={styles.statBox}>
              <Text style={styles.statLabel}>Ürün</Text>
              <Text style={styles.statValue}>{products.length}</Text>
            </Card>
            <Card style={styles.statBox}>
              <Text style={styles.statLabel}>Parça</Text>
              <Text style={styles.statValue}>{totalParts}</Text>
            </Card>
            <Card style={styles.statBox}>
              <Text style={styles.statLabel}>Tükenen</Text>
              <Text style={[styles.statValue, { color: '#ef4444' }]}>{outOfStock}</Text>
            </Card>
          </View>

          {/* Search */}
          <View style={styles.searchContainer}>
            <Search color={colors.textMuted} size={20} style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              placeholder="Ürün adı veya kodu ara..."
              placeholderTextColor={colors.textMuted}
              value={q}
              onChangeText={setQ}
            />
          </View>

          {/* Products List */}
          {stockQuery.isLoading ? (
            <Spinner style={{ marginTop: 40 }} />
          ) : stockQuery.isError ? (
            <Text style={styles.errorText}>Hata: {stockQuery.error instanceof Error ? stockQuery.error.message : 'Bilinmeyen hata'}</Text>
          ) : (
            <FlatList
              data={filteredProducts}
              keyExtractor={(x) => x.id}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.listContainer}
              ListEmptyComponent={() => (
                <EmptyState message="Ürün bulunamadı." />
              )}
              renderItem={({ item }) => {
                const st = getStatus(item);
                return (
                  <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={() => {
                      setSelectedProductId(item.id);
                      setPartsModalOpen(true);
                    }}
                  >
                    <Card style={styles.productCard}>
                      <View style={styles.productInfoRow}>
                        <View style={styles.productDetailsBlock}>
                          <Text style={styles.productCode}>{item.partNumber || 'Kodsuz'}</Text>
                          <Text style={styles.productName}>{item.name}</Text>
                        </View>
                        
                        <View style={styles.badgeChevronCol}>
                          <Badge
                            label={st === 'out' ? 'Tükenen Var' : st === 'critical' ? 'Kritik' : 'Stok Tamam'}
                            type={st === 'out' ? 'error' : st === 'critical' ? 'warning' : 'success'}
                          />
                          <ChevronRight color={colors.textMuted} size={18} />
                        </View>
                      </View>
                    </Card>
                  </TouchableOpacity>
                );
              }}
            />
          )}

          {/* Spare Parts Modal */}
          <Modal visible={partsModalOpen && selectedProductId !== null} animationType="slide" transparent={true} onRequestClose={() => setPartsModalOpen(false)}>
            <View style={styles.modalOverlay}>
              <View style={[styles.modalContentLarge, isLarge && styles.modalContentLargeSize]}>
                
                <View style={styles.modalHeader}>
                  <View style={styles.modalHeaderTitleBlock}>
                    <PackageOpen color="#B73A0B" size={24} style={{ marginRight: 8 }} />
                    <Text style={styles.modalTitle} numberOfLines={1}>Yedek Parçalar</Text>
                  </View>
                  <TouchableOpacity onPress={() => setPartsModalOpen(false)} style={styles.modalCloseBtn}>
                    <X color={colors.text} size={20} />
                  </TouchableOpacity>
                </View>

                {selectedProduct && (
                  <Card style={styles.productContextBlock}>
                    <Text style={styles.productContextCode}>{selectedProduct.partNumber || 'Kodsuz'}</Text>
                    <Text style={styles.productContextName}>{selectedProduct.name}</Text>
                    {selectedProduct.explodedDiagramUrl ? (
                      <TouchableOpacity
                        activeOpacity={0.9}
                        onPress={() => {
                          setZoomImageUrl(selectedProduct.explodedDiagramUrl || null);
                          setZoomImageTitle(selectedProduct.name);
                          setZoomModalOpen(true);
                        }}
                      >
                        <Image
                          source={toImgSrc(selectedProduct.explodedDiagramUrl)!}
                          style={styles.explodedDiagramImage}
                          resizeMode="contain"
                        />
                      </TouchableOpacity>
                    ) : null}
                  </Card>
                )}

                <FlatList
                  data={selectedParts}
                  keyExtractor={(x) => x.id}
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={styles.partsListContainer}
                  ListEmptyComponent={() => (
                    <View style={styles.emptyParts}>
                      <Archive color={colors.textMuted} size={48} />
                      <Text style={styles.emptyPartsText}>Bu ürüne ait yedek parça bulunamadı.</Text>
                    </View>
                  )}
                  renderItem={({ item: p }) => {
                    const qty = p.quantity ?? 0;
                    const min = p.minStockLevel ?? 0;
                    const isOut = qty === 0;
                    const isCritical = !isOut && min > 0 && qty <= min;

                    return (
                      <Card style={styles.partCard}>
                        <View style={styles.partHeaderRow}>
                          {p.imageUrl ? (
                            <TouchableOpacity
                              activeOpacity={0.9}
                              onPress={() => {
                                setZoomImageUrl(p.imageUrl || null);
                                setZoomImageTitle(p.name);
                                setZoomModalOpen(true);
                              }}
                            >
                              <Image
                                source={toImgSrc(p.imageUrl)!}
                                style={styles.partThumbnail}
                                resizeMode="cover"
                              />
                            </TouchableOpacity>
                          ) : (
                            <View style={styles.partThumbnailPlaceholder}>
                              <Archive color={colors.textMuted} size={16} />
                            </View>
                          )}
                          <View style={styles.partTextCol}>
                            <Text style={styles.partName}>{p.name}</Text>
                            <Text style={styles.partCode}>Kod: {p.partNumber || '-'}</Text>
                            {p.explodedViewPartNumber ? (
                              <Text style={styles.partSchemaNo}>Şema No: {p.explodedViewPartNumber}</Text>
                            ) : null}
                          </View>
                          
                          <Badge 
                            label={`Stok: ${qty}`} 
                            type={isOut ? 'error' : isCritical ? 'warning' : 'success'} 
                          />
                        </View>

                        <TouchableOpacity
                          style={styles.orderBtn}
                          activeOpacity={0.7}
                          onPress={() => {
                            setOrderTarget(p);
                            setOrderQty('1');
                            setOrderModalOpen(true);
                          }}
                        >
                          <Text style={styles.orderBtnText}>Sipariş İste</Text>
                        </TouchableOpacity>
                      </Card>
                    );
                  }}
                />
              </View>
            </View>
          </Modal>

          {/* Recent Requests Modal */}
          <Modal visible={recentModalOpen} animationType="slide" transparent={true} onRequestClose={() => setRecentModalOpen(false)}>
            <View style={styles.modalOverlay}>
              <View style={[styles.modalContentLarge, isLarge && styles.modalContentLargeSize]}>
                <View style={styles.modalHeader}>
                  <View style={styles.modalHeaderTitleBlock}>
                    <History color="#B73A0B" size={24} style={{ marginRight: 8 }} />
                    <Text style={styles.modalTitle}>Son İstekler</Text>
                  </View>
                  <TouchableOpacity onPress={() => setRecentModalOpen(false)} style={styles.modalCloseBtn}>
                    <X color={colors.text} size={20} />
                  </TouchableOpacity>
                </View>

                {recentQuery.isLoading ? (
                  <Spinner style={{ marginTop: 20 }} />
                ) : (
                  <FlatList
                    data={recentQuery.data ?? []}
                    keyExtractor={(x) => x.id}
                    contentContainerStyle={styles.partsListContainer}
                    ListEmptyComponent={() => (
                      <EmptyState message="Henüz yapılmış bir sipariş isteği yok." />
                    )}
                    renderItem={({ item }) => (
                      <Card style={styles.requestCard}>
                        <Text style={styles.requestPartName}>{item.partName}</Text>
                        <View style={styles.requestRow}>
                          <Text style={styles.requestMeta}>{item.technicianName} • Kod: {item.stockCode}</Text>
                          <Badge
                            label={item.status === 'Pending' ? 'Bekliyor' : item.status === 'Completed' ? 'Tamamlandı' : item.status}
                            type={item.status === 'Completed' ? 'success' : 'neutral'}
                          />
                        </View>
                        <Text style={styles.requestQty}>Miktar: {item.quantityRequested} Adet</Text>
                      </Card>
                    )}
                  />
                )}
              </View>
            </View>
          </Modal>

          {/* Order Modal */}
          <Modal visible={orderModalOpen} animationType="fade" transparent={true} onRequestClose={() => setOrderModalOpen(false)}>
            <View style={styles.orderOverlay}>
              <View style={[styles.modalContentSmall, isLarge && styles.modalContentSmallSize]}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitleSmall}>Sipariş Talebi</Text>
                  <TouchableOpacity onPress={() => setOrderModalOpen(false)} style={styles.modalCloseBtn}>
                    <X color={colors.text} size={18} />
                  </TouchableOpacity>
                </View>
                
                <Text style={styles.orderTargetName}>{orderTarget?.name}</Text>
                
                <Text style={styles.inputLabel}>İstenen Miktar (Adet)</Text>
                <TextInput
                  style={styles.qtyInput}
                  value={orderQty}
                  onChangeText={setOrderQty}
                  keyboardType="numeric"
                  autoFocus={true}
                  selectTextOnFocus={true}
                />
                
                <TouchableOpacity
                  style={[styles.submitBtn, orderMutation.isPending && { opacity: 0.5 }]}
                  disabled={orderMutation.isPending}
                  onPress={() => orderMutation.mutate()}
                >
                  <Text style={styles.submitBtnText}>{orderMutation.isPending ? 'Kaydediliyor...' : 'Talebi Gönder'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>

          {/* Zoom Image Modal */}
          <Modal
            visible={zoomModalOpen && zoomImageUrl !== null}
            animationType="fade"
            transparent={true}
            onRequestClose={() => setZoomModalOpen(false)}
          >
            <View style={styles.zoomOverlay}>
              <View style={styles.zoomHeader}>
                <Text style={styles.zoomTitle} numberOfLines={1}>
                  {zoomImageTitle}
                </Text>
                <TouchableOpacity
                  onPress={() => setZoomModalOpen(false)}
                  style={styles.zoomCloseBtn}
                >
                  <X color="#fff" size={24} />
                </TouchableOpacity>
              </View>
              {zoomImageUrl ? (
                <Image
                  source={toImgSrc(zoomImageUrl)!}
                  style={styles.zoomImage}
                  resizeMode="contain"
                />
              ) : null}
            </View>
          </Modal>

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
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  title: { fontSize: 24, fontWeight: '800', color: colors.text },
  subtitle: { fontSize: 13, color: colors.textSub },
  recentBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#B91C1C', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  recentBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },

  statsContainer: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  statBox: { flex: 1, padding: 12, alignItems: 'center' },
  statLabel: { fontSize: 11, color: colors.textMuted, textTransform: 'uppercase', fontWeight: '700', letterSpacing: 0.5 },
  statValue: { fontSize: 20, color: colors.text, fontWeight: '800', marginTop: 4 },

  searchContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.inputBorder, borderRadius: 14, paddingHorizontal: 12, marginBottom: 16 },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, height: 44, color: colors.text, fontSize: 14 },
  errorText: { color: '#ef4444', textAlign: 'center', marginTop: 20 },

  listContainer: { gap: 12, paddingBottom: 95 },
  productCard: { padding: 16 },
  productInfoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  productDetailsBlock: { flex: 1, marginRight: 12 },
  productCode: { fontSize: 11, fontWeight: '800', color: colors.textMuted, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 },
  productName: { fontSize: 15, color: colors.text, fontWeight: '700' },
  badgeChevronCol: { flexDirection: 'row', alignItems: 'center', gap: 8 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end' },
  modalContentLarge: { backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderColor: colors.inputBorder, padding: 20, height: '85%', width: '100%' },
  modalContentLargeSize: { maxWidth: 650, alignSelf: 'center' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalHeaderTitleBlock: { flexDirection: 'row', alignItems: 'center' },
  modalTitle: { fontSize: 20, fontWeight: '800', color: colors.text, maxWidth: 220 },
  modalCloseBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.inputBg, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.inputBorder },
  productContextBlock: { padding: 14, marginBottom: 16 },
  productContextCode: { fontSize: 10, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 },
  productContextName: { fontSize: 15, fontWeight: '800', color: colors.text },

  partsListContainer: { gap: 12, paddingBottom: 40 },
  emptyParts: { alignItems: 'center', justifyContent: 'center', paddingVertical: 40 },
  emptyPartsText: { color: colors.textMuted, marginTop: 12, fontSize: 13, textAlign: 'center' },

  partCard: { padding: 14 },
  partHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  partTextCol: { flex: 1, marginRight: 8 },
  partName: { fontSize: 14, fontWeight: '700', color: colors.text, marginBottom: 2 },
  partCode: { fontSize: 11, color: colors.textSub },
  orderBtn: { backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.inputBorder, paddingVertical: 10, alignItems: 'center', borderRadius: 10 },
  orderBtnText: { color: colors.text, fontSize: 12, fontWeight: '700' },

  requestCard: { padding: 14 },
  requestPartName: { fontSize: 14, fontWeight: '700', color: colors.text, marginBottom: 6 },
  requestRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  requestMeta: { fontSize: 11, color: colors.textSub },
  requestQty: { fontSize: 12, color: colors.text, fontWeight: '700' },

  orderOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', padding: 24 },
  modalContentSmall: { backgroundColor: colors.card, borderRadius: 24, borderWidth: 1, borderColor: colors.inputBorder, padding: 20, width: '100%' },
  modalContentSmallSize: { maxWidth: 450, alignSelf: 'center' },
  modalTitleSmall: { fontSize: 18, fontWeight: '900', color: colors.text },
  orderTargetName: { fontSize: 14, color: colors.textSub, marginVertical: 12, fontWeight: '600' },
  inputLabel: { fontSize: 11, color: colors.textSub, textTransform: 'uppercase', marginBottom: 6, fontWeight: '700', letterSpacing: 0.5 },
  qtyInput: { backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.inputBorder, borderRadius: 12, color: colors.text, padding: 12, fontSize: 16, textAlign: 'center', marginBottom: 20 },
  submitBtn: { backgroundColor: '#B91C1C', padding: 14, borderRadius: 12, alignItems: 'center' },
  submitBtnText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  explodedDiagramImage: {
    width: '100%',
    height: 180,
    marginTop: 10,
    borderRadius: 8,
    backgroundColor: '#ffffff',
  },
  partThumbnail: {
    width: 48,
    height: 48,
    borderRadius: 6,
    marginRight: 10,
    backgroundColor: '#ffffff',
  },
  partThumbnailPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 6,
    marginRight: 10,
    backgroundColor: colors.inputBg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.inputBorder,
  },
  partSchemaNo: {
    fontSize: 11,
    color: '#B73A0B',
    fontWeight: '600',
    marginTop: 2,
  },
  zoomOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  zoomHeader: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 50 : 20,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    zIndex: 10,
  },
  zoomTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    flex: 1,
    marginRight: 10,
  },
  zoomCloseBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomImage: {
    width: '100%',
    height: '80%',
  },
  saleBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#10B981', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  saleBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  warningCard: { padding: 14, backgroundColor: 'rgba(239, 68, 68, 0.1)', borderWidth: 1, borderColor: 'rgba(239, 68, 68, 0.3)', marginBottom: 16 },
  warningText: { color: '#ef4444', fontSize: 13, fontWeight: '600', textAlign: 'center', lineHeight: 18 },
  summaryCard: {
    borderWidth: 1,
    borderColor: '#10B981',
    borderStyle: 'dashed',
    borderRadius: 12,
    padding: 14,
    backgroundColor: isDark ? 'rgba(16, 185, 129, 0.05)' : 'rgba(16, 185, 129, 0.03)',
    marginBottom: 12,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 2,
  },
  summaryLabel: {
    fontSize: 12,
    color: colors.textSub,
    fontWeight: '600',
  },
  summaryValue: {
    fontSize: 13,
    color: colors.text,
    fontWeight: '700',
  },
});
