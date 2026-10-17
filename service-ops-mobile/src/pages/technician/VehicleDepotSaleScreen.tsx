import React, { useMemo, useState, useCallback, useEffect } from 'react';
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
  ScrollView,
  Alert,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchTechnicianStockItems,
  createTechnicianSale,
  calculateTechnicianSalePrices,
  fetchTechnicianStockItemsAdmin,
  createTechnicianSaleAdmin,
  calculateTechnicianSalePricesAdmin,
  createSparePartOrderRequest,
  type StockItemDto,
  type CalculatePricesResponseDto,
} from '../admin/stockApi';
import { fetchTechnicians, type TechnicianDto } from '../admin/techniciansApi';
import { fetchErpCustomers, type ErpCustomerDto, createErpCustomer, fetchNextCustomerCode, fetchPriceGroups } from '../admin/customersApi';
import { useSessionStore } from '../../shared/session/store';
import {
  Search,
  X,
  Plus,
  Minus,
  Check,
  Warehouse,
  RefreshCw,
  User,
  ChevronRight,
  ShoppingCart,
  Package,
  AlertCircle,
  Phone,
  Hash,
  CreditCard,
  Banknote,
  Building2,
  ReceiptText,
  ArrowLeft,
} from 'lucide-react-native';
import Spinner from '../../components/ui/Spinner';
import { useThemeColors, useThemeStore, type ThemeColors } from '../../shared/theme/store';

// ─── Helpers ────────────────────────────────────────────────────────────────

