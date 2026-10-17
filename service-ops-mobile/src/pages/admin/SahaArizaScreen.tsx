import React, { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Image,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { ArizaStackParamList } from '../../app/ArizaStack';
import { Search, X, Settings2, Info, Camera, FileText } from 'lucide-react-native';
import Card from '../../components/ui/Card';
import Badge, { BadgeType } from '../../components/ui/Badge';
import Spinner from '../../components/ui/Spinner';
import DatePickerModal from '../../components/ui/DatePickerModal';
import {
  fetchServiceRecordsPaged,
  updateServiceRecordStatus,
  fetchServiceRecordById,
  fetchServiceTimeline,
  groupMobileTimelineEvents,
  uploadServiceRecordPhoto,
  deleteServiceRecord,
  type ServiceRecord,
  type ServiceTimelineItem,
} from '../technician/serviceRecordsApi';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import ImageSlider from '../../components/ui/ImageSlider';
import { fetchErpProducts, type ErpProduct } from './erpApi';
import { fetchAvailableTechnicians, type TechnicianDto } from './planningApi';
import { apiJson } from '../../shared/api/client';
import { useThemeColors, useThemeStore } from '../../shared/theme/store';
import { API_BASE_URL } from '../../shared/config';

const STATUS_BADGE: Record<string, { label: string; type: BadgeType }> = {
  New: { label: 'Yeni Kayıt', type: 'neutral' },
  Planned: { label: 'Planlandı', type: 'info' },
  Workshop: { label: 'Sahada', type: 'warning' },
  InRepair: { label: 'Tamirde', type: 'info' },
  WaitingForParts: { label: 'Parça Bekliyor', type: 'warning' },
  Ready: { label: 'Hazır', type: 'success' },
  Delivered: { label: 'Teslim Edildi', type: 'success' },
  Delayed: { label: 'Gecikti', type: 'error' },
  Cancelled: { label: 'İptal', type: 'error' },
};

const STATUS_OPTS = [
  { value: '', label: 'Tüm Durumlar' },
  { value: 'New', label: 'Yeni Kayıt' },
  { value: 'Workshop', label: 'Sahada' },
  { value: 'InRepair', label: 'Tamirde' },
  { value: 'WaitingForParts', label: 'Parça Bekliyor' },
  { value: 'Ready', label: 'Hazır' },
  { value: 'Delivered', label: 'Teslim Edildi' },
  { value: 'Delayed', label: 'Gecikti' },
  { value: 'Cancelled', label: 'İptal' },
];

export default function SahaArizaScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<ArizaStackParamList>>();
  const qc = useQueryClient();
  const theme = useThemeStore((s) => s.theme);
  const isDark = theme === 'dark';

  const [tab, setTab] = useState<'bekleyen' | 'aktif'>('bekleyen');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [statusModalOpen, setStatusModalOpen] = useState(false);
  const [dateFromOpen, setDateFromOpen] = useState(false);
  const [dateToOpen, setDateToOpen] = useState(false);

  const [selectedRecord, setSelectedRecord] = useState<ServiceRecord | null>(null);
  const [statusValue, setStatusValue] = useState('New');
  const [statusNote, setStatusNote] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [actionMsg, setActionMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [techAssignOpen, setTechAssignOpen] = useState(false);
  const [techAssignRecord, setTechAssignRecord] = useState<ServiceRecord | null>(null);
  const [techAssignId, setTechAssignId] = useState('');
  const [techAssignLoading, setTechAssignLoading] = useState(false);
  const [availableTechs, setAvailableTechs] = useState<TechnicianDto[]>([]);

  // Info popup (web ile birebir: kayıt detay + timeline)
  const [infoOpen, setInfoOpen] = useState(false);
  const [infoLoading, setInfoLoading] = useState(false);
  const [infoData, setInfoData] = useState<ServiceRecord | null>(null);
  const [infoTimeline, setInfoTimeline] = useState<ServiceTimelineItem[]>([]);

  // ─── ERP ürün listesi (web ile aynı mantık) ───
  const [erpProducts, setErpProducts] = useState<ErpProduct[]>([]);
  const [erpLoading, setErpLoading] = useState(true);
  const [erpError, setErpError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setErpLoading(true);
    fetchErpProducts()
      .then((data) => {
        if (!mounted) return;
        setErpProducts(data);
        setErpError(null);
      })
      .catch((e) => {
        if (!mounted) return;
        setErpError(String(e?.message ?? 'ERP ürünleri yüklenemedi'));
        setErpProducts([]);
      })
      .finally(() => {
        if (!mounted) return;
        setErpLoading(false);
      });
    return () => { mounted = false; };
  }, []);

  // ─── API — web ile aynı: pageSize 1000, statusFilter yoksa bekleyen=New,Planned ───
  const recordsQuery = useQuery({
    queryKey: ['ariza', 'saha', tab, page, search, statusFilter, dateFrom, dateTo],
    queryFn: ({ signal }) =>
      fetchServiceRecordsPaged(
        {
          type: 'Repair',
          q: search || undefined,
          status: statusFilter || undefined,
          statuses: !statusFilter && tab === 'bekleyen' ? 'New,Planned' : undefined,
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
          page,
          pageSize: 1000,
        },
        signal
      ),
  });

  // ─── Client-side ERP + tab filtresi (web'deki repairRecords useMemo ile birebir) ───
  const displayRecords = useMemo(() => {
    const allItems = recordsQuery.data?.items ?? [];

    if (erpLoading || erpError) {
      if (tab === 'bekleyen') return allItems.filter((r) => r.status === 'New' || r.status === 'Planned');
      return allItems.filter((r) => r.status !== 'New' && r.status !== 'Planned' && r.status !== 'Cancelled');
    }

    if (!erpProducts || erpProducts.length === 0) {
      if (tab === 'bekleyen') return allItems.filter((r) => r.status === 'New' || r.status === 'Planned');
      return allItems.filter((r) => r.status !== 'New' && r.status !== 'Planned' && r.status !== 'Cancelled');
    }

    // SAHA = isInstallable=true olan ürünler
    const installableNames = new Set(
      erpProducts.filter((p) => p.isInstallable).map((p) => p.name.trim().toLowerCase())
    );
    const sahaRecords = allItems.filter(
      (r) => installableNames.has((r.productName || '').trim().toLowerCase())
    );

    if (tab === 'bekleyen') {
      return sahaRecords.filter((r) => r.status === 'New' || r.status === 'Planned');
    }
    return sahaRecords.filter(
      (r) => r.status !== 'New' && r.status !== 'Planned' && r.status !== 'Cancelled'
    );
  }, [recordsQuery.data, erpLoading, erpError, erpProducts, tab]);

  // Photo states for status update
  const [photos, setPhotos] = useState<{ uri: string; name: string; type: string }[]>([]);

  const handleTakePhoto = () => {
    launchCamera({
      mediaType: 'photo',
      quality: 0.8,
    }, (response) => {
      if (response.didCancel) return;
      if (response.errorMessage) {
        Alert.alert('Hata', response.errorMessage);
        return;
      }
      const asset = response.assets?.[0];
      if (asset && asset.uri) {
        setPhotos(prev => [
          ...prev,
          {
            uri: asset.uri!,
            name: asset.fileName || `photo_${Date.now()}.jpg`,
            type: asset.type || 'image/jpeg',
          }
        ]);
      }
    });
  };

  const handleSelectPhoto = () => {
    launchImageLibrary({
      mediaType: 'photo',
      quality: 0.8,
      selectionLimit: 0,
    }, (response) => {
      if (response.didCancel) return;
      if (response.errorMessage) {
        Alert.alert('Hata', response.errorMessage);
        return;
      }
      if (response.assets) {
        const selected = response.assets.map(asset => ({
          uri: asset.uri!,
          name: asset.fileName || `photo_${Date.now()}.jpg`,
          type: asset.type || 'image/jpeg',
        }));
        setPhotos(prev => [...prev, ...selected]);
      }
    });
  };

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!selectedRecord) throw new Error('Kayıt seçilmedi');
      
      const res = await updateServiceRecordStatus(selectedRecord.id, {
        status: statusValue,
        notes: statusNote || null,
      });

      if (photos.length > 0) {
        for (const p of photos) {
          await uploadServiceRecordPhoto(selectedRecord.id, p.uri, p.name, p.type);
        }
      }

      return res;
    },
    onSuccess: () => {
      setActionMsg({ type: 'ok', text: 'Durum ve fotoğraf güncellendi.' });
      setStatusNote('');
      setPhotos([]);
      qc.invalidateQueries({ queryKey: ['ariza', 'saha'] });
    },
    onError: (e: any) => {
      setActionMsg({ type: 'err', text: e?.message ?? 'Güncelleme başarısız.' });
    },
  });

  const openSheet = (record: ServiceRecord) => {
    setSelectedRecord(record);
    setStatusValue(record.status);
    setStatusNote('');
    setPhotos([]);
    setActionMsg(null);
    setSheetOpen(true);
  };

  const openInfo = async (id: string) => {
    setInfoOpen(true);
    setInfoLoading(true);
    setInfoData(null);
    setInfoTimeline([]);
    try {
      const [data, tl] = await Promise.all([
        fetchServiceRecordById(id),
        fetchServiceTimeline(id).catch(() => [] as ServiceTimelineItem[]),
      ]);
      setInfoData(data);
      setInfoTimeline(Array.isArray(tl) ? tl : []);
    } catch {
      setInfoData(null);
    } finally {
      setInfoLoading(false);
    }
  };

  const isLoading = recordsQuery.isLoading || erpLoading;
  const pageSize = 20;
  const paginatedItems = displayRecords.slice((page - 1) * pageSize, page * pageSize);
  const totalPages = Math.max(1, Math.ceil(displayRecords.length / pageSize));

  // Tema renkleri
  const colors = useThemeColors();
  const bg = colors.bg;
  const textColor = colors.text;
  const subColor = colors.textSub;
  const inputBg = colors.inputBg;
  const inputBorder = colors.inputBorder;
  const placeholderColor = colors.placeholder;
  const modalBg = colors.card;
  const modalBorder = colors.inputBorder;
  const orbBg1 = colors.orb1;
  const orbBg2 = colors.orb2;

  const renderItem = ({ item }: { item: ServiceRecord }) => {
    const badge = STATUS_BADGE[item.status] ?? { label: item.status, type: 'neutral' as BadgeType };
    return (
      <Card style={{ marginBottom: 12, padding: 0 }}>
        {/* Touchable area for details */}
        <TouchableOpacity
          activeOpacity={0.75}
          onPress={() => navigation.navigate('ServiceRecordDetail', { serviceId: item.id })}
          style={{ padding: 14 }}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <Text style={{ fontSize: 15, fontWeight: '800', color: '#B91C1C', letterSpacing: 0.5 }}>
              {item.serviceNumber}
            </Text>
            <Badge label={badge.label} type={badge.type} />
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
            <Text style={{ fontSize: 12, color: subColor }}>
              {item.createdAt ? new Date(item.createdAt).toLocaleDateString('tr-TR') : '-'}
            </Text>
            <Text style={{ fontSize: 12, fontWeight: '700', color: textColor }}>{item.dealerName || '-'}</Text>
          </View>
          <View style={{ backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)', padding: 10, borderRadius: 8, marginBottom: 8 }}>
            <Text style={{ fontSize: 14, fontWeight: '700', color: textColor }}>
              {item.productName || 'Ürün Belirtilmemiş'}
            </Text>
            <Text style={{ fontSize: 11, color: subColor, marginTop: 2 }}>
              {item.serialNumber ? `SN: ${item.serialNumber}` : 'Seri No Yok'}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
            <Text style={{ fontSize: 13, fontWeight: '700', color: textColor }}>{item.customerName || '-'}</Text>
            <Text style={{ fontSize: 12, color: subColor }}>{item.regionName || '-'}</Text>
          </View>
        </TouchableOpacity>

        {/* Action Bar */}
        <View style={{
          flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
          borderTopWidth: 1,
          borderTopColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)',
          paddingHorizontal: 14,
          paddingBottom: 14,
          paddingTop: 10,
        }}>
          <Text style={{ fontSize: 12, color: subColor, fontStyle: 'italic' }}>
            {item.assignedTechnicianName || 'Atanmadı'}
          </Text>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <TouchableOpacity
              style={{ padding: 6, backgroundColor: 'rgba(59,130,246,0.1)', borderRadius: 8 }}
              onPress={() => openInfo(item.id)}
            >
              <Info color="#3b82f6" size={16} />
            </TouchableOpacity>

            {tab === 'bekleyen' && item.status === 'New' && (
              <TouchableOpacity
                style={{ backgroundColor: '#2563EB', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 }}
                onPress={() => {
                  (navigation as any).navigate('ArizaPlanning', {
                    screen: 'PlanningHome',
                    params: { serviceId: item.id },
                  });
                }}
              >
                <Text style={{ color: '#fff', fontSize: 11, fontWeight: '800' }}>Planla</Text>
              </TouchableOpacity>
            )}
            {tab === 'bekleyen' && item.status === 'Planned' && (
              <TouchableOpacity
                style={{ backgroundColor: '#B91C1C', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 }}
                onPress={() => {
                  updateServiceRecordStatus(item.id, { status: 'Workshop', notes: null })
                    .then(() => qc.invalidateQueries({ queryKey: ['ariza', 'saha'] }));
                }}
              >
                <Text style={{ color: '#fff', fontSize: 11, fontWeight: '800' }}>Sahaya Aktar</Text>
              </TouchableOpacity>
            )}
            {tab === 'aktif' && (
              <>
                <TouchableOpacity
                  style={{ backgroundColor: '#2563eb', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 }}
                  onPress={async () => {
                    setTechAssignRecord(item);
                    setTechAssignId(item.assignedTechnicianId ?? '');
                    setTechAssignOpen(true);
                    const techs = await fetchAvailableTechnicians().catch(() => []);
                    setAvailableTechs(techs);
                  }}
                >
                  <Text style={{ color: '#fff', fontSize: 11, fontWeight: '800' }}>Teknisyen Ata</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={{ backgroundColor: '#B91C1C', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 }}
                  onPress={() => openSheet(item)}
                >
                  <Text style={{ color: '#fff', fontSize: 11, fontWeight: '800' }}>Durum Güncelle</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Card>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: bg }}>
      <View style={{ position: 'absolute', top: '-10%', left: '-10%', width: '60%', height: '40%', backgroundColor: orbBg1, borderRadius: 9999 }} />
      <View style={{ position: 'absolute', bottom: 0, right: '-20%', width: '70%', height: '50%', backgroundColor: orbBg2, borderRadius: 9999 }} />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ flex: 1, padding: 16, maxWidth: 650, width: '100%', alignSelf: 'center' }}>

          {/* Header */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 26, fontWeight: '800', color: textColor }}>Saha Ürün Arıza</Text>
              <Text style={{ fontSize: 13, color: subColor, marginTop: 2 }}>Montajlı ve büyük hacimli saha ürünlerinin arıza takibi.</Text>
            </View>
            <TouchableOpacity
              style={{
                padding: 8, borderRadius: 10, marginTop: 4, borderWidth: 1,
                backgroundColor: filtersOpen ? '#B91C1C' : inputBg,
                borderColor: filtersOpen ? '#B91C1C' : inputBorder,
              }}
              onPress={() => setFiltersOpen((v) => !v)}
            >
              <Settings2 color={filtersOpen ? '#fff' : (isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.4)')} size={20} />
            </TouchableOpacity>
          </View>

          {/* ERP Hata uyarısı */}
          {erpError && !erpLoading && (
            <View style={{ backgroundColor: 'rgba(245,158,11,0.1)', borderRadius: 10, padding: 10, marginBottom: 10, borderWidth: 1, borderColor: 'rgba(245,158,11,0.25)' }}>
              <Text style={{ color: '#d97706', fontSize: 12, fontWeight: '600' }}>⚠ ERP bağlantısı yok — tüm Repair kayıtları gösteriliyor</Text>
            </View>
          )}

          {/* Tabs */}
          <View style={{ flexDirection: 'row', backgroundColor: inputBg, borderRadius: 12, padding: 4, marginBottom: 12, borderWidth: 1, borderColor: inputBorder }}>
            <TouchableOpacity
              style={[{ flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 8 }, tab === 'bekleyen' && { backgroundColor: '#B91C1C' }]}
              onPress={() => { setTab('bekleyen'); setPage(1); }}
            >
              <Text style={{ fontSize: 11, fontWeight: '700', color: tab === 'bekleyen' ? '#fff' : (isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.45)') }}>
                SAHA BEKLEYEN
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[{ flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 8 }, tab === 'aktif' && { backgroundColor: '#B91C1C' }]}
              onPress={() => { setTab('aktif'); setPage(1); }}
            >
              <Text style={{ fontSize: 11, fontWeight: '700', color: tab === 'aktif' ? '#fff' : (isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.45)') }}>
                SAHA (AKTİF)
              </Text>
            </TouchableOpacity>
          </View>

          {/* Search */}
          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: inputBg, borderWidth: 1, borderColor: inputBorder, borderRadius: 12, paddingHorizontal: 12, marginBottom: 10 }}>
            <Search color={isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.3)'} size={18} style={{ marginRight: 8 }} />
            <TextInput
              style={{ flex: 1, height: 44, color: textColor, fontSize: 14 }}
              placeholder="Ara: müşteri, telefon, ürün, seri no..."
              placeholderTextColor={placeholderColor}
              value={search}
              onChangeText={(v) => { setSearch(v); setPage(1); }}
            />
            {search ? (
              <TouchableOpacity onPress={() => { setSearch(''); setPage(1); }}>
                <X color={isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.3)'} size={16} />
              </TouchableOpacity>
            ) : null}
          </View>

          {/* Filter Panel */}
          {filtersOpen && (
            <Card style={{ padding: 14, marginBottom: 10 }}>
              <Text style={{ fontSize: 11, fontWeight: '700', color: subColor, marginBottom: 6, letterSpacing: 1 }}>TARİH ARALIĞI</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <TouchableOpacity
                  style={{ flex: 1, backgroundColor: inputBg, borderRadius: 10, paddingHorizontal: 12, height: 38, justifyContent: 'center', borderWidth: 1, borderColor: inputBorder }}
                  onPress={() => setDateFromOpen(true)}
                >
                  <Text style={{ color: dateFrom ? textColor : placeholderColor, fontSize: 13 }}>{dateFrom || 'Başlangıç'}</Text>
                </TouchableOpacity>
                <Text style={{ color: isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)' }}>→</Text>
                <TouchableOpacity
                  style={{ flex: 1, backgroundColor: inputBg, borderRadius: 10, paddingHorizontal: 12, height: 38, justifyContent: 'center', borderWidth: 1, borderColor: inputBorder }}
                  onPress={() => setDateToOpen(true)}
                >
                  <Text style={{ color: dateTo ? textColor : placeholderColor, fontSize: 13 }}>{dateTo || 'Bitiş'}</Text>
                </TouchableOpacity>
              </View>
              <Text style={{ fontSize: 11, fontWeight: '700', color: subColor, marginBottom: 6, letterSpacing: 1 }}>DURUM</Text>
              <TouchableOpacity
                style={{ backgroundColor: inputBg, borderRadius: 10, paddingHorizontal: 12, height: 40, justifyContent: 'center', borderWidth: 1, borderColor: inputBorder, marginBottom: 10 }}
                onPress={() => setStatusModalOpen(true)}
              >
                <Text style={{ color: textColor, fontSize: 13 }}>
                  {STATUS_OPTS.find(o => o.value === statusFilter)?.label ?? 'Tüm Durumlar'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ alignItems: 'center', paddingVertical: 6 }}
                onPress={() => { setDateFrom(''); setDateTo(''); setStatusFilter(''); setSearch(''); setPage(1); }}
              >
                <Text style={{ color: '#ef4444', fontWeight: '700', fontSize: 13 }}>Filtreleri Temizle</Text>
              </TouchableOpacity>
            </Card>
          )}

          {/* List */}
          {isLoading ? (
            <Spinner style={{ marginTop: 40 }} />
          ) : (
            <FlatList
              data={paginatedItems}
              keyExtractor={(x) => x.id}
              renderItem={renderItem}
              contentContainerStyle={{ paddingBottom: 95 }}
              onRefresh={() => recordsQuery.refetch()}
              refreshing={recordsQuery.isFetching && !recordsQuery.isLoading}
              ListEmptyComponent={() => (
                <Text style={{ color: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)', textAlign: 'center', marginTop: 40, fontSize: 14 }}>
                  {erpLoading ? 'Ürün listesi yükleniyor...' : 'Bu sekmeye ait kayıt bulunamadı.'}
                </Text>
              )}
            />
          )}

          {/* Pagination + Toplam */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, gap: 12 }}>
            <Text style={{ color: subColor, fontSize: 11 }}>
              Toplam {displayRecords.length} kayıt
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <TouchableOpacity
                style={{ padding: 8, backgroundColor: inputBg, borderRadius: 8, opacity: page <= 1 ? 0.3 : 1 }}
                disabled={page <= 1}
                onPress={() => setPage(p => Math.max(1, p - 1))}
              >
                <Text style={{ color: textColor, fontWeight: '800' }}>{'<'}</Text>
              </TouchableOpacity>
              <View style={{ backgroundColor: '#B91C1C', width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>{page}</Text>
              </View>
              <TouchableOpacity
                style={{ padding: 8, backgroundColor: inputBg, borderRadius: 8, opacity: page >= totalPages ? 0.3 : 1 }}
                disabled={page >= totalPages}
                onPress={() => setPage(p => p + 1)}
              >
                <Text style={{ color: textColor, fontWeight: '800' }}>{'>'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* Status Seçici Modal */}
      <Modal visible={statusModalOpen} transparent animationType="slide" onRequestClose={() => setStatusModalOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: modalBg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '70%', borderTopWidth: 1, borderColor: modalBorder }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <Text style={{ color: textColor, fontSize: 20, fontWeight: '800' }}>Durum Seç</Text>
              <TouchableOpacity onPress={() => setStatusModalOpen(false)}>
                <X color={isDark ? '#fff' : '#111'} size={22} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={STATUS_OPTS}
              keyExtractor={(x) => x.value || 'all'}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={{ paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)' }}
                  onPress={() => { setStatusFilter(item.value); setStatusModalOpen(false); setPage(1); }}
                >
                  <Text style={{ color: statusFilter === item.value ? '#B91C1C' : textColor, fontSize: 15, fontWeight: statusFilter === item.value ? '800' : '600' }}>{item.label}</Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>

      {/* Durum Güncelleme Sheet */}
      <Modal visible={sheetOpen} transparent animationType="slide" onRequestClose={() => setSheetOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: modalBg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '85%', borderTopWidth: 1, borderColor: modalBorder }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <Text style={{ color: textColor, fontSize: 20, fontWeight: '800' }}>Durum Güncelle</Text>
              <TouchableOpacity onPress={() => setSheetOpen(false)}>
                <X color={isDark ? '#fff' : '#111'} size={22} />
              </TouchableOpacity>
            </View>
            <ScrollView>
              <Text style={{ color: isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.45)', fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 4 }}>SERVİS NO</Text>
              <Text style={{ color: textColor, fontSize: 15, fontWeight: '700', marginBottom: 16 }}>{selectedRecord?.serviceNumber}</Text>
              <Text style={{ color: isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.45)', fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 8 }}>YENİ DURUM</Text>
              {STATUS_OPTS.slice(1).map(opt => (
                <TouchableOpacity
                  key={opt.value}
                  style={[
                    { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, marginBottom: 6, borderWidth: 1 },
                    statusValue === opt.value
                      ? { backgroundColor: '#B91C1C', borderColor: '#B91C1C' }
                      : { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)', borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)' }
                  ]}
                  onPress={() => setStatusValue(opt.value)}
                >
                  <Text style={{ fontSize: 14, fontWeight: '600', color: statusValue === opt.value ? '#fff' : (isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)') }}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
              <Text style={{ color: isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.45)', fontSize: 11, fontWeight: '700', letterSpacing: 1, marginTop: 16, marginBottom: 8 }}>İŞLEM NOTU (OPSİYONEL)</Text>
              <TextInput
                style={{ backgroundColor: inputBg, borderRadius: 12, padding: 12, color: textColor, fontSize: 13, minHeight: 80, textAlignVertical: 'top', marginBottom: 16, borderWidth: 1, borderColor: inputBorder }}
                value={statusNote}
                onChangeText={setStatusNote}
                placeholder="Yapılan işlem, ek bilgi veya not..."
                placeholderTextColor={placeholderColor}
                multiline
              />
              <Text style={{ color: isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.45)', fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 8 }}>FOTOĞRAF EKLE (OPSİYONEL)</Text>
              {photos.length === 0 ? (
                <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
                  <TouchableOpacity
                    style={{
                      flex: 1,
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: inputBg,
                      borderWidth: 1,
                      borderColor: inputBorder,
                      paddingVertical: 12,
                      borderRadius: 12,
                      gap: 6
                    }}
                    onPress={handleTakePhoto}
                  >
                    <Camera color={textColor} size={14} />
                    <Text style={{ color: textColor, fontSize: 12, fontWeight: '700' }}>Fotoğraf Çek</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={{
                      flex: 1,
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: inputBg,
                      borderWidth: 1,
                      borderColor: inputBorder,
                      paddingVertical: 12,
                      borderRadius: 12,
                      gap: 6
                    }}
                    onPress={handleSelectPhoto}
                  >
                    <FileText color={textColor} size={14} />
                    <Text style={{ color: textColor, fontSize: 12, fontWeight: '700' }}>Galeriden Seç</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={{ marginBottom: 16, position: 'relative', borderRadius: 12, overflow: 'hidden' }}>
                  <ImageSlider urls={photos.map(p => p.uri)} imageStyle={{ height: 160 }} />
                  <TouchableOpacity
                    style={{ position: 'absolute', top: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 12, width: 24, height: 24, alignItems: 'center', justifyContent: 'center', zIndex: 20 }}
                    onPress={() => setPhotos([])}
                  >
                    <X color="#fff" size={16} />
                  </TouchableOpacity>
                </View>
              )}
              {actionMsg && (
                <View style={{ borderRadius: 10, padding: 12, marginBottom: 12, backgroundColor: actionMsg.type === 'ok' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)' }}>
                  <Text style={{ color: actionMsg.type === 'ok' ? '#10b981' : '#ef4444', fontWeight: '700', fontSize: 13 }}>{actionMsg.text}</Text>
                </View>
              )}
              <TouchableOpacity
                style={{ backgroundColor: '#B91C1C', borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginBottom: 8, opacity: updateMutation.isPending ? 0.5 : 1 }}
                disabled={updateMutation.isPending}
                onPress={() => updateMutation.mutate()}
              >
                <Text style={{ color: '#fff', fontSize: 15, fontWeight: '800' }}>
                  {updateMutation.isPending ? 'Kaydediliyor...' : 'Durumu Kaydet'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={{
                  backgroundColor: 'rgba(239, 68, 68, 0.08)',
                  borderWidth: 1,
                  borderColor: 'rgba(239, 68, 68, 0.2)',
                  borderRadius: 14,
                  paddingVertical: 14,
                  alignItems: 'center',
                  marginBottom: 16,
                  opacity: updateMutation.isPending ? 0.5 : 1
                }}
                disabled={updateMutation.isPending}
                onPress={() => {
                  if (!selectedRecord) return;
                  Alert.alert(
                    'Kayıt Sil',
                    `${selectedRecord.serviceNumber} numaralı arıza kaydını silmek istediğinize emin misiniz?`,
                    [
                      { text: 'Vazgeç', style: 'cancel' },
                      {
                        text: 'Sil',
                        style: 'destructive',
                        onPress: async () => {
                          try {
                            await deleteServiceRecord(selectedRecord.id);
                            Alert.alert('Başarılı', 'Kayıt başarıyla silindi.');
                            setSheetOpen(false);
                            qc.invalidateQueries({ queryKey: ['ariza', 'saha'] });
                          } catch (err: any) {
                            Alert.alert('Hata', err.message || 'Kayıt silinemedi.');
                          }
                        }
                      }
                    ]
                  );
                }}
              >
                <Text style={{ color: '#ef4444', fontSize: 15, fontWeight: '800' }}>
                  Kayıt Sil
                </Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Info Popup: Kayıt Bilgisi & Geçmiş (web ile birebir) */}
      <Modal visible={infoOpen} transparent animationType="fade" onRequestClose={() => setInfoOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 16 }}>
          <View style={{ backgroundColor: modalBg, borderRadius: 18, padding: 18, maxHeight: '90%', borderWidth: 1, borderColor: modalBorder }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <Text style={{ color: textColor, fontSize: 17, fontWeight: '800' }}>Kayıt Bilgisi & Geçmiş</Text>
              <TouchableOpacity onPress={() => { setInfoOpen(false); setInfoData(null); setInfoTimeline([]); }}>
                <X color={isDark ? '#fff' : '#111'} size={22} />
              </TouchableOpacity>
            </View>
            {infoLoading ? (
              <Spinner style={{ marginVertical: 40 }} />
            ) : !infoData ? (
              <Text style={{ color: '#ef4444', fontSize: 13 }}>Bilgi yüklenemedi.</Text>
            ) : (
              <ScrollView>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 16, gap: 12 }}>
                  <View style={{ width: '47%' }}>
                    <Text style={{ color: subColor, fontSize: 10, fontWeight: '700', letterSpacing: 1 }}>SERVİS NO</Text>
                    <Text style={{ color: textColor, fontSize: 13, fontWeight: '800' }}>{infoData.serviceNumber}</Text>
                  </View>
                  <View style={{ width: '47%' }}>
                    <Text style={{ color: subColor, fontSize: 10, fontWeight: '700', letterSpacing: 1 }}>DURUM</Text>
                    <Text style={{ color: textColor, fontSize: 13, fontWeight: '700' }}>
                      {STATUS_BADGE[infoData.status]?.label ?? infoData.statusLabel ?? infoData.status}
                    </Text>
                  </View>
                  <View style={{ width: '47%' }}>
                    <Text style={{ color: subColor, fontSize: 10, fontWeight: '700', letterSpacing: 1 }}>MÜŞTERİ</Text>
                    <Text style={{ color: textColor, fontSize: 13, fontWeight: '700' }}>{infoData.customerName || '-'}</Text>
                  </View>
                  <View style={{ width: '47%' }}>
                    <Text style={{ color: subColor, fontSize: 10, fontWeight: '700', letterSpacing: 1 }}>TELEFON</Text>
                    <Text style={{ color: textColor, fontSize: 13, fontWeight: '700' }}>{infoData.customerPhone || '-'}</Text>
                  </View>
                  <View style={{ width: '100%' }}>
                    <Text style={{ color: subColor, fontSize: 10, fontWeight: '700', letterSpacing: 1 }}>ADRES</Text>
                    <Text style={{ color: textColor, fontSize: 13, fontWeight: '600' }}>{infoData.customerAddress || '-'}</Text>
                  </View>
                  <View style={{ width: '47%' }}>
                    <Text style={{ color: subColor, fontSize: 10, fontWeight: '700', letterSpacing: 1 }}>ÜRÜN</Text>
                    <Text style={{ color: textColor, fontSize: 13, fontWeight: '700' }}>{infoData.productName || '-'}</Text>
                  </View>
                  <View style={{ width: '47%' }}>
                    <Text style={{ color: subColor, fontSize: 10, fontWeight: '700', letterSpacing: 1 }}>TEKNİSYEN</Text>
                    <Text style={{ color: textColor, fontSize: 13, fontWeight: '700' }}>{infoData.assignedTechnicianName || 'Atanmadı'}</Text>
                  </View>
                </View>

                <Text style={{ color: subColor, fontSize: 11, fontWeight: '800', letterSpacing: 1, marginBottom: 8 }}>ZAMAN ÇİZELGESİ & GEÇMİŞ</Text>
                {infoTimeline.length === 0 ? (
                  <Text style={{ color: subColor, fontSize: 12 }}>Henüz geçmiş yok.</Text>
                ) : (
                  <View style={{ gap: 8 }}>
                    {groupMobileTimelineEvents(infoTimeline).map((ev, idx) => (
                      <View key={ev.id ?? `ev-${idx}`} style={{ backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)', padding: 10, borderRadius: 10, borderWidth: 1, borderColor: inputBorder }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                          <Text style={{ color: textColor, fontSize: 12, fontWeight: '800' }}>{ev.action}</Text>
                          <Text style={{ color: subColor, fontSize: 10 }}>
                            {ev.createdAt ? new Date(ev.createdAt).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' }) : '-'}
                          </Text>
                        </View>
                        
                        {ev.type === 'FaultUpdate' ? (
                          <View style={{ gap: 4 }}>
                            {/* 1. Görsel(ler) */}
                            {ev.photoUrls && ev.photoUrls.length > 0 ? (
                              <ImageSlider urls={ev.photoUrls} imageStyle={{ height: 180 }} />
                            ) : ev.photoUrl ? (
                              <ImageSlider urls={[ev.photoUrl]} imageStyle={{ height: 180 }} />
                            ) : null}
                            {/* 2. Durum Değişikliği */}
                            {ev.statusText ? (
                              <Text style={{ color: textColor, fontSize: 12, fontWeight: '600' }}>{ev.statusText}</Text>
                            ) : null}
                            {/* 3. İşlem Notu */}
                            {ev.note ? (
                              <Text style={{ color: subColor, fontSize: 12, fontStyle: 'italic', marginTop: 2 }}>Not: "{ev.note}"</Text>
                            ) : null}
                          </View>
                        ) : (
                          <View style={{ gap: 4 }}>
                            {ev.photoUrls && ev.photoUrls.length > 0 ? (
                              <ImageSlider urls={ev.photoUrls} imageStyle={{ height: 180 }} />
                            ) : ev.photoUrl ? (
                              <ImageSlider urls={[ev.photoUrl]} imageStyle={{ height: 180 }} />
                            ) : null}
                            {ev.notes ? (
                              <Text style={{ color: subColor, fontSize: 12 }}>{ev.notes}</Text>
                            ) : null}
                          </View>
                        )}

                        {ev.performedBy ? (
                          <Text style={{ color: subColor, fontSize: 10, marginTop: 4, fontStyle: 'italic' }}>— {ev.performedBy}</Text>
                        ) : null}
                      </View>
                    ))}
                  </View>
                )}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* Teknisyen Atama Modal */}
      <Modal visible={techAssignOpen} transparent animationType="slide" onRequestClose={() => setTechAssignOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: isDark ? '#1a1a1a' : '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '75%' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <Text style={{ color: isDark ? '#fff' : '#111', fontSize: 18, fontWeight: '800' }}>Teknisyen Ata</Text>
              <TouchableOpacity onPress={() => setTechAssignOpen(false)}>
                <X color={isDark ? '#fff' : '#111'} size={22} />
              </TouchableOpacity>
            </View>
            <Text style={{ color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)', fontSize: 12, marginBottom: 12 }}>
              {techAssignRecord?.serviceNumber} — {techAssignRecord?.customerName}
            </Text>
            <ScrollView>
              {availableTechs.length === 0 ? (
                <Spinner style={{ marginVertical: 20 }} />
              ) : availableTechs.map(t => (
                <TouchableOpacity
                  key={t.id}
                  style={{ padding: 12, borderRadius: 10, marginBottom: 6, borderWidth: 1, backgroundColor: techAssignId === t.id ? '#2563eb' : (isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)'), borderColor: techAssignId === t.id ? '#2563eb' : (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)') }}
                  onPress={() => setTechAssignId(t.id)}
                >
                  <Text style={{ color: techAssignId === t.id ? '#fff' : (isDark ? 'rgba(255,255,255,0.8)' : '#222'), fontWeight: '600', fontSize: 14 }}>{t.fullName}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                style={{ backgroundColor: '#2563eb', borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 12, marginBottom: 20, opacity: techAssignLoading || !techAssignId ? 0.5 : 1 }}
                disabled={techAssignLoading || !techAssignId}
                onPress={async () => {
                  if (!techAssignRecord || !techAssignId) return;
                  setTechAssignLoading(true);
                  try {
                    await apiJson(`/api/servicerecords/${techAssignRecord.id}/assign`, { method: 'POST', body: JSON.stringify({ technicianId: techAssignId }) });
                    await qc.invalidateQueries({ queryKey: ['ariza', 'saha'] });
                    setTechAssignOpen(false);
                  } catch {
                  } finally {
                    setTechAssignLoading(false);
                  }
                }}
              >
                <Text style={{ color: '#fff', fontSize: 15, fontWeight: '800' }}>{techAssignLoading ? 'Kaydediliyor...' : 'Teknisyen Ata'}</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <DatePickerModal visible={dateFromOpen} value={dateFrom} onSelect={setDateFrom} onClose={() => setDateFromOpen(false)} />
      <DatePickerModal visible={dateToOpen} value={dateTo} onSelect={setDateTo} onClose={() => setDateToOpen(false)} />
    </SafeAreaView>
  );
}