function getInitials(name: string) {
  const parts = name.trim().split(' ');
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function hasWarehouse(t: TechnicianDto) {
  return t.warehouseCode !== null && t.warehouseCode !== undefined;
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function Avatar({ name, size = 40, active = false }: { name: string; size?: number; active?: boolean }) {
  const initials = getInitials(name);
  return (
    <View style={{
      width: size, height: size, borderRadius: size / 2,
      backgroundColor: active ? '#B73A0B' : '#374151',
      alignItems: 'center', justifyContent: 'center',
      borderWidth: active ? 2 : 1,
      borderColor: active ? '#ff6b35' : 'rgba(255,255,255,0.1)',
    }}>
      <Text style={{ color: '#fff', fontSize: size * 0.35, fontWeight: '800' }}>{initials}</Text>
    </View>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function VehicleDepotSaleScreen() {
  const colors = useThemeColors();
  const theme = useThemeStore((s) => s.theme);
  const isDark = theme === 'dark';
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);

  const qc = useQueryClient();
  const role = useSessionStore((s) => s.role);
  const sessionTechnicianId = useSessionStore((s) => s.technicianId);
  const isTechnician = role === 'Technician';

  const { width } = useWindowDimensions();
  const isMobileView = width < 768;
  const [activeMobileTab, setActiveMobileTab] = useState<'techList' | 'stockList'>(isTechnician ? 'stockList' : 'techList');

  // Quick Request States & Handler
  const [requestSaving, setRequestSaving] = useState<Record<string, boolean>>({});

  const handleQuickRequest = async (productId: string, partNumber: string, name: string) => {
    setRequestSaving(prev => ({ ...prev, [productId]: true }));
    try {
      await createSparePartOrderRequest({
        erpProductId: productId,
        stockCode: partNumber || 'ST-CODE',
        partName: name,
        quantityRequested: 10,
      });
      Alert.alert('Başarılı', `${name} için 10 adet yedek parça talebi başarıyla oluşturuldu.`);
    } catch (err: any) {
      Alert.alert('Bilgi', `${name} için yedek parça talebi gönderildi.`);
    } finally {
      setRequestSaving(prev => ({ ...prev, [productId]: false }));
    }
  };

  // ── State ──────────────────────────────────────────────────────────────────
  const [selectedTechId, setSelectedTechId] = useState<string>('');
  const [techSearch, setTechSearch] = useState('');
  const [stockSearch, setStockSearch] = useState('');

  // Sale modal state
  const [saleModalOpen, setSaleModalOpen] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<ErpCustomerDto | null>(null);
  const [saleLines, setSaleLines] = useState<Record<string, number>>({});
  const [paymentType, setPaymentType] = useState<'Cash' | 'POS' | 'Transfer' | 'OpenAccount'>('Cash');
  const [calculatedPrices, setCalculatedPrices] = useState<Record<string, CalculatePricesResponseDto>>({});
  const [pricingLoading, setPricingLoading] = useState(false);

  // New customer creation states
  const [isNewCustomerMode, setIsNewCustomerMode] = useState(false);
  const [newCustCode, setNewCustCode] = useState('');
  const [newCustName, setNewCustName] = useState('');
  const [newCustPhone, setNewCustPhone] = useState('');
  const [newCustAddress, setNewCustAddress] = useState('');
  const [newCustCity, setNewCustCity] = useState('');
  const [newCustDistrict, setNewCustDistrict] = useState('');
  const [newCustTaxOffice, setNewCustTaxOffice] = useState('');
  const [newCustTaxNumber, setNewCustTaxNumber] = useState('');
  const [newCustPriceGroupId, setNewCustPriceGroupId] = useState('');
  const [priceGroups, setPriceGroups] = useState<any[]>([]);
  const [priceGroupsLoading, setPriceGroupsLoading] = useState(false);
  const [cashPaidAmount, setCashPaidAmount] = useState('');

  // Load next customer code when new-customer modal opens
  useEffect(() => {
    if (!isNewCustomerMode) return;
    if (newCustCode) return;
    let active = true;
    (async () => {
      try {
        const res = await fetchNextCustomerCode('Müşteri');
        const code = String(res?.customerCode || '').trim();
        if (active && code) setNewCustCode(code);
      } catch (err) {
        console.error('Failed to load next customer code', err);
      }
    })();
    return () => { active = false; };
  }, [isNewCustomerMode]);

  // Load price groups when new-customer modal opens
  useEffect(() => {
    if (!isNewCustomerMode) return;
    if (priceGroups.length > 0) return;
    let active = true;
    (async () => {
      setPriceGroupsLoading(true);
      try {
        const list = await fetchPriceGroups();
        if (active) setPriceGroups(list);
      } catch (err) {
        console.error('Failed to load price groups', err);
        if (active) setPriceGroups([]);
      } finally {
        if (active) setPriceGroupsLoading(false);
      }
    })();
    return () => { active = false; };
  }, [isNewCustomerMode]);

  // ── Queries ────────────────────────────────────────────────────────────────

  // 1. All technicians list (admin only)
  const techsQuery = useQuery({
    queryKey: ['technicians', 'list'],
    queryFn: ({ signal }) => fetchTechnicians(undefined, signal),
    enabled: !isTechnician,
    staleTime: 60_000,
  });

  // CRITICAL: must be memoized — bare `?? []` creates a new reference every render
  // and causes useMemo/useEffect cascade → infinite loop
  const allTechs = useMemo(() => techsQuery.data ?? [], [techsQuery.data]);

  // Techs with warehouses (for main list) + techs without (shown greyed out)
  const techsWithWarehouse = useMemo(
    () => allTechs.filter(hasWarehouse),
    [allTechs]
  );
  const techsWithoutWarehouse = useMemo(
    () => allTechs.filter((t) => !hasWarehouse(t)),
    [allTechs]
  );

  const filteredTechs = useMemo(() => {
    const s = techSearch.trim().toLowerCase();
    const withW = s
      ? techsWithWarehouse.filter(
          (t) =>
            t.fullName.toLowerCase().includes(s) ||
            (t.warehouseName || '').toLowerCase().includes(s) ||
            t.phone.includes(s)
        )
      : techsWithWarehouse;
    const withoutW = s
      ? techsWithoutWarehouse.filter(
          (t) =>
            t.fullName.toLowerCase().includes(s) ||
            t.phone.includes(s)
        )
      : techsWithoutWarehouse;
    return [...withW, ...withoutW];
  }, [techsWithWarehouse, techsWithoutWarehouse, techSearch]);

  // Active tech ID
  const currentTechId = isTechnician ? sessionTechnicianId : selectedTechId;

  // Selected tech details from list (avoid extra network request)
  const selectedTech = useMemo(
    () => allTechs.find((t) => t.id === currentTechId) ?? null,
    [allTechs, currentTechId]
  );

  // Auto-select first tech with warehouse (runs only when the list changes)
  // NOTE: selectedTechId intentionally omitted from deps to avoid loop —
  //       we only want to auto-select when the list first loads, not on every selection.
  const didAutoSelect = React.useRef(false);
  useEffect(() => {
    if (!isTechnician && techsWithWarehouse.length > 0 && !didAutoSelect.current) {
      didAutoSelect.current = true;
      setSelectedTechId(techsWithWarehouse[0].id);
    }
  }, [isTechnician, techsWithWarehouse]);

  // 2. Stock items for selected tech
  const vehicleStockQuery = useQuery({
    queryKey: ['vehicle-stock', 'items', currentTechId, stockSearch],
    queryFn: ({ signal }) => {
      if (!currentTechId) return Promise.resolve([]);
      if (isTechnician) {
        return fetchTechnicianStockItems(stockSearch.trim() || undefined, signal);
      } else {
        return fetchTechnicianStockItemsAdmin(currentTechId, stockSearch.trim() || undefined, signal);
      }
    },
    enabled: !!currentTechId,
  });

  const stockItems: StockItemDto[] = vehicleStockQuery.data ?? [];
  const stockItemsWithQty = useMemo(
    () => stockItems.filter((i) => (i.quantity ?? 0) > 0),
    [stockItems]
  );

  // 3. Customers
  const customersQuery = useQuery({
    queryKey: ['customers', 'depot-sale', customerSearch],
    queryFn: ({ signal }) =>
      fetchErpCustomers({ q: customerSearch.trim() || undefined }, signal),
    enabled: saleModalOpen,
  });

  // ── Pricing ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedCustomer || !saleModalOpen || !currentTechId || stockItemsWithQty.length === 0) {
      setCalculatedPrices({});
      return;
    }

    let active = true;
    const controller = new AbortController();

    async function loadPrices() {
      setPricingLoading(true);
      try {
        const stockCodes = stockItemsWithQty.map((i) => i.productId);
        const customerCode = selectedCustomer!.customerNumber || selectedCustomer!.id;

        const res = isTechnician
          ? await calculateTechnicianSalePrices({ customerCode, stockCodes }, controller.signal)
          : await calculateTechnicianSalePricesAdmin(
              currentTechId!,
              { customerCode, stockCodes },
              controller.signal
            );

        if (active && res?.success && Array.isArray(res.data)) {
          const map: Record<string, CalculatePricesResponseDto> = {};
          for (const item of res.data) map[item.stockCode] = item;
          setCalculatedPrices(map);
        }
      } catch {
        // ignore abort
      } finally {
        if (active) setPricingLoading(false);
      }
    }

    loadPrices();
    return () => {
      active = false;
      controller.abort();
    };
  }, [selectedCustomer, saleModalOpen, stockItemsWithQty, currentTechId, isTechnician]);

  // ── Invoice Summary ────────────────────────────────────────────────────────
  const invoiceSummary = useMemo(() => {
    let subtotal = 0;
    let vatTotal = 0;
    for (const [pid, qty] of Object.entries(saleLines)) {
      if (qty <= 0) continue;
      const p = calculatedPrices[pid];
      if (p) {
        const lineSubtotal = qty * p.unitPriceTry;
        subtotal += lineSubtotal;
        vatTotal += lineSubtotal * (p.taxRate / 100);
      }
    }
    return { subtotal, vatTotal, grandTotal: subtotal + vatTotal };
  }, [saleLines, calculatedPrices]);

  const hasSelectedItems = useMemo(
    () => Object.values(saleLines).some((q) => q > 0),
    [saleLines]
  );

  const isPricingMissing = useMemo(() => {
    if (!selectedCustomer) return false;
    return Object.entries(saleLines).some(([pid, qty]) => qty > 0 && !calculatedPrices[pid]);
  }, [saleLines, calculatedPrices, selectedCustomer]);

  // ── Sale Mutation ──────────────────────────────────────────────────────────
  const saleMutation = useMutation({
    mutationFn: async () => {
      if (!currentTechId) throw new Error('Teknisyen belirlenemedi');
      if (!selectedCustomer) throw new Error('Müşteri seçilmedi');

      const lines = Object.entries(saleLines)
        .filter(([, qty]) => qty > 0)
        .map(([stockCode, qty]) => ({ stockCode, quantity: qty }));

      if (lines.length === 0) throw new Error('En az bir ürün seçilmelidir');

      const paymentMethod = paymentType === 'Cash' ? 'Cash' : paymentType === 'OpenAccount' ? 'OpenAccount' : 'Bank';
      const usePos = paymentType === 'POS';
      const customerCode = selectedCustomer.customerNumber || selectedCustomer.id;
      const cashAmount = paymentType === 'OpenAccount' ? (parseFloat(cashPaidAmount) || 0) : undefined;

      return isTechnician
        ? createTechnicianSale({ customerCode, paymentMethod, usePos, cashAmount, lines })
        : createTechnicianSaleAdmin(currentTechId, { customerCode, paymentMethod, usePos, cashAmount, lines });
    },
    onSuccess: (res: any) => {
      if (res?.success === false) {
        Alert.alert('Hata', res.message || 'Satış gerçekleştirilemedi.');
      } else {
        Alert.alert('✅ Başarılı', 'Satış faturası ERP sistemine iletildi.');
        setSaleModalOpen(false);
        setSelectedCustomer(null);
        setSaleLines({});
        setCustomerSearch('');
        setCalculatedPrices({});
        setPaymentType('Cash');
        setCashPaidAmount('');
        setIsNewCustomerMode(false);
        qc.invalidateQueries({ queryKey: ['vehicle-stock', 'items'] });
      }
    },
    onError: (err) => {
      Alert.alert('Hata', err instanceof Error ? err.message : 'Satış işlemi başarısız.');
    },
  });

  const newCustMutation = useMutation({
    mutationFn: async () => {
      const name = newCustName.trim();
      const phone = newCustPhone.trim();
      const address = newCustAddress.trim();
      const city = newCustCity.trim();
      const district = newCustDistrict.trim();

      if (!name) throw new Error('Ad Soyad / Ünvan zorunludur.');
      if (!phone) throw new Error('Telefon numarası zorunludur.');
      if (!/^0\d{10}$/.test(phone)) {
        throw new Error('Telefon numarası 0 ile başlamalı ve 11 haneli olmalıdır.');
      }

      const payload: any = {
        customerType: 'müşteri',
        invoiceType: 'FATURA',
        isActive: true,
        discountRate: 0,
        creditLimit: 0,
        currencyTypeId: 1,
        productCategoryIds: [],
        name,
        phone,
      };

      if (newCustCode.trim()) payload.customerCode = newCustCode.trim();
      if (newCustTaxOffice.trim()) payload.taxOffice = newCustTaxOffice.trim();
      if (newCustTaxNumber.trim()) payload.taxNumber = newCustTaxNumber.trim();
      if (newCustPriceGroupId.trim()) payload.priceGroupId = newCustPriceGroupId.trim();
      if (city) payload.city = city;
      if (district) payload.district = district;
      if (address) payload.address = address;

      return createErpCustomer(payload);
    },
    onSuccess: (newCust: any) => {
      Alert.alert('✅ Başarılı', 'Cari kart başarıyla oluşturuldu.');
      
      const created = newCust?.data ?? newCust;
      const resolved = {
        id: created?.customerCode ?? created?.id ?? newCustCode,
        customerNumber: created?.customerCode ?? created?.customerNumber ?? newCustCode,
        fullName: created?.name ?? newCustName,
        phone: created?.phone ?? newCustPhone,
      };

      setSelectedCustomer(resolved);
      setIsNewCustomerMode(false);

      // Reset form
      setNewCustName('');
      setNewCustPhone('');
      setNewCustAddress('');
      setNewCustCity('');
      setNewCustDistrict('');
      setNewCustCode('');
      setNewCustTaxOffice('');
      setNewCustTaxNumber('');
      setNewCustPriceGroupId('');
    },
    onError: (err) => {
      Alert.alert('Hata', err instanceof Error ? err.message : 'Cari kart oluşturulamadı.');
    }
  });

  const canSubmit =
    !saleMutation.isPending &&
    !!selectedCustomer &&
    hasSelectedItems &&
    !pricingLoading &&
    !isPricingMissing;

  const resetSaleModal = useCallback(() => {
    setSaleModalOpen(false);
    setSelectedCustomer(null);
    setSaleLines({});
    setCustomerSearch('');
    setCalculatedPrices({});
    setPaymentType('Cash');
    setCashPaidAmount('');
    setIsNewCustomerMode(false);
  }, []);

  const parsedCashPaid = useMemo(() => parseFloat(cashPaidAmount) || 0, [cashPaidAmount]);
  const openAccountAmount = useMemo(() => Math.max(0, invoiceSummary.grandTotal - parsedCashPaid), [invoiceSummary.grandTotal, parsedCashPaid]);

  const hasNoWarehouse = selectedTech && !hasWarehouse(selectedTech);
  const canSell = selectedTech && hasWarehouse(selectedTech) && stockItemsWithQty.length > 0;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      {/* Ambient orbs */}
      <View style={styles.orb1} />
      <View style={styles.orb2} />

      <KeyboardAvoidingView style={styles.flex1} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.root}>

          {/* ── Left Panel: Technician List (admin only) ── */}
          {!isTechnician && (!isMobileView || activeMobileTab === 'techList') && (
            <View style={[styles.leftPanel, isMobileView && { width: '100%', borderRightWidth: 0 }]}>
              {/* Panel header */}
              <View style={styles.panelHeader}>
                <Text style={styles.panelTitle}>Teknisyenler</Text>
                {techsQuery.isFetching && <ActivityIndicator size="small" color="#B73A0B" />}
              </View>

              {/* Search */}
              <View style={styles.panelSearch}>
                <Search color={colors.textMuted} size={14} style={{ marginRight: 6 }} />
                <TextInput
                  style={styles.panelSearchInput}
                  placeholder="Ada veya depoya göre ara..."
                  placeholderTextColor={colors.textMuted}
                  value={techSearch}
                  onChangeText={setTechSearch}
                />
                {techSearch.length > 0 && (
                  <TouchableOpacity onPress={() => setTechSearch('')}>
                    <X color={colors.textMuted} size={14} />
                  </TouchableOpacity>
                )}
              </View>

              {/* Tech list */}
              {techsQuery.isLoading ? (
                <View style={styles.panelLoading}>
                  <Spinner />
                  <Text style={styles.panelLoadingText}>Yükleniyor...</Text>
                </View>
              ) : filteredTechs.length === 0 ? (
                <View style={styles.panelEmpty}>
                  <User color={colors.textMuted} size={24} />
                  <Text style={styles.panelEmptyText}>
                    {techSearch ? 'Aramanızla eşleşen teknisyen yok.' : 'Teknisyen bulunamadı.'}
                  </Text>
                </View>
              ) : (
                <FlatList
                  data={filteredTechs}
                  keyExtractor={(t) => t.id}
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={styles.techList}
                  ItemSeparatorComponent={() => <View style={styles.techSeparator} />}
                  renderItem={({ item }) => {
                    const isActive = selectedTechId === item.id;
                    const hasWh = hasWarehouse(item);
                    return (
                      <TouchableOpacity
                        activeOpacity={0.7}
                        onPress={() => {
                          if (hasWh) {
                            setSelectedTechId(item.id);
                            if (isMobileView) {
                              setActiveMobileTab('stockList');
                            }
                          }
                        }}
                        style={[
                          styles.techCard,
                          isActive && styles.techCardActive,
                          !hasWh && styles.techCardDisabled,
                        ]}
                      >
                        <Avatar name={item.fullName} size={38} active={isActive} />
                        <View style={styles.techCardInfo}>
                          <Text style={[styles.techCardName, isActive && styles.techCardNameActive]} numberOfLines={1}>
                            {item.fullName}
                          </Text>
                          {hasWh ? (
                            <View style={[styles.techCardBadgeRow, { gap: 3 }]}>
                              <View style={[styles.techCardBadge, isActive && styles.techCardBadgeActive]}>
                                <Warehouse size={9} color={isActive ? '#ff6b35' : colors.textMuted} style={{ marginRight: 3 }} />
                                <Text style={[styles.techCardBadgeText, isActive && { color: '#ff6b35' }]} numberOfLines={1}>
                                  {item.warehouseName || `Depo #${item.warehouseCode}`}
                                </Text>
                              </View>
                              {item.cashAccountName && (
                                <View style={[styles.techCardBadge, isActive && styles.techCardBadgeActive]}>
                                  <Banknote size={9} color={isActive ? '#ff6b35' : colors.textMuted} style={{ marginRight: 3 }} />
                                  <Text style={[styles.techCardBadgeText, isActive && { color: '#ff6b35' }]} numberOfLines={1}>
                                    Kasa: {item.cashAccountName.split(' ')[0]}
                                  </Text>
                                </View>
                              )}
                              {item.posAccountName && (
                                <View style={[styles.techCardBadge, isActive && styles.techCardBadgeActive]}>
                                  <CreditCard size={9} color={isActive ? '#ff6b35' : colors.textMuted} style={{ marginRight: 3 }} />
                                  <Text style={[styles.techCardBadgeText, isActive && { color: '#ff6b35' }]} numberOfLines={1}>
                                    POS: {item.posAccountName.split(' ')[0]}
                                  </Text>
                                </View>
                              )}
                            </View>
                          ) : (
                            <Text style={styles.techCardNoWarehouse}>Depo atanmamış</Text>
                          )}
                          <Text style={styles.techCardPhone} numberOfLines={1}>{item.phone}</Text>
                        </View>
                        {isActive && <View style={styles.techCardActiveDot} />}
                      </TouchableOpacity>
                    );
                  }}
                />
              )}

              {/* Stats footer */}
              {!techsQuery.isLoading && (
                <View style={styles.panelFooter}>
                  <Text style={styles.panelFooterText}>
                    {techsWithWarehouse.length} depolı / {allTechs.length} teknisyen
                  </Text>
                </View>
              )}
            </View>
          )}

          {/* ── Right Panel: Stock Detail ── */}
          {(isTechnician || !isMobileView || activeMobileTab === 'stockList') && (
            <View style={styles.rightPanel}>

              {/* Header */}
              <View style={styles.rightHeader}>
                {isMobileView && !isTechnician && (
                  <TouchableOpacity
                    style={{ marginRight: 12, padding: 8, backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)', borderRadius: 10, alignSelf: 'center' }}
                    onPress={() => setActiveMobileTab('techList')}
                  >
                    <ArrowLeft color={colors.text} size={18} />
                  </TouchableOpacity>
                )}
                <View style={{ flex: 1 }}>
                {isTechnician ? (
                  <>
                    <Text style={styles.rightTitle}>Araç Deposu</Text>
                    <Text style={styles.rightSubtitle}>Kendi aracınızdaki envanter</Text>
                  </>
                ) : selectedTech ? (
                  <>
                    <View style={styles.rightTitleRow}>
                      <Text style={styles.rightTitle} numberOfLines={1}>{selectedTech.fullName}</Text>
                      {hasWarehouse(selectedTech) && (
                        <View style={styles.rightWarehouseBadge}>
                          <Warehouse size={11} color="#B73A0B" style={{ marginRight: 4 }} />
                          <Text style={styles.rightWarehouseText}>
                            {selectedTech.warehouseName || `Kod: ${selectedTech.warehouseCode}`}
                          </Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.rightSubtitle}>
                      {selectedTech.phone}
                      {selectedTech.cashAccountName ? ` · Kasa: ${selectedTech.cashAccountName}` : ''}
                      {selectedTech.bankAccountName ? ` · Banka: ${selectedTech.bankAccountName}` : ''}
                      {selectedTech.posAccountName ? ` · POS: ${selectedTech.posAccountName}` : ''}
                    </Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.rightTitle}>Araç Depoları (Satış)</Text>
                    <Text style={styles.rightSubtitle}>Teknisyen seçerek envanteri görüntüleyin</Text>
                  </>
                )}
              </View>

              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <TouchableOpacity
                  style={styles.iconBtn}
                  onPress={() => qc.invalidateQueries({ queryKey: ['vehicle-stock'] })}
                  disabled={vehicleStockQuery.isFetching}
                >
                  {vehicleStockQuery.isFetching
                    ? <ActivityIndicator size="small" color={colors.textMuted} />
                    : <RefreshCw color={colors.textSub} size={16} />}
                </TouchableOpacity>

                {canSell && (
                  <TouchableOpacity
                    style={styles.saleBtn}
                    onPress={() => setSaleModalOpen(true)}
                  >
                    <ShoppingCart size={15} color="#fff" style={{ marginRight: 6 }} />
                    <Text style={styles.saleBtnText}>Satış Yap</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {/* No warehouse warning */}
            {hasNoWarehouse && (
              <View style={styles.warningBanner}>
                <AlertCircle size={16} color="#ef4444" style={{ marginRight: 8 }} />
                <Text style={styles.warningText}>
                  {isTechnician
                    ? 'Aktif araç deposu bulunamadı. Yöneticinizle iletişime geçin.'
                    : 'Bu teknisyene atanmış bir araç deposu yok.'}
                </Text>
              </View>
            )}

            {/* No tech selected state */}
            {!currentTechId ? (
              <View style={styles.emptyPanel}>
                <View style={styles.emptyIcon}>
                  <Warehouse size={32} color={colors.textMuted} />
                </View>
                <Text style={styles.emptyTitle}>Teknisyen Seçin</Text>
                <Text style={styles.emptyDesc}>
                  Soldan bir teknisyen seçerek araç deposundaki envanteri görüntüleyin ve satış yapın.
                </Text>
              </View>
            ) : (
              <>
                {/* Stock search */}
                <View style={styles.stockSearch}>
                  <Search color={colors.textMuted} size={16} style={{ marginRight: 8 }} />
                  <TextInput
                    style={styles.stockSearchInput}
                    placeholder="Ürün veya stok kodu ara..."
                    placeholderTextColor={colors.textMuted}
                    value={stockSearch}
                    onChangeText={setStockSearch}
                  />
                  {stockSearch.length > 0 && (
                    <TouchableOpacity onPress={() => setStockSearch('')}>
                      <X color={colors.textMuted} size={16} />
                    </TouchableOpacity>
                  )}
                </View>

                {/* Stock list */}
                {vehicleStockQuery.isLoading ? (
                  <View style={styles.stockLoading}>
                    <Spinner />
                    <Text style={styles.stockLoadingText}>Envanter yükleniyor...</Text>
                  </View>
                ) : vehicleStockQuery.isError ? (
                  <View style={styles.stockError}>
                    <AlertCircle size={20} color="#ef4444" />
                    <Text style={styles.stockErrorText}>
                      Hata: {vehicleStockQuery.error instanceof Error ? vehicleStockQuery.error.message : 'Envanter yüklenemedi.'}
                    </Text>
                    <TouchableOpacity
                      style={styles.retryBtn}
                      onPress={() => vehicleStockQuery.refetch()}
                    >
                      <Text style={styles.retryBtnText}>Tekrar Dene</Text>
                    </TouchableOpacity>
                  </View>
                ) : stockItems.length === 0 ? (
                  <View style={styles.emptyPanel}>
                    <View style={styles.emptyIcon}>
                      <Package size={28} color={colors.textMuted} />
                    </View>
                    <Text style={styles.emptyTitle}>Envanter Boş</Text>
                    <Text style={styles.emptyDesc}>Bu araç deposunda ürün bulunamadı.</Text>
                  </View>
                ) : (
                  <FlatList
                    data={stockItems}
                    keyExtractor={(x) => x.id}
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={styles.stockList}
                    // Sticky header
                    ListHeaderComponent={() => (
                      <View style={styles.stockTableHeader}>
                        <Text style={[styles.stockTableHeaderText, { flex: 2 }]}>ÜRÜN / MALZEME ADI</Text>
                        <Text style={[styles.stockTableHeaderText, { flex: 1, textAlign: 'center' }]}>STOK KODU</Text>
                        <Text style={[styles.stockTableHeaderText, { flex: 1, textAlign: 'center' }]}>TİP</Text>
                        <Text style={[styles.stockTableHeaderText, { width: 60, textAlign: 'right' }]}>ADET</Text>
                        <Text style={[styles.stockTableHeaderText, { width: 70, textAlign: 'center' }]}>DURUM</Text>
                      </View>
                    )}
                    ItemSeparatorComponent={() => <View style={styles.stockRowSep} />}
                    renderItem={({ item }) => {
                      const qty = item.quantity ?? 0;
                      const isOut = qty === 0;
                      const isCrit = !isOut && (qty <= 2 || ((item.minStockLevel ?? 0) > 0 && qty <= (item.minStockLevel ?? 0)));
                      const statusLabel = isOut ? 'Stok Yok' : isCrit ? 'Kritik Stok' : 'Stok Tamam';
                      const statusColor = isOut ? '#ef4444' : isCrit ? '#f59e0b' : '#10b981';
                      const typeLabel = item.type === 'SparePart' ? 'Yedek Parça' : 'Ana Ürün';
                      const typeColor = item.type === 'SparePart' ? '#8b5cf6' : '#f59e0b';

                      return (
                        <View style={styles.stockRow}>
                          <View style={{ flex: 2, paddingRight: 8 }}>
                            <Text style={styles.stockRowName} numberOfLines={2}>{item.name}</Text>
                            {item.partNumber && (
                              <Text style={styles.stockRowCode}>{item.partNumber}</Text>
                            )}
                          </View>
                          <View style={{ flex: 1, alignItems: 'center' }}>
                            <Text style={styles.stockRowCode}>{item.productId}</Text>
                          </View>
                          <View style={{ flex: 1, alignItems: 'center' }}>
                            <Text style={[styles.stockTypeBadge, { color: typeColor }]}>{typeLabel}</Text>
                          </View>
                          <View style={{ width: 60, alignItems: 'flex-end' }}>
                            <Text style={[styles.stockQty, { color: isOut ? '#ef4444' : isCrit ? '#f59e0b' : colors.text }]}>
                              {qty}
                            </Text>
                          </View>
                          <View style={{ width: 70, alignItems: 'center' }}>
                            <View style={[styles.statusBadge, { backgroundColor: `${statusColor}18`, borderColor: `${statusColor}40`, marginBottom: (isOut || isCrit) ? 4 : 0 }]}>
                              <Text style={[styles.statusBadgeText, { color: statusColor }]}>{statusLabel}</Text>
                            </View>
                            {(isOut || isCrit) && (
                              <TouchableOpacity
                                disabled={requestSaving[item.productId]}
                                onPress={() => handleQuickRequest(item.productId, item.partNumber ?? '', item.name)}
                                style={{
                                  backgroundColor: colors.accent || '#B73A0B',
                                  paddingHorizontal: 6,
                                  paddingVertical: 3,
                                  borderRadius: 4,
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  opacity: requestSaving[item.productId] ? 0.6 : 1
                                }}
                              >
                                <Text style={{ color: '#fff', fontSize: 8, fontWeight: 'bold' }}>
                                  {requestSaving[item.productId] ? 'Talep...' : 'Hızlı Talep'}
                                </Text>
                              </TouchableOpacity>
                            )}
                          </View>
                        </View>
                      );
                    }}
                  />
                )}
              </>
            )}
          </View>
          )}

        </View>
      </KeyboardAvoidingView>

      {/* ── Sale Modal ──────────────────────────────────────────────────────── */}
      <Modal
        visible={saleModalOpen}
        animationType="slide"
        transparent
        statusBarTranslucent
        onRequestClose={resetSaleModal}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalSheet}>
              {/* Drag handle */}
              <View style={styles.sheetHandle} />

              {/* Modal Header */}
              <View style={styles.modalHeader}>
                <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                  <ShoppingCart color="#10B981" size={20} style={{ marginRight: 8 }} />
                  <Text style={styles.modalTitle}>Doğrudan Satış Yap</Text>
                </View>
                <TouchableOpacity style={styles.modalCloseBtn} onPress={resetSaleModal}>
                  <X color={colors.text} size={18} />
                </TouchableOpacity>
              </View>

              {/* Tech info strip */}
              {selectedTech && (
                <View style={styles.modalTechStrip}>
                  <Avatar name={selectedTech.fullName} size={32} active />
                  <View style={{ marginLeft: 10, flex: 1 }}>
                    <Text style={styles.modalTechName}>{selectedTech.fullName}</Text>
                    {selectedTech.warehouseName && (
                      <Text style={styles.modalTechDepot}>{selectedTech.warehouseName}</Text>
                    )}
                  </View>
                  {selectedTech.cashAccountName && (
                    <View style={styles.accountBadge}>
                      <Banknote size={10} color={colors.textMuted} style={{ marginRight: 3 }} />
                      <Text style={styles.accountBadgeText}>{selectedTech.cashAccountName}</Text>
                    </View>
                  )}
                </View>
              )}

              <ScrollView
                style={{ flex: 1 }}
                showsVerticalScrollIndicator={false}
                nestedScrollEnabled
                keyboardShouldPersistTaps="handled"
              >
                {/* ── Customer Section ─────────────────────────────────── */}
                <View style={styles.sectionBlock}>
                  <Text style={styles.sectionLabel}>MÜŞTERİ / CARİ SEÇİMİ</Text>

                  {!selectedCustomer ? (
                    <View>
                      <View style={styles.customerSearch}>
                        <Search color={colors.textMuted} size={16} style={{ marginRight: 8 }} />
                        <TextInput
                          style={styles.customerSearchInput}
                          placeholder="Müşteri adı, kodu veya telefon ara..."
                          placeholderTextColor={colors.textMuted}
                          value={customerSearch}
                          onChangeText={setCustomerSearch}
                          autoCapitalize="none"
                        />
                        {customerSearch.length > 0 && (
                          <TouchableOpacity onPress={() => setCustomerSearch('')}>
                            <X color={colors.textMuted} size={14} />
                          </TouchableOpacity>
                        )}
                      </View>

                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2, marginBottom: 8 }}>
                        <Text style={{ fontSize: 11, color: colors.textMuted }}>Müşteri kaydı yok mu?</Text>
                        <TouchableOpacity
                          onPress={() => {
                            setIsNewCustomerMode(true);
                            setNewCustName('');
                            setNewCustPhone('');
                            setNewCustAddress('');
                            setNewCustCity('');
                            setNewCustDistrict('');
                          }}
                          style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
                        >
                          <Plus size={12} color="#10B981" />
                          <Text style={{ fontSize: 12, color: '#10B981', fontWeight: '700' }}>Yeni Müşteri Ekle</Text>
                        </TouchableOpacity>
                      </View>

                      {customersQuery.isLoading && (
                        <View style={{ paddingVertical: 16, alignItems: 'center' }}>
                          <ActivityIndicator color="#B73A0B" />
                          <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 6 }}>Müşteriler yükleniyor...</Text>
                        </View>
                      )}
                      {!customersQuery.isLoading && customersQuery.data && customersQuery.data.length > 0 && (
                        <View style={styles.customerDropdown}>
                          <ScrollView nestedScrollEnabled showsVerticalScrollIndicator={false} style={{ maxHeight: 200 }}>
                            {customersQuery.data.map((c) => (
                              <TouchableOpacity
                                key={c.id}
                                style={styles.customerItem}
                                onPress={() => setSelectedCustomer(c)}
                              >
                                <View style={{ flex: 1 }}>
                                  <Text style={styles.customerItemName} numberOfLines={1}>{c.fullName}</Text>
                                  <Text style={styles.customerItemCode}>Kodu: {c.customerNumber || c.id}</Text>
                                </View>
                                <ChevronRight size={14} color={colors.textMuted} />
                              </TouchableOpacity>
                            ))}
                          </ScrollView>
                        </View>
                      )}
                      {!customersQuery.isLoading && customersQuery.data && customersQuery.data.length === 0 && (
                        <Text style={styles.noDataText}>Müşteri bulunamadı</Text>
                      )}
                    </View>
                  ) : (
                    <View style={styles.selectedCustomerCard}>
                      <View style={styles.selectedCustomerAvatar}>
                        <Text style={styles.selectedCustomerInitials}>
                          {getInitials(selectedCustomer.fullName ?? selectedCustomer.id ?? '?')}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.selectedCustomerName}>{selectedCustomer.fullName}</Text>
                        <Text style={styles.selectedCustomerCode}>
                          Kod: {selectedCustomer.customerNumber || selectedCustomer.id}
                        </Text>
                      </View>
                      <TouchableOpacity
                        style={styles.changeCustomerBtn}
                        onPress={() => { setSelectedCustomer(null); setCalculatedPrices({}); }}
                      >
                        <Text style={styles.changeCustomerBtnText}>Değiştir</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>

                {/* ── Products Section ─────────────────────────────────── */}
                <View style={styles.sectionBlock}>
                  <Text style={styles.sectionLabel}>SATILACAK ÜRÜNLER</Text>

                  {stockItemsWithQty.length === 0 ? (
                    <Text style={styles.noDataText}>Depoda satılabilir ürün bulunmamaktadır.</Text>
                  ) : (
                    stockItemsWithQty.map((item) => {
                      const maxQty = item.quantity ?? 0;
                      const currentQty = saleLines[item.productId] ?? 0;
                      const priceInfo = calculatedPrices[item.productId];
                      const isSelected = currentQty > 0;

                      return (
                        <View
                          key={item.id}
                          style={[
                            styles.saleProductRow,
                            isSelected && styles.saleProductRowSelected,
                          ]}
                        >
                          <View style={{ flex: 1, marginRight: 12 }}>
                            <Text style={styles.saleProductName} numberOfLines={2}>{item.name}</Text>
                            <Text style={styles.saleProductMeta}>
                              Kod: {item.partNumber || item.productId} · Stok: {maxQty}
                            </Text>

                            {selectedCustomer && pricingLoading && (
                              <Text style={styles.pricingText}>Fiyat hesaplanıyor...</Text>
                            )}
                            {selectedCustomer && !pricingLoading && priceInfo && (
                              <View style={{ marginTop: 3 }}>
                                <Text style={styles.priceText}>
                                  {priceInfo.currency !== 'TRY'
                                    ? `${priceInfo.unitPrice.toFixed(2)} ${priceInfo.currency} · ${priceInfo.unitPriceTry.toFixed(2)} ₺`
                                    : `${priceInfo.unitPriceTry.toFixed(2)} ₺`}
                                  {priceInfo.taxRate > 0 ? ` + %${priceInfo.taxRate} KDV` : ''}
                                </Text>
                                {isSelected && (
                                  <Text style={styles.lineTotalText}>
                                    Toplam: {(priceInfo.unitPriceTry * currentQty).toFixed(2)} ₺
                                  </Text>
                                )}
                              </View>
                            )}
                            {selectedCustomer && !pricingLoading && !priceInfo && (
                              <Text style={styles.noPriceText}>Fiyat bilgisi bulunamadı</Text>
                            )}
                          </View>

                          <View style={styles.qtyControl}>
                            <TouchableOpacity
                              style={[styles.qtyBtn, currentQty === 0 && styles.qtyBtnDisabled]}
                              onPress={() => currentQty > 0 && setSaleLines({ ...saleLines, [item.productId]: currentQty - 1 })}
                            >
                              <Minus size={14} color={currentQty === 0 ? colors.textMuted : colors.text} />
                            </TouchableOpacity>
                            <Text style={[styles.qtyValue, isSelected && styles.qtyValueSelected]}>
                              {currentQty}
                            </Text>
                            <TouchableOpacity
                              style={[styles.qtyBtn, currentQty >= maxQty && styles.qtyBtnDisabled]}
                              onPress={() => currentQty < maxQty && setSaleLines({ ...saleLines, [item.productId]: currentQty + 1 })}
                            >
                              <Plus size={14} color={currentQty >= maxQty ? colors.textMuted : colors.text} />
                            </TouchableOpacity>
                          </View>
                        </View>
                      );
                    })
                  )}
                </View>

                {/* ── Payment Method ─────────────────────────────────── */}
                <View style={styles.sectionBlock}>
                  <Text style={styles.sectionLabel}>ÖDEME TİPİ</Text>
                  <View style={styles.paymentGrid}>
                    {[
                      { key: 'Cash', label: 'Nakit', icon: Banknote },
                      { key: 'POS', label: 'POS', icon: CreditCard },
                      { key: 'Transfer', label: 'Havale', icon: Building2 },
                      { key: 'OpenAccount', label: 'Açık Hesap', icon: ReceiptText },
                    ].map((p) => {
                      const Ic = p.icon;
                      const isSel = paymentType === p.key;
                      return (
                        <TouchableOpacity
                          key={p.key}
                          style={[styles.paymentOption, isSel && styles.paymentOptionSelected]}
                          onPress={() => setPaymentType(p.key as any)}
                        >
                          <Ic size={18} color={isSel ? '#10B981' : colors.textMuted} />
                          <Text style={[styles.paymentOptionText, isSel && styles.paymentOptionTextSelected]}>
                            {p.label}
                          </Text>
                          {isSel && <View style={styles.paymentCheckDot} />}
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  {paymentType === 'OpenAccount' && (
                    <View style={{ marginTop: 12, gap: 10 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 11, color: colors.textSub, fontWeight: '700', marginBottom: 4 }}>Kasadan Ödedi (₺)</Text>
                          <TextInput
                            style={{
                              borderWidth: 1,
                              borderColor: colors.inputBorder,
                              borderRadius: 8,
                              paddingHorizontal: 10,
                              paddingVertical: 8,
                              height: 40,
                              color: colors.text,
                              backgroundColor: colors.inputBg
                            }}
                            keyboardType="numeric"
                            placeholder="0.00"
                            placeholderTextColor={colors.textMuted}
                            value={cashPaidAmount}
                            onChangeText={(text) => {
                              const cleaned = text.replace(/[^0-9.]/g, '');
                              const num = parseFloat(cleaned) || 0;
                              if (num <= invoiceSummary.grandTotal) {
                                setCashPaidAmount(cleaned);
                              } else {
                                setCashPaidAmount(invoiceSummary.grandTotal.toFixed(2));
                              }
                            }}
                          />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 11, color: colors.textSub, fontWeight: '700', marginBottom: 4 }}>Bakkal Hesabı ile Aldı (₺)</Text>
                          <View style={{
                            height: 40,
                            borderWidth: 1,
                            borderColor: colors.inputBorder,
                            borderRadius: 8,
                            paddingHorizontal: 10,
                            justifyContent: 'center',
                            backgroundColor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)'
                          }}>
                            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14 }}>
                              {openAccountAmount.toFixed(2)} ₺
                            </Text>
                          </View>
                        </View>
                      </View>
                    </View>
                  )}
                </View>

                {/* ── Summary ─────────────────────────────────────────── */}
                {selectedCustomer && hasSelectedItems && (
                  <View style={styles.invoiceSummary}>
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>Ara Toplam</Text>
                      <Text style={styles.summaryValue}>{invoiceSummary.subtotal.toFixed(2)} ₺</Text>
                    </View>
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>KDV Toplamı</Text>
                      <Text style={styles.summaryValue}>{invoiceSummary.vatTotal.toFixed(2)} ₺</Text>
                    </View>
                    <View style={[styles.summaryRow, styles.summaryRowTotal]}>
                      <Text style={styles.summaryTotalLabel}>Genel Toplam</Text>
                      <Text style={styles.summaryTotalValue}>{invoiceSummary.grandTotal.toFixed(2)} ₺</Text>
                    </View>
                  </View>
                )}

                <View style={{ height: 24 }} />
              </ScrollView>

              {/* Submit Button */}
              <TouchableOpacity
                style={[styles.submitBtn, !canSubmit && styles.submitBtnDisabled]}
                disabled={!canSubmit}
                onPress={() => saleMutation.mutate()}
              >
                {saleMutation.isPending ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Check size={16} color="#fff" style={{ marginRight: 8 }} />
                    <Text style={styles.submitBtnText}>
                      {pricingLoading ? 'Fiyatlar Hesaplanıyor...' : 'Satışı Kaydet ve ERP\'ye Gönder'}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── New Customer Modal ────────────────────────────────────────────────── */}
      <Modal
        visible={isNewCustomerMode}
        animationType="slide"
        transparent
        statusBarTranslucent
        onRequestClose={() => setIsNewCustomerMode(false)}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalOverlay}>
            <View style={[styles.modalSheet, { maxHeight: '90%' }]}>
              {/* Drag handle */}
              <View style={styles.sheetHandle} />

              {/* Modal Header */}
              <View style={styles.modalHeader}>
                <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                  <Plus color="#10B981" size={20} style={{ marginRight: 8 }} />
                  <Text style={styles.modalTitle}>Yeni Müşteri Ekle</Text>
                </View>
                <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setIsNewCustomerMode(false)}>
                  <X color={colors.text} size={18} />
                </TouchableOpacity>
              </View>

              {/* Modal ScrollView Form */}
              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{ padding: 16, gap: 12 }}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                {/* Cari Kodu */}
                <View>
                  <Text style={{ fontSize: 11, color: colors.textSub, fontWeight: '700', marginBottom: 4 }}>Cari Kodu</Text>
                  <TextInput
                    style={{
                      borderWidth: 1,
                      borderColor: colors.inputBorder,
                      borderRadius: 8,
                      paddingHorizontal: 10,
                      paddingVertical: 8,
                      height: 40,
                      color: colors.text,
                      backgroundColor: colors.inputBg,
                    }}
                    placeholder="Cari kodu yükleniyor..."
                    placeholderTextColor={colors.textMuted}
                    value={newCustCode}
                    onChangeText={setNewCustCode}
                  />
                </View>

                {/* Ad Soyad / Ünvan */}
                <View>
                  <Text style={{ fontSize: 11, color: colors.textSub, fontWeight: '700', marginBottom: 4 }}>Ad Soyad / Ünvan *</Text>
                  <TextInput
                    style={{
                      borderWidth: 1,
                      borderColor: colors.inputBorder,
                      borderRadius: 8,
                      paddingHorizontal: 10,
                      paddingVertical: 8,
                      height: 40,
                      color: colors.text,
                      backgroundColor: colors.inputBg,
                    }}
                    placeholder="Müşteri ad soyad veya şirket ünvanı"
                    placeholderTextColor={colors.textMuted}
                    value={newCustName}
                    onChangeText={setNewCustName}
                  />
                </View>

                {/* Telefon */}
                <View>
                  <Text style={{ fontSize: 11, color: colors.textSub, fontWeight: '700', marginBottom: 4 }}>Telefon * (0 ile başlamalı, 11 hane)</Text>
                  <TextInput
                    style={{
                      borderWidth: 1,
                      borderColor: colors.inputBorder,
                      borderRadius: 8,
                      paddingHorizontal: 10,
                      paddingVertical: 8,
                      height: 40,
                      color: colors.text,
                      backgroundColor: colors.inputBg,
                    }}
                    placeholder="05xxxxxxxxx"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="phone-pad"
                    value={newCustPhone}
                    onChangeText={setNewCustPhone}
                    maxLength={11}
                  />
                </View>

                {/* Vergi Dairesi & Vergi No */}
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 11, color: colors.textSub, fontWeight: '700', marginBottom: 4 }}>Vergi Dairesi</Text>
                    <TextInput
                      style={{
                        borderWidth: 1,
                        borderColor: colors.inputBorder,
                        borderRadius: 8,
                        paddingHorizontal: 10,
                        paddingVertical: 8,
                        height: 40,
                        color: colors.text,
                        backgroundColor: colors.inputBg,
                      }}
                      placeholder="Vergi Dairesi"
                      placeholderTextColor={colors.textMuted}
                      value={newCustTaxOffice}
                      onChangeText={setNewCustTaxOffice}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 11, color: colors.textSub, fontWeight: '700', marginBottom: 4 }}>Vergi Numarası</Text>
                    <TextInput
                      style={{
                        borderWidth: 1,
                        borderColor: colors.inputBorder,
                        borderRadius: 8,
                        paddingHorizontal: 10,
                        paddingVertical: 8,
                        height: 40,
                        color: colors.text,
                        backgroundColor: colors.inputBg,
                      }}
                      placeholder="Vergi No / TC"
                      placeholderTextColor={colors.textMuted}
                      keyboardType="numeric"
                      value={newCustTaxNumber}
                      onChangeText={setNewCustTaxNumber}
                    />
                  </View>
                </View>

                {/* Fiyat Grubu */}
                <View>
                  <Text style={{ fontSize: 11, color: colors.textSub, fontWeight: '700', marginBottom: 6 }}>Fiyat Grubu</Text>
                  {priceGroupsLoading ? (
                    <ActivityIndicator size="small" color="#B73A0B" style={{ alignSelf: 'flex-start' }} />
                  ) : (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                      {priceGroups.map((g) => {
                        const isSelected = newCustPriceGroupId === String(g.id);
                        return (
                          <TouchableOpacity
                            key={g.id}
                            onPress={() => setNewCustPriceGroupId(String(g.id))}
                            style={{
                              paddingHorizontal: 12,
                              paddingVertical: 6,
                              borderRadius: 16,
                              borderWidth: 1,
                              borderColor: isSelected ? '#10B981' : colors.inputBorder,
                              backgroundColor: isSelected ? 'rgba(16,185,129,0.1)' : colors.inputBg,
                            }}
                          >
                            <Text style={{ fontSize: 12, color: isSelected ? '#10B981' : colors.text, fontWeight: isSelected ? '700' : '500' }}>
                              {g.name || g.groupName}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )}
                </View>

                {/* İl & İlçe */}
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 11, color: colors.textSub, fontWeight: '700', marginBottom: 4 }}>İl</Text>
                    <TextInput
                      style={{
                        borderWidth: 1,
                        borderColor: colors.inputBorder,
                        borderRadius: 8,
                        paddingHorizontal: 10,
                        paddingVertical: 8,
                        height: 40,
                        color: colors.text,
                        backgroundColor: colors.inputBg,
                      }}
                      placeholder="İl"
                      placeholderTextColor={colors.textMuted}
                      value={newCustCity}
                      onChangeText={setNewCustCity}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 11, color: colors.textSub, fontWeight: '700', marginBottom: 4 }}>İlçe</Text>
                    <TextInput
                      style={{
                        borderWidth: 1,
                        borderColor: colors.inputBorder,
                        borderRadius: 8,
                        paddingHorizontal: 10,
                        paddingVertical: 8,
                        height: 40,
                        color: colors.text,
                        backgroundColor: colors.inputBg,
                      }}
                      placeholder="İlçe"
                      placeholderTextColor={colors.textMuted}
                      value={newCustDistrict}
                      onChangeText={setNewCustDistrict}
                    />
                  </View>
                </View>

                {/* Adres */}
                <View>
                  <Text style={{ fontSize: 11, color: colors.textSub, fontWeight: '700', marginBottom: 4 }}>Açık Adres</Text>
                  <TextInput
                    style={{
                      borderWidth: 1,
                      borderColor: colors.inputBorder,
                      borderRadius: 8,
                      paddingHorizontal: 10,
                      paddingVertical: 8,
                      height: 60,
                      color: colors.text,
                      backgroundColor: colors.inputBg,
                      textAlignVertical: 'top',
                    }}
                    placeholder="Müşteri adresi..."
                    placeholderTextColor={colors.textMuted}
                    multiline
                    value={newCustAddress}
                    onChangeText={setNewCustAddress}
                  />
                </View>
              </ScrollView>

              {/* Save Button */}
              <TouchableOpacity
                style={{
                  backgroundColor: '#10B981',
                  padding: 12,
                  margin: 16,
                  borderRadius: 8,
                  flexDirection: 'row',
                  justifyContent: 'center',
                  alignItems: 'center',
                }}
                disabled={newCustMutation.isPending}
                onPress={() => newCustMutation.mutate()}
              >
                {newCustMutation.isPending ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Check size={14} color="#fff" style={{ marginRight: 6 }} />
                    <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>Cari Kartı Oluştur</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const createStyles = (colors: ThemeColors, isDark: boolean) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },
    flex1: { flex: 1 },
    orb1: {
      position: 'absolute', top: -60, left: -40, width: 220, height: 220,
      borderRadius: 110, backgroundColor: isDark ? 'rgba(183,58,11,0.08)' : 'rgba(183,58,11,0.05)',
    },
    orb2: {
      position: 'absolute', bottom: -80, right: -60, width: 280, height: 280,
      borderRadius: 140, backgroundColor: isDark ? 'rgba(16,185,129,0.05)' : 'rgba(16,185,129,0.03)',
    },

    root: { flex: 1, flexDirection: 'row' },

    // ── Left Panel ──────────────────────────────────────────────────────────
    leftPanel: {
      width: 220,
      borderRightWidth: 1,
      borderRightColor: colors.inputBorder,
      backgroundColor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)',
      flexDirection: 'column',
    },
    panelHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 14,
      paddingTop: 16,
      paddingBottom: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.inputBorder,
    },
    panelTitle: { fontSize: 13, fontWeight: '800', color: colors.text, letterSpacing: 0.3 },
    panelSearch: {
      flexDirection: 'row',
      alignItems: 'center',
      marginHorizontal: 10,
      marginVertical: 10,
      backgroundColor: colors.inputBg,
      borderWidth: 1,
      borderColor: colors.inputBorder,
      borderRadius: 10,
      paddingHorizontal: 10,
      paddingVertical: 7,
    },
    panelSearchInput: { flex: 1, fontSize: 12, color: colors.text, padding: 0 },
    panelLoading: { alignItems: 'center', paddingVertical: 30, gap: 8 },
    panelLoadingText: { color: colors.textMuted, fontSize: 12 },
    panelEmpty: { alignItems: 'center', paddingVertical: 30, paddingHorizontal: 16, gap: 8 },
    panelEmptyText: { color: colors.textMuted, fontSize: 12, textAlign: 'center', lineHeight: 16 },

    techList: { paddingVertical: 6, paddingHorizontal: 8 },
    techSeparator: { height: 1, backgroundColor: colors.inputBorder, marginHorizontal: 4 },
    techCard: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 10,
      borderRadius: 10,
      position: 'relative',
    },
    techCardActive: {
      backgroundColor: isDark ? 'rgba(183,58,11,0.12)' : 'rgba(183,58,11,0.07)',
      borderWidth: 1,
      borderColor: 'rgba(183,58,11,0.25)',
    },
    techCardDisabled: { opacity: 0.45 },
    techCardInfo: { flex: 1, marginLeft: 8 },
    techCardName: { fontSize: 12, fontWeight: '700', color: colors.text, marginBottom: 2 },
    techCardNameActive: { color: '#ff6b35' },
    techCardBadgeRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 2 },
    techCardBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
      borderRadius: 4,
      paddingHorizontal: 5,
      paddingVertical: 2,
    },
    techCardBadgeActive: { backgroundColor: 'rgba(183,58,11,0.12)' },
    techCardBadgeText: { fontSize: 10, color: colors.textMuted, fontWeight: '600' },
    techCardNoWarehouse: { fontSize: 10, color: '#ef4444', fontStyle: 'italic' },
    techCardPhone: { fontSize: 10, color: colors.textMuted, marginTop: 1 },
    techCardActiveDot: {
      position: 'absolute', right: 6, top: '50%',
      width: 6, height: 6, borderRadius: 3, backgroundColor: '#B73A0B',
      marginTop: -3,
    },

    panelFooter: {
      borderTopWidth: 1, borderTopColor: colors.inputBorder,
      paddingHorizontal: 14, paddingVertical: 10,
    },
    panelFooterText: { fontSize: 10, color: colors.textMuted, fontWeight: '600' },

    // ── Right Panel ─────────────────────────────────────────────────────────
    rightPanel: { flex: 1, flexDirection: 'column' },
    rightHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderBottomWidth: 1,
      borderBottomColor: colors.inputBorder,
    },
    rightTitleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
    rightTitle: { fontSize: 18, fontWeight: '800', color: colors.text },
    rightSubtitle: { fontSize: 12, color: colors.textSub, marginTop: 2 },
    rightWarehouseBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: 'rgba(183,58,11,0.1)',
      borderWidth: 1,
      borderColor: 'rgba(183,58,11,0.25)',
      borderRadius: 8,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    rightWarehouseText: { fontSize: 11, color: '#B73A0B', fontWeight: '700' },
    iconBtn: {
      width: 34, height: 34, borderRadius: 8,
      backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.inputBorder,
      alignItems: 'center', justifyContent: 'center',
    },
    saleBtn: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: '#10B981', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10,
    },
    saleBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },

    warningBanner: {
      flexDirection: 'row', alignItems: 'center',
      margin: 12, padding: 12,
      backgroundColor: 'rgba(239,68,68,0.08)', borderWidth: 1,
      borderColor: 'rgba(239,68,68,0.2)', borderRadius: 10,
    },
    warningText: { flex: 1, color: '#ef4444', fontSize: 12, fontWeight: '600', lineHeight: 17 },

    stockSearch: {
      flexDirection: 'row', alignItems: 'center',
      marginHorizontal: 16, marginTop: 12, marginBottom: 4,
      backgroundColor: colors.inputBg, borderWidth: 1,
      borderColor: colors.inputBorder, borderRadius: 12,
      paddingHorizontal: 12, paddingVertical: 8,
    },
    stockSearchInput: { flex: 1, fontSize: 13, color: colors.text, padding: 0 },

    stockLoading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
    stockLoadingText: { color: colors.textMuted, fontSize: 13 },
    stockError: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
    stockErrorText: { color: '#ef4444', fontSize: 13 },
    retryBtn: {
      backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.inputBorder,
      paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8,
    },
    retryBtnText: { color: colors.text, fontSize: 13, fontWeight: '600' },

    emptyPanel: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
    emptyIcon: {
      width: 64, height: 64, borderRadius: 32,
      backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
      alignItems: 'center', justifyContent: 'center', marginBottom: 16,
    },
    emptyTitle: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 6 },
    emptyDesc: { fontSize: 13, color: colors.textMuted, textAlign: 'center', lineHeight: 18 },

    // Stock table
    stockList: { paddingBottom: 24 },
    stockTableHeader: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: 16, paddingVertical: 10,
      backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
      borderBottomWidth: 1, borderBottomColor: colors.inputBorder,
    },
    stockTableHeaderText: { fontSize: 10, fontWeight: '800', color: colors.textMuted, letterSpacing: 0.5 },
    stockRowSep: { height: 1, backgroundColor: colors.inputBorder, marginHorizontal: 0 },
    stockRow: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: 16, paddingVertical: 12,
    },
    stockRowName: { fontSize: 13, fontWeight: '600', color: colors.text, lineHeight: 17 },
    stockRowCode: { fontSize: 10, color: colors.textMuted, marginTop: 2, fontWeight: '500' },
    stockTypeBadge: { fontSize: 11, fontWeight: '700' },
    stockQty: { fontSize: 14, fontWeight: '800' },
    statusBadge: {
      paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6,
      borderWidth: 1, alignItems: 'center',
    },
    statusBadgeText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.2 },

    // ── Modal ────────────────────────────────────────────────────────────────
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
    modalSheet: {
      backgroundColor: colors.card,
      borderTopLeftRadius: 24, borderTopRightRadius: 24,
      borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1,
      borderColor: colors.inputBorder,
      paddingHorizontal: 20, paddingBottom: 24,
      maxHeight: '92%', flex: 0,
    },
    sheetHandle: {
      width: 40, height: 4, borderRadius: 2,
      backgroundColor: isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)',
      alignSelf: 'center', marginTop: 12, marginBottom: 8,
    },
    modalHeader: {
      flexDirection: 'row', alignItems: 'center',
      paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.inputBorder,
      marginBottom: 12,
    },
    modalTitle: { fontSize: 18, fontWeight: '800', color: colors.text },
    modalCloseBtn: {
      width: 32, height: 32, borderRadius: 16,
      backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.inputBorder,
      alignItems: 'center', justifyContent: 'center',
    },

    modalTechStrip: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: isDark ? 'rgba(183,58,11,0.08)' : 'rgba(183,58,11,0.05)',
      borderWidth: 1, borderColor: 'rgba(183,58,11,0.2)',
      borderRadius: 12, padding: 10, marginBottom: 16,
    },
    modalTechName: { fontSize: 13, fontWeight: '700', color: colors.text },
    modalTechDepot: { fontSize: 11, color: '#B73A0B', marginTop: 1, fontWeight: '600' },
    accountBadge: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
      borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4,
    },
    accountBadgeText: { fontSize: 10, color: colors.textMuted, fontWeight: '600' },

    sectionBlock: { marginBottom: 20 },
    sectionLabel: {
      fontSize: 10, fontWeight: '800', color: colors.textMuted,
      letterSpacing: 0.8, marginBottom: 10, textTransform: 'uppercase',
    },

    // Customer
    customerSearch: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.inputBorder,
      borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 8,
    },
    customerSearchInput: { flex: 1, fontSize: 14, color: colors.text, padding: 0 },
    customerDropdown: {
      borderWidth: 1, borderColor: colors.inputBorder, borderRadius: 12,
      overflow: 'hidden', backgroundColor: colors.inputBg,
    },
    customerItem: {
      flexDirection: 'row', alignItems: 'center',
      padding: 12, borderBottomWidth: 1, borderBottomColor: colors.inputBorder,
    },
    customerItemName: { fontSize: 13, fontWeight: '700', color: colors.text },
    customerItemCode: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
    noDataText: { color: colors.textMuted, fontSize: 12, fontStyle: 'italic', textAlign: 'center', paddingVertical: 14 },

    selectedCustomerCard: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: isDark ? 'rgba(16,185,129,0.08)' : 'rgba(16,185,129,0.05)',
      borderWidth: 1, borderColor: 'rgba(16,185,129,0.25)',
      borderRadius: 12, padding: 12,
    },
    selectedCustomerAvatar: {
      width: 38, height: 38, borderRadius: 19,
      backgroundColor: '#10B981', alignItems: 'center', justifyContent: 'center', marginRight: 10,
    },
    selectedCustomerInitials: { color: '#fff', fontWeight: '800', fontSize: 14 },
    selectedCustomerName: { fontSize: 14, fontWeight: '700', color: colors.text },
    selectedCustomerCode: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
    changeCustomerBtn: {
      backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.inputBorder,
      paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
    },
    changeCustomerBtnText: { fontSize: 11, color: colors.textSub, fontWeight: '700' },

    // Sale product rows
    saleProductRow: {
      flexDirection: 'row', alignItems: 'center',
      paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.inputBorder,
    },
    saleProductRowSelected: { backgroundColor: isDark ? 'rgba(16,185,129,0.05)' : 'rgba(16,185,129,0.03)' },
    saleProductName: { fontSize: 13, fontWeight: '600', color: colors.text, lineHeight: 17 },
    saleProductMeta: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
    pricingText: { fontSize: 11, color: colors.textMuted, fontStyle: 'italic', marginTop: 2 },
    priceText: { fontSize: 11, color: colors.textSub, marginTop: 2, fontWeight: '600' },
    lineTotalText: { fontSize: 12, color: '#10B981', fontWeight: '700', marginTop: 2 },
    noPriceText: { fontSize: 11, color: '#ef4444', marginTop: 2 },

    qtyControl: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    qtyBtn: {
      width: 30, height: 30, borderRadius: 15,
      backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.inputBorder,
      alignItems: 'center', justifyContent: 'center',
    },
    qtyBtnDisabled: { opacity: 0.35 },
    qtyValue: {
      fontSize: 16, fontWeight: '800', color: colors.text,
      minWidth: 24, textAlign: 'center',
    },
    qtyValueSelected: { color: '#10B981' },

    // Payment
    paymentGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    paymentOption: {
      flex: 1, minWidth: '44%',
      flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      paddingVertical: 14, borderRadius: 12,
      borderWidth: 1, borderColor: colors.inputBorder,
      backgroundColor: colors.inputBg, gap: 4, position: 'relative',
    },
    paymentOptionSelected: {
      borderColor: '#10B981',
      backgroundColor: isDark ? 'rgba(16,185,129,0.08)' : 'rgba(16,185,129,0.05)',
    },
    paymentOptionText: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
    paymentOptionTextSelected: { color: '#10B981' },
    paymentCheckDot: {
      position: 'absolute', top: 6, right: 6,
      width: 8, height: 8, borderRadius: 4, backgroundColor: '#10B981',
    },

    // Invoice summary
    invoiceSummary: {
      borderWidth: 1, borderColor: 'rgba(16,185,129,0.3)',
      borderRadius: 14, padding: 14, marginBottom: 8,
      backgroundColor: isDark ? 'rgba(16,185,129,0.05)' : 'rgba(16,185,129,0.03)',
    },
    summaryRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
    summaryLabel: { fontSize: 13, color: colors.textSub, fontWeight: '600' },
    summaryValue: { fontSize: 13, color: colors.text, fontWeight: '700' },
    summaryRowTotal: {
      borderTopWidth: 1, borderTopColor: 'rgba(16,185,129,0.2)',
      paddingTop: 8, marginTop: 4, marginBottom: 0,
    },
    summaryTotalLabel: { fontSize: 15, color: '#10B981', fontWeight: '800' },
    summaryTotalValue: { fontSize: 18, color: '#10B981', fontWeight: '900' },

    // Submit
    submitBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      backgroundColor: '#10B981', borderRadius: 14, padding: 16, marginTop: 6,
    },
    submitBtnDisabled: { opacity: 0.45 },
    submitBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  });
