import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchServiceRecordsPaged, updateServiceRecordStatus, type PagedResult, type ServiceRecord } from '../technician/serviceRecordsApi';
import { apiJson } from '../../shared/api/client';
import {
  fetchAvailableTechnicians,
  fetchRegions,
  fetchPlanningDay,
  type RegionOption,
  type TechnicianDto,
} from './planningApi';
import { fetchErpProducts, getInstallableNames, type ErpProduct } from './erpApi';
import type { PlanningStackParamList } from '../../app/PlanningStack';
import {
  AlertTriangle,
  Calendar,
  CalendarCheck,
  CheckCircle,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Filter,
  Map,
  Package,
  Search,
  Square,
  Users,
  Wrench,
  X,
} from 'lucide-react-native';
import DatePickerModal from '../../components/ui/DatePickerModal';
import Card from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';
import Spinner from '../../components/ui/Spinner';
import EmptyState from '../../components/ui/EmptyState';
import ProgressBar from '../../components/ui/ProgressBar';
import { useThemeColors, useThemeStore, type ThemeColors } from '../../shared/theme/store';
import { useAutoRefetch } from '../../shared/hooks/useAutoRefetch';

function toIsoDateOnly(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDate(iso: string) {
  try {
    const d = new Date(`${iso}T12:00:00Z`);
    return d.toLocaleDateString('tr-TR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    return iso;
  }
}

type Mode = 'unplanned' | 'day' | 'plan';
type SidebarType = 'tech' | 'region' | 'filters' | null;



// ── Smart Assign Preview Modal removed ──────────────────────────────────────

// ── Result Modal ─────────────────────────────────────────────────────────
interface ResultModalProps {
  visible: boolean;
  title: string;
  message: string;
  isError?: boolean;
  onClose: () => void;
  styles: any;
}

function ResultModal({ visible, title, message, isError, onClose, styles }: ResultModalProps) {
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.confirmOverlay}>
        <View style={styles.confirmBox}>
          <View style={styles.confirmIconRow}>
            <View style={[styles.confirmIconBg, { backgroundColor: isError ? 'rgba(239,68,68,0.15)' : 'rgba(16,185,129,0.15)' }]}>
              {isError
                ? <AlertTriangle color="#ef4444" size={28} />
                : <CheckCircle color="#10b981" size={28} />
              }
            </View>
          </View>
          <Text style={styles.confirmTitle}>{title}</Text>
          <Text style={styles.confirmDesc}>{message}</Text>
          <View style={styles.confirmActions}>
            <TouchableOpacity style={[styles.confirmBtn, { backgroundColor: isError ? '#ef4444' : '#10b981' }]} onPress={onClose}>
              <Text style={styles.confirmBtnText}>Tamam</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ── Right Sidebar ──────────────────────────────────────────────────────────
interface RightSidebarProps {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  styles: any;
}

function RightSidebar({ visible, title, onClose, children, styles }: RightSidebarProps) {
  return (
    <Modal visible={visible} animationType="slide" transparent={true} onRequestClose={onClose}>
      <View style={styles.sidebarOverlay}>
        <Pressable style={styles.sidebarBackdrop} onPress={onClose} />
        <View style={styles.sidebarPanel}>
          <SafeAreaView style={{ flex: 1 }} edges={['top', 'right', 'bottom']}>
            <View style={styles.sidebarHeader}>
              <Text style={styles.sidebarTitle}>{title}</Text>
              <TouchableOpacity onPress={onClose} style={styles.sidebarCloseBtn}>
                <X color="#fff" size={20} />
              </TouchableOpacity>
            </View>
            <View style={{ flex: 1 }}>
              {children}
            </View>
          </SafeAreaView>
        </View>
      </View>
    </Modal>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────
export default function PlanningScreen() {
  const colors = useThemeColors();
  const theme = useThemeStore((s) => s.theme);
  const isDark = theme === 'dark';
  const styles = React.useMemo(() => createStyles(colors, isDark), [colors, isDark]);

  const navigation = useNavigation<NativeStackNavigationProp<PlanningStackParamList>>();
  const route = useRoute<any>();
  const planningKind = route?.params?.planningKind ?? 'repair';

  const qc = useQueryClient();

  // Auto-refresh planning data when screen gains focus + every 30s while focused
  useAutoRefetch(['planning']);

  const [mode, setMode] = useState<Mode>('unplanned');
  const [date, setDate] = useState(toIsoDateOnly(new Date()));
  const { width } = useWindowDimensions();

  const [page, setPage] = useState(1);
  const pageSize = 50;
  const [q, setQ] = useState('');
  const [type, setType] = useState<'Repair' | 'Installation'>(planningKind === 'installation' ? 'Installation' : 'Repair');
  const [regionId, setRegionId] = useState<string | null>(null);

  // Sidebar state
  const [sidebar, setSidebar] = useState<SidebarType>(null);
  const [techSearch, setTechSearch] = useState('');
  const [regionSearch, setRegionSearch] = useState('');

  // Confirmation modals
  const [resultModal, setResultModal] = useState<{ title: string; message: string; isError?: boolean } | null>(null);

  // Date picker visibility
  const [datePickerVisible, setDatePickerVisible] = useState(false);
  const [filterDatePickerVisible, setFilterDatePickerVisible] = useState(false);
  const [planDatePickerVisible, setPlanDatePickerVisible] = useState(false);

  const [erpProducts, setErpProducts] = useState<ErpProduct[]>([]);

  React.useEffect(() => {
    let mounted = true;
    fetchErpProducts().then((data) => {
      if (mounted) {
        setErpProducts(data);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  const installableNames = useMemo(() => {
    return getInstallableNames(erpProducts);
  }, [erpProducts]);

  const getRepairChannel = React.useCallback((productName: string) => {
    if (installableNames.size === 0) return null;
    const isSaha = installableNames.has((productName || '').trim().toLowerCase());
    return isSaha ? 'Saha' : 'Atölye';
  }, [installableNames]);

  const [activeServiceId, setActiveServiceId] = useState<string | null>(null);
  const [planDate, setPlanDate] = useState(toIsoDateOnly(new Date()));
  const [planTechId, setPlanTechId] = useState('');
  const [planQty, setPlanQty] = useState(1);
  const [planNote, setPlanNote] = useState('');
  const [planAddress, setPlanAddress] = useState('');
  const [showTechDropdown, setShowTechDropdown] = useState(false);

  React.useEffect(() => {
    const sId = route?.params?.serviceId;
    setType(planningKind === 'installation' ? 'Installation' : 'Repair');
    if (sId) {
      setActiveServiceId(sId);
      setMode('plan');
      setPlanTechId('');
      setPlanQty(1);
      setPlanNote('');
      setPlanAddress('');
      // Clear route param so it doesn't stick
      navigation.setParams({ serviceId: undefined } as any);
    } else {
      setMode('unplanned');
      setActiveServiceId(null);
    }
  }, [planningKind, route?.params?.serviceId]);

  const detailQuery = useQuery({
    queryKey: ['planning', 'detail', activeServiceId],
    queryFn: () => apiJson<any>(`/api/servicerecords/${activeServiceId}`),
    enabled: mode === 'plan' && activeServiceId !== null,
  });

  const tasksQuery = useQuery({
    queryKey: ['planning', 'tasks', activeServiceId],
    queryFn: () => apiJson<any[]>(`/api/installations/tasks?serviceId=${activeServiceId}`),
    enabled: mode === 'plan' && activeServiceId !== null && type === 'Installation',
  });



  const planRepairMutation = useMutation({
    mutationFn: async () => {
      return await apiJson(`/api/servicerecords/${activeServiceId}/plan`, {
        method: 'PATCH',
        body: JSON.stringify({
          plannedDate: new Date(planDate).toISOString(),
          technicianId: planTechId,
        }),
      });
    },
    onSuccess: async () => {
      setResultModal({
        title: 'Planlama Başarılı',
        message: 'Arıza kaydı başarıyla planlandı.',
      });
      setMode('unplanned');
      setActiveServiceId(null);
      await qc.invalidateQueries({ queryKey: ['planning', 'unplanned'] });
      await qc.invalidateQueries({ queryKey: ['planning', 'day'] }); await qc.invalidateQueries({ queryKey: ['planning', 'techs', 'available'] }); await qc.invalidateQueries({ queryKey: ['servicerecords'] }); await qc.invalidateQueries({ queryKey: ['installations'] });
    },
    onError: (err: any) => {
      setResultModal({
        title: 'Planlama Hatası',
        message: err?.message || 'Planlama sırasında hata oluştu.',
        isError: true,
      });
    },
  });

  const planInstallationMutation = useMutation({
    mutationFn: async () => {
      const desc = detailQuery.data?.problemDescription ?? '';
      const m = desc.match(/Miktar\s*:\s*(\d+)/i);
      const totalQty = m ? Math.max(1, Number(m[1]) || 1) : 1;

      return await apiJson(`/api/installations/allocate`, {
        method: 'POST',
        body: JSON.stringify({
          plannedDateUtc: new Date(planDate).toISOString(),
          allocations: [{
            serviceId: activeServiceId,
            technicianId: planTechId,
            quantity: planQty,
            notes: planNote || undefined,
            customAddress: planAddress || undefined,
            plannedDateUtc: new Date(planDate).toISOString(),
          }],
          totalQuantity: totalQty,
        }),
      });
    },
    onSuccess: async (res: any) => {
      const createdCount = res?.created ?? res?.acceptedCount ?? 0;
      if (createdCount === 0) {
        const rejections = res?.rejectedAllocations ?? [];
        const rejReason = rejections[0]?.reason ?? '';
        const msg = rejReason === 'SkillMissing' ? 'Teknisyenin montaj yetkisi yok.'
          : rejReason === 'RegionMismatch' ? 'Teknisyen farklı bölgede.'
          : rejReason === 'CapacityExceeded' ? 'Teknisyen kapasitesi dolu.'
          : rejReason === 'WorkingHours' ? 'Planlama saati çalışma saatleri dışında.'
          : `Planlama reddedildi (${rejReason || 'bilinmiyor'}).`;
        
        setResultModal({
          title: 'Planlama Reddedildi',
          message: msg,
          isError: true,
        });
        return;
      }

      setResultModal({
        title: 'Planlama Başarılı',
        message: `${createdCount} adet montaj planlandı.`,
      });
      setPlanTechId('');
      setPlanNote('');
      setPlanAddress('');
      setPlanQty(1);
      await tasksQuery.refetch();
      await qc.invalidateQueries({ queryKey: ['planning', 'unplanned'] });
      await qc.invalidateQueries({ queryKey: ['planning', 'day'] }); await qc.invalidateQueries({ queryKey: ['planning', 'techs', 'available'] }); await qc.invalidateQueries({ queryKey: ['servicerecords'] }); await qc.invalidateQueries({ queryKey: ['installations'] });
    },
    onError: (err: any) => {
      setResultModal({
        title: 'Planlama Hatası',
        message: err?.message || 'Planlama sırasında hata oluştu.',
        isError: true,
      });
    },
  });

  const cancelTaskMutation = useMutation({
    mutationFn: async (taskId: string) => {
      return await apiJson(`/api/installations/tasks/${encodeURIComponent(taskId)}/status`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'Deferred',
          reason: 'Mobil iptal/erteleme',
        }),
      });
    },
    onSuccess: async () => {
      setResultModal({
        title: 'İşlem Başarılı',
        message: 'Montaj görevi ertelendi.',
      });
      await tasksQuery.refetch();
      await qc.invalidateQueries({ queryKey: ['planning', 'unplanned'] });
      await qc.invalidateQueries({ queryKey: ['planning', 'day'] }); await qc.invalidateQueries({ queryKey: ['planning', 'techs', 'available'] }); await qc.invalidateQueries({ queryKey: ['servicerecords'] }); await qc.invalidateQueries({ queryKey: ['installations'] });
    },
  });

  const [editingTask, setEditingTask] = useState<any | null>(null);
  const [editTechId, setEditTechId] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editNote, setEditNote] = useState('');
  const [editDatePickerVisible, setEditDatePickerVisible] = useState(false);

  const updateTaskMutation = useMutation({
    mutationFn: async () => {
      return await apiJson(`/api/installations/tasks/${encodeURIComponent(editingTask.id)}`, {
        method: 'PUT',
        body: JSON.stringify({
          plannedAt: new Date(editDate).toISOString(),
          assignedTechnicianId: editTechId,
          customAddress: editAddress || undefined,
          notes: editNote || undefined,
        }),
      });
    },
    onSuccess: async () => {
      setResultModal({
        title: 'Güncelleme Başarılı',
        message: 'Montaj görevi başarıyla güncellendi.',
      });
      setEditingTask(null);
      await tasksQuery.refetch();
      await qc.invalidateQueries({ queryKey: ['planning', 'unplanned'] });
      await qc.invalidateQueries({ queryKey: ['planning', 'day'] }); await qc.invalidateQueries({ queryKey: ['planning', 'techs', 'available'] }); await qc.invalidateQueries({ queryKey: ['servicerecords'] }); await qc.invalidateQueries({ queryKey: ['installations'] });
    },
    onError: (err: any) => {
      setResultModal({
        title: 'Güncelleme Hatası',
        message: err?.message || 'Güncelleme sırasında hata oluştu.',
        isError: true,
      });
    },
  });

  const deleteTaskMutation = useMutation({
    mutationFn: async (taskId: string) => {
      return await apiJson(`/api/installations/tasks/${encodeURIComponent(taskId)}`, {
        method: 'DELETE',
      });
    },
    onSuccess: async () => {
      setResultModal({
        title: 'Silme Başarılı',
        message: 'Montaj planlaması silindi ve kalan miktar yeniden planlanabilir hale getirildi.',
      });
      await tasksQuery.refetch();
      await qc.invalidateQueries({ queryKey: ['planning', 'unplanned'] });
      await qc.invalidateQueries({ queryKey: ['planning', 'day'] }); await qc.invalidateQueries({ queryKey: ['planning', 'techs', 'available'] }); await qc.invalidateQueries({ queryKey: ['servicerecords'] }); await qc.invalidateQueries({ queryKey: ['installations'] });
    },
    onError: (err: any) => {
      setResultModal({
        title: 'Silme Hatası',
        message: err?.message || 'Silme işlemi başarısız oldu.',
        isError: true,
      });
    },
  });

  const handleDelete = (taskId: string) => {
    Alert.alert(
      'Planlamayı Sil',
      'Bu planlama satırını silmek istediğinize emin misiniz? Bu işlem kalan miktarı yeniden planlanabilir yapacaktır.',
      [
        { text: 'Vazgeç', style: 'cancel' },
        { text: 'Sil', style: 'destructive', onPress: () => deleteTaskMutation.mutate(taskId) },
      ]
    );
  };

  const unplannedQuery = useQuery<PagedResult<ServiceRecord>>({
    queryKey: ['planning', 'unplanned', type, q, regionId, page],
    queryFn: ({ signal }) =>
      fetchServiceRecordsPaged(
        {
          q: q.trim() || undefined,
          statuses: 'New,Planned',
          type,
          regionId: regionId ?? undefined,
          page,
          pageSize,
        },
        signal
      ),
    placeholderData: keepPreviousData,
    enabled: mode === 'unplanned',
  });

  const dayQuery = useQuery({
    queryKey: ['planning', 'day', date],
    queryFn: ({ signal }) => fetchPlanningDay(new Date(`${date}T00:00:00Z`).toISOString(), signal),
    enabled: mode === 'day',
  });

  const techQuery = useQuery({
    queryKey: ['planning', 'techs', 'available', planDate],
    queryFn: ({ signal }) => fetchAvailableTechnicians(planDate, signal),
    staleTime: 60_000,
  });

  const regionsQuery = useQuery({
    queryKey: ['planning', 'regions'],
    queryFn: ({ signal }) => fetchRegions(signal),
    staleTime: 300_000,
  });

  // Build workload map from the already-fetched technician data.
  // The /api/technicians/available endpoint already returns plannedServicesToday
  // which is computed server-side from both service records AND installation tasks.
  const workloadMap = useMemo<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    for (const t of techQuery.data ?? []) {
      map[t.id] = t.plannedServicesToday ?? t.dailyTasks ?? 0;
    }
    return map;
  }, [techQuery.data]);


  const eligibleTechnicians = useMemo(() => {
    const techs = techQuery.data ?? [];
    const workloads = workloadMap;
    const recordRegionId = detailQuery.data?.regionId;
    
    return [...techs].sort((a, b) => {
      const aRegion = recordRegionId && a.primaryRegionId === recordRegionId ? 0 : 1;
      const bRegion = recordRegionId && b.primaryRegionId === recordRegionId ? 0 : 1;
      if (aRegion !== bRegion) return aRegion - bRegion;
      return (workloads[a.id] ?? 0) - (workloads[b.id] ?? 0);
    });
  }, [techQuery.data, workloadMap, detailQuery.data?.regionId]);

  const filteredTechs: TechnicianDto[] = useMemo(() => {
    const all = techQuery.data ?? [];
    const s = techSearch.trim().toLowerCase();
    if (!s) return all;
    return all.filter((t) => t.fullName.toLowerCase().includes(s));
  }, [techQuery.data, techSearch]);

  const filteredRegions: RegionOption[] = useMemo(() => {
    const all = regionsQuery.data ?? [];
    const s = regionSearch.trim().toLowerCase();
    if (!s) return all;
    return all.filter((r) => r.name.toLowerCase().includes(s));
  }, [regionsQuery.data, regionSearch]);

  const selectedRegionName = useMemo(() => {
    if (!regionId) return '';
    return (regionsQuery.data ?? []).find((r) => r.id === regionId)?.name ?? '';
  }, [regionId, regionsQuery.data]);



  const openDetail = (serviceId: string) => {
    setActiveServiceId(serviceId);
    setMode('plan');
    setPlanTechId('');
    setPlanQty(1);
    setPlanNote('');
  };


  const unplannedItems = unplannedQuery.data?.items ?? [];
  const isLarge = width > 600;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={[styles.orb, styles.orb1]} />
      <View style={[styles.orb, styles.orb2]} />

      <KeyboardAvoidingView style={styles.flex1} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>
                {planningKind === 'installation' ? 'Montaj Planlama' : 'Ürün Arıza Planlama'}
              </Text>
              <Text style={styles.subtitle}>
                {planningKind === 'installation' ? 'Montaj kayıtları ve rotalar' : 'Servis arıza atamaları ve rotalar'}
              </Text>
            </View>
            <TouchableOpacity style={styles.filterBtn} onPress={() => setSidebar('filters')}>
              <Filter color={colors.textSub} size={18} />
            </TouchableOpacity>
          </View>

          {/* Tab Switcher */}
          {mode !== 'plan' && (
            <View style={styles.tabContainer}>
              <TouchableOpacity
                style={[styles.tab, mode === 'unplanned' && styles.tabActive]}
                onPress={() => setMode('unplanned')}
              >
                <Text style={[styles.tabText, mode === 'unplanned' && styles.tabTextActive]}>
                  Planlama Bekleyenler
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tab, mode === 'day' && styles.tabActive]}
                onPress={() => setMode('day')}
              >
                <Text style={[styles.tabText, mode === 'day' && styles.tabTextActive]}>
                  Günlük Rapor / Rotalar
                </Text>
              </TouchableOpacity>
            </View>
          )}


          {mode === 'unplanned' ? (
            <>
              {/* Filter chips */}
              <View style={styles.chipRow}>
                <TouchableOpacity style={styles.chip} onPress={() => setSidebar('region')}>
                  <Map color={colors.textSub} size={14} />
                  <Text style={styles.chipText} numberOfLines={1}>
                    {selectedRegionName || 'Bölge'}
                  </Text>
                  {regionId && (
                    <TouchableOpacity onPress={() => setRegionId(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <X color="#ef4444" size={13} />
                    </TouchableOpacity>
                  )}
                  {!regionId && <ChevronRight color={colors.textMuted} size={14} />}
                </TouchableOpacity>

                <View style={styles.searchBar}>
                  <Search color={colors.textSub} size={16} style={{ marginRight: 6 }} />
                  <TextInput
                    style={styles.searchInput}
                    value={q}
                    onChangeText={setQ}
                    placeholder="Ara..."
                    placeholderTextColor={colors.textMuted}
                  />
                </View>
              </View>



              {/* List */}
              {unplannedQuery.isLoading ? (
                <Spinner style={{ marginTop: 20 }} />
              ) : (
                <FlatList
                  data={unplannedItems}
                  keyExtractor={(x) => x.id}
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={styles.list}
                  ListEmptyComponent={() => (
                    <EmptyState message="Bekleyen kayıt bulunamadı." />
                  )}
                  renderItem={({ item }) => {
                    const channel = getRepairChannel(item.productName || '');
                    const isAtolye = channel === 'Atölye';

                    const handleTransfer = async () => {
                      try {
                        await updateServiceRecordStatus(item.id, {
                          status: isAtolye ? 'Workshop' : 'InRepair',
                          notes: isAtolye ? 'Atölyeye aktarıldı (Mobil).' : 'Sahaya aktarıldı (Mobil).',
                        });
                        await qc.invalidateQueries({ queryKey: ['planning', 'unplanned'] });
                        await qc.invalidateQueries({ queryKey: ['planning', 'day'] }); await qc.invalidateQueries({ queryKey: ['planning', 'techs', 'available'] }); await qc.invalidateQueries({ queryKey: ['servicerecords'] }); await qc.invalidateQueries({ queryKey: ['installations'] });
                        setResultModal({
                          title: 'Aktarım Başarılı',
                          message: isAtolye ? 'Servis atölyeye başarıyla aktarıldı.' : 'Servis sahaya başarıyla aktarıldı.',
                        });
                      } catch (err: any) {
                        setResultModal({
                          title: 'Aktarım Hatası',
                          message: err?.message || 'Aktarım sırasında bir hata oluştu.',
                          isError: true,
                        });
                      }
                    };

                    return (
                      <TouchableOpacity
                        onPress={() => openDetail(item.id)}
                        activeOpacity={0.8}
                      >
                        <Card style={styles.card}>
                          <View style={styles.cardMainRow}>
                            <View style={styles.cardContent}>
                              <View style={styles.cardHeader}>
                                <Text style={styles.serviceNumber}>{item.serviceNumber}</Text>
                                <Badge label={item.statusLabel || item.status} type={item.status === 'Planned' ? 'success' : 'neutral'} />
                              </View>
                              <Text style={styles.cardMain} numberOfLines={1}>{item.customerName || 'İsimsiz'}</Text>
                              <Text style={styles.cardSub} numberOfLines={1}>{item.productName || 'Ürün Yok'}</Text>
                              <Text style={[styles.cardSub, { color: '#fca5a5', marginTop: 2 }]} numberOfLines={1}>📍 {item.customerAddress || 'Adres belirtilmemiş'}</Text>
                              {item.status === 'Planned' && item.assignedTechnicianName && (
                                <Text style={styles.cardTechName}>Atanan: {item.assignedTechnicianName}</Text>
                              )}
                            </View>
                          </View>

                          <View style={styles.cardActionsRow}>
                            {item.status === 'New' ? (
                              <TouchableOpacity
                                style={styles.cardPlanBtn}
                                onPress={() => openDetail(item.id)}
                              >
                                <Text style={styles.cardPlanBtnText}>Planla</Text>
                              </TouchableOpacity>
                            ) : (
                              <View style={styles.cardDoubleActions}>
                                <TouchableOpacity
                                  style={styles.cardContinueBtn}
                                  onPress={() => openDetail(item.id)}
                                >
                                  <Text style={styles.cardContinueBtnText}>Planlamaya Devam Et</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                  style={[
                                    styles.cardTransferBtn,
                                    isAtolye ? styles.cardTransferAtolye : styles.cardTransferSaha
                                  ]}
                                  onPress={handleTransfer}
                                >
                                  <Text style={styles.cardTransferText}>
                                    {isAtolye ? 'Atölyeye Aktar' : 'Sahaya Aktar'}
                                  </Text>
                                </TouchableOpacity>
                              </View>
                            )}
                          </View>
                        </Card>
                      </TouchableOpacity>
                    );
                  }}
                />
              )}
            </>
          ) : mode === 'day' ? (
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
              {dayQuery.isLoading ? <Spinner /> : null}
              {dayQuery.data ? (
                <>
                  <View style={styles.statsContainer}>
                    <Card style={styles.statBox}>
                      <Text style={styles.statLabel}>Planlı Servis</Text>
                      <Text style={styles.statValue}>{dayQuery.data.plannedServices}</Text>
                    </Card>
                    <Card style={styles.statBox}>
                      <Text style={styles.statLabel}>Planlı Rota</Text>
                      <Text style={styles.statValue}>{dayQuery.data.plannedRoutes}</Text>
                    </Card>
                  </View>

                  <Text style={styles.sectionTitle}>Servisler ({dayQuery.data.services?.length ?? 0})</Text>
                  {(dayQuery.data.services ?? []).slice(0, 20).map((s) => (
                    <TouchableOpacity key={s.id} onPress={() => openDetail(s.id)} activeOpacity={0.8}>
                      <Card style={styles.itemCard}>
                        <View style={styles.itemCardHeader}>
                          <Text style={styles.itemCardTitle}>{s.serviceNumber}</Text>
                           <Badge label={s.status} type={s.status === 'Completed' || s.status === 'Ready' ? 'success' : 'neutral'} />
                        </View>
                        <Text style={styles.itemCardDesc} numberOfLines={1}>{s.customerName}</Text>
                        <Text style={styles.itemCardTech} numberOfLines={1}>Teknisyen: {s.technicianName || 'Atanmamış'}</Text>
                      </Card>
                    </TouchableOpacity>
                  ))}

                  <Text style={[styles.sectionTitle, { marginTop: 16 }]}>Rotalar ({dayQuery.data.routes?.length ?? 0})</Text>
                  {(dayQuery.data.routes ?? []).slice(0, 20).map((r) => (
                    <Card key={r.id} style={styles.itemCard}>
                      <View style={styles.itemCardHeader}>
                        <Text style={styles.itemCardTitle}>{r.routeNumber}</Text>
                        <Badge label={r.status} type={r.status === 'Completed' ? 'success' : 'neutral'} />
                      </View>
                      <Text style={styles.itemCardDesc} numberOfLines={1}>{r.name}</Text>
                      <Text style={styles.itemCardTech} numberOfLines={1}>Teknisyen: {r.technicianName || 'Atanmamış'}</Text>
                    </Card>
                  ))}
                </>
              ) : null}
            </ScrollView>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
              <View style={styles.planDetailHeader}>
                <TouchableOpacity
                  style={styles.backBtn}
                  onPress={() => {
                    setMode('unplanned');
                    setActiveServiceId(null);
                  }}
                >
                  <ChevronLeft color="#fff" size={20} />
                  <Text style={styles.backBtnText}>Geri Dön</Text>
                </TouchableOpacity>
                <Text style={styles.planDetailTitle}>Planlama Detayı</Text>
              </View>

              {detailQuery.isLoading ? (
                <Spinner style={{ marginTop: 40 }} />
              ) : detailQuery.isError || !detailQuery.data ? (
                <View style={styles.errorContainer}>
                  <Text style={styles.errorText}>Kayıt yüklenemedi.</Text>
                </View>
              ) : (() => {
                const record = detailQuery.data;
                const isInstall = type === 'Installation';

                const planTasks = tasksQuery.data ?? [];
                const isDeferred = (t: any) => { const s = t.Status ?? t.status; return s === 4 || s === 'Deferred'; };
                const isCancelled = (t: any) => { const s = t.Status ?? t.status; return s === 3 || s === 'Cancelled'; };
                
                const parsedTotalQty = (() => {
                  const desc = record.problemDescription ?? '';
                  const m = desc.match(/Miktar\s*:\s*(\d+)/i);
                  return m ? Math.max(0, Number(m[1]) || 0) : 0;
                })();

                const totalQty = parsedTotalQty || planTasks.filter((t: any) => !isCancelled(t)).reduce((s: number, t: any) => s + (t.Quantity ?? t.quantity ?? 1), 0);
                const plannedQty = planTasks.filter((t: any) => !isDeferred(t) && !isCancelled(t)).reduce((s: number, t: any) => s + (t.Quantity ?? t.quantity ?? 1), 0);
                const remainingQuantity = Math.max(0, totalQty - plannedQty);
                const isComplete = remainingQuantity === 0 && plannedQty > 0;

                return (
                  <View style={{ gap: 14 }}>
                    <Card style={styles.detailCard}>
                      <View style={styles.detailCardHeader}>
                        <Text style={styles.detailServiceNumber}>{record.serviceNumber}</Text>
                        <Badge label={record.statusLabel ?? record.status} type={record.status === 'Planned' ? 'success' : 'neutral'} />
                      </View>
                      
                      <View style={styles.detailInfoSection}>
                        <Text style={styles.detailLabel}>Müşteri:</Text>
                        <Text style={styles.detailValue}>{record.customerName || 'Belirtilmemiş'}</Text>
                        {record.customerPhone ? <Text style={styles.detailSubValue}>{record.customerPhone}</Text> : null}
                      </View>

                      <View style={styles.detailInfoSection}>
                        <Text style={styles.detailLabel}>Ürün:</Text>
                        <Text style={styles.detailValue}>{record.productName}</Text>
                      </View>

                      <View style={styles.detailInfoSection}>
                        <Text style={styles.detailLabel}>Adres:</Text>
                        <Text style={[styles.detailValue, { color: '#fca5a5', fontWeight: '700' }]}>
                          {record.customerAddress || 'Adres belirtilmemiş'}
                        </Text>
                      </View>

                      <View style={styles.detailInfoSection}>
                        <Text style={styles.detailLabel}>Bölge:</Text>
                        <Text style={styles.detailValue}>{record.regionName || 'Bölge atanmamış'}</Text>
                      </View>

                      {record.problemDescription ? (
                        <View style={styles.detailProblemBox}>
                          <Text style={styles.detailProblemTitle}>Açıklama / Arıza Tanımı:</Text>
                          <Text style={styles.detailProblemText}>{record.problemDescription}</Text>
                        </View>
                      ) : null}
                    </Card>

                    {!isInstall && (
                      <>
                        <Card style={styles.planCard}>
                          <View style={styles.addressHighlightBox}>
                            <Text style={styles.addressHighlightText}>
                              📍 <Text style={{ fontWeight: '800' }}>Arıza / Hizmet Adresi: </Text>
                              {record.customerAddress || 'Adres belirtilmemiş'}
                            </Text>
                          </View>

                          <Text style={styles.planCardTitle}>Planlama Tarihi</Text>
                          <TouchableOpacity
                            style={styles.planDateRow}
                            onPress={() => setPlanDatePickerVisible(true)}
                            activeOpacity={0.7}
                          >
                            <Calendar color={colors.textSub} size={18} style={{ marginRight: 8 }} />
                            <Text style={[styles.planDateInput, { lineHeight: 42 }]}>{planDate ? formatDate(planDate) : 'Tarih Seç'}</Text>
                            <ChevronRight color={colors.textMuted} size={16} />
                          </TouchableOpacity>
                        </Card>

                        <Card style={styles.planCard}>
                          <View style={styles.planCardHeaderRow}>
                            <Text style={styles.planCardTitle}>Teknisyen Seçimi</Text>
                            {record.regionName ? (
                              <Text style={styles.planCardSubTitle}>({record.regionName} öncelikli)</Text>
                            ) : null}
                          </View>

                          {eligibleTechnicians.length === 0 ? (
                            <Text style={styles.emptyText}>Müsait teknisyen bulunamadı.</Text>
                          ) : (
                            <View style={styles.techList}>
                              {eligibleTechnicians.map((tech) => {
                                const loadCount = workloadMap?.[tech.id] ?? 0;
                                const capacity = tech.maxDailyTasks || 8;
                                const percent = Math.min(100, Math.round((loadCount / capacity) * 100));
                                const isSelected = planTechId === tech.id;

                                return (
                                  <TouchableOpacity
                                    key={tech.id}
                                    style={[styles.techRowBtn, isSelected && styles.techRowBtnActive]}
                                    onPress={() => setPlanTechId(tech.id)}
                                  >
                                    <View style={styles.techRowHeader}>
                                      <View style={styles.techAvatar}>
                                        <Text style={styles.techAvatarText}>{tech.fullName[0]}</Text>
                                      </View>
                                      <View style={{ flex: 1 }}>
                                        <Text style={styles.techName}>{tech.fullName}</Text>
                                        <Text style={styles.techRegion}>{tech.regionName || 'Bölge yok'}</Text>
                                      </View>
                                      <View style={[
                                        styles.techLoadBadge,
                                        loadCount >= capacity ? styles.loadBadgeRed : loadCount > 0 ? styles.loadBadgeOrange : styles.loadBadgeGreen
                                      ]}>
                                        <Text style={styles.techLoadText}>{loadCount} iş</Text>
                                      </View>
                                    </View>
                                  </TouchableOpacity>
                                );
                              })}
                            </View>
                          )}
                        </Card>

                        <TouchableOpacity
                          style={[
                            styles.submitPlanBtn,
                            (!planDate || !planTechId || planRepairMutation.isPending) && styles.submitPlanBtnDisabled
                          ]}
                          onPress={() => planRepairMutation.mutate()}
                          disabled={!planDate || !planTechId || planRepairMutation.isPending}
                        >
                          {planRepairMutation.isPending ? (
                            <ActivityIndicator color="#fff" size="small" />
                          ) : (
                            <Text style={styles.submitPlanBtnText}>Planla ve Kaydet</Text>
                          )}
                        </TouchableOpacity>
                      </>
                    )}

                    {isInstall && (
                      <>
                        <Card style={[
                          styles.installStatsCard,
                          isComplete ? styles.statsComplete : remainingQuantity > 0 && plannedQty > 0 ? styles.statsPartial : styles.statsEmpty
                        ]}>
                          <View style={styles.installStatsRow}>
                            <View style={styles.installStatItem}>
                              <Text style={styles.installStatValue}>{totalQty}</Text>
                              <Text style={styles.installStatLabel}>Toplam</Text>
                            </View>
                            <View style={styles.installStatDivider} />
                            <View style={styles.installStatItem}>
                              <Text style={styles.installStatValue}>{plannedQty}</Text>
                              <Text style={styles.installStatLabel}>Planlanan</Text>
                            </View>
                            <View style={styles.installStatDivider} />
                            <View style={styles.installStatItem}>
                              <Text style={[styles.installStatValue, { color: isComplete ? '#10b981' : '#f97316' }]}>{remainingQuantity}</Text>
                              <Text style={styles.installStatLabel}>Kalan</Text>
                            </View>
                          </View>

                          {plannedQty > 0 && (
                            <TouchableOpacity
                              style={[styles.transferSahaBtn, !isComplete && { backgroundColor: '#f97316' }]}
                              onPress={async () => {
                                try {
                                  await updateServiceRecordStatus(record.id, {
                                    status: 'InRepair',
                                    notes: isComplete
                                      ? 'Tüm montaj görevleri planlandı, sahaya aktarıldı.'
                                      : `${plannedQty} montaj kalemi planlandı ve sahaya aktarıldı, ${remainingQuantity} adet kaldı.`,
                                  });
                                  setResultModal({
                                    title: 'Aktarım Başarılı',
                                    message: isComplete
                                      ? 'Tüm montaj görevleri başarıyla sahaya aktarıldı.'
                                      : `${plannedQty} kalem sahaya aktarıldı. Kalan ${remainingQuantity} kalem sonra planlanabilir.`,
                                  });
                                  setMode('unplanned');
                                  setActiveServiceId(null);
                                  await qc.invalidateQueries({ queryKey: ['planning', 'unplanned'] });
                                } catch (err: any) {
                                  setResultModal({
                                    title: 'Aktarım Hatası',
                                    message: err?.message || 'Aktarım sırasında bir hata oluştu.',
                                    isError: true,
                                  });
                                }
                              }}
                            >
                              <Text style={styles.transferSahaBtnText}>
                                {isComplete ? 'Sahaya Aktar' : `${plannedQty} Adeti Sahaya Aktar`}
                              </Text>
                            </TouchableOpacity>
                          )}
                        </Card>

                        <Card style={styles.planCard}>
                          <Text style={styles.planCardTitle}>Yeni Planlama Satırı Ekle</Text>

                          <View style={styles.addressHighlightBox}>
                            <Text style={styles.addressHighlightText}>
                              📍 <Text style={{ fontWeight: '800' }}>Montaj / Hizmet Adresi: </Text>
                              {record.customerAddress || 'Adres belirtilmemiş'}
                            </Text>
                          </View>

                          <Text style={styles.inputLabel}>Planlama Tarihi *</Text>
                          <TouchableOpacity
                            style={styles.planDateRow}
                            onPress={() => setPlanDatePickerVisible(true)}
                            activeOpacity={0.7}
                          >
                            <Calendar color={colors.textSub} size={18} style={{ marginRight: 8 }} />
                            <Text style={[styles.planDateInput, { lineHeight: 42 }]}>{planDate ? formatDate(planDate) : 'Tarih Seç'}</Text>
                            <ChevronRight color={colors.textMuted} size={16} />
                          </TouchableOpacity>

                          <Text style={styles.inputLabel}>Miktar * (Maks: {remainingQuantity})</Text>
                          <TextInput
                            style={styles.planQtyInput}
                            value={String(planQty)}
                            onChangeText={(text) => {
                              const val = parseInt(text, 10);
                              if (isNaN(val)) setPlanQty(0);
                              else setPlanQty(Math.min(remainingQuantity, val));
                            }}
                            keyboardType="number-pad"
                            placeholder="Miktar girin"
                            placeholderTextColor={colors.textMuted}
                          />

                          <Text style={styles.inputLabel}>Atama Adresi</Text>
                          <TextInput
                            style={styles.planNotesInput}
                            value={planAddress}
                            onChangeText={setPlanAddress}
                            placeholder="Atama adresi girin..."
                            placeholderTextColor={colors.textMuted}
                            multiline
                            numberOfLines={2}
                          />

                          <Text style={styles.inputLabel}>Not</Text>
                          <TextInput
                            style={styles.planNotesInput}
                            value={planNote}
                            onChangeText={setPlanNote}
                            placeholder="Not girin..."
                            placeholderTextColor={colors.textMuted}
                            multiline
                            numberOfLines={2}
                          />

                          <Text style={styles.inputLabel}>Teknisyen Seç *</Text>
                          <View style={styles.techSelectionBox}>
                            {eligibleTechnicians.map((t) => {
                              const load = workloadMap?.[t.id] ?? 0;
                              const isSelected = planTechId === t.id;
                              return (
                                <TouchableOpacity
                                  key={t.id}
                                  style={[styles.techChip, isSelected && styles.techChipActive]}
                                  onPress={() => setPlanTechId(t.id)}
                                >
                                  <Text style={[styles.techChipText, isSelected && styles.techChipTextActive]}>
                                    {t.fullName} ({load} iş)
                                  </Text>
                                </TouchableOpacity>
                              );
                            })}
                          </View>

                          <TouchableOpacity
                            style={[
                              styles.submitPlanBtn,
                              (!planDate || !planTechId || planQty < 1 || planInstallationMutation.isPending) && styles.submitPlanBtnDisabled
                            ]}
                            onPress={() => planInstallationMutation.mutate()}
                            disabled={!planDate || !planTechId || planQty < 1 || planInstallationMutation.isPending}
                          >
                            {planInstallationMutation.isPending ? (
                              <ActivityIndicator color="#fff" size="small" />
                            ) : (
                              <Text style={styles.submitPlanBtnText}>PLANLA</Text>
                            )}
                          </TouchableOpacity>
                        </Card>

                        <Card style={styles.planCard}>
                          <Text style={styles.planCardTitle}>Planlama Geçmişi</Text>

                          {tasksQuery.isLoading ? (
                            <ActivityIndicator color="#B91C1C" size="small" />
                          ) : planTasks.length === 0 ? (
                            <Text style={styles.emptyText}>Henüz planlama satırı yok.</Text>
                          ) : (
                            <View style={styles.historyList}>
                              {planTasks.map((task: any, idx: number) => {
                                const statusMap: Record<string | number, { label: string; color: string }> = {
                                  0: { label: 'Planlandı', color: '#3b82f6' },
                                  1: { label: 'Devam Ediyor', color: '#f59e0b' },
                                  2: { label: 'Gerçekleşti', color: '#10b981' },
                                  3: { label: 'İptal', color: '#ef4444' },
                                  4: { label: 'Ertelendi', color: '#f97316' },
                                  Planned: { label: 'Planlandı', color: '#3b82f6' },
                                  InProgress: { label: 'Devam Ediyor', color: '#f59e0b' },
                                  Completed: { label: 'Gerçekleşti', color: '#10b981' },
                                  Cancelled: { label: 'İptal', color: '#ef4444' },
                                  Deferred: { label: 'Ertelendi', color: '#f97316' },
                                };
                                const status = task.status ?? task.Status;
                                const statusInfo = statusMap[status] ?? { label: task.statusLabel ?? status, color: '#9ca3af' };
                                const techName = task.technicianName ?? task.TechnicianName ?? 'Atanmadı';
                                const qty = task.quantity ?? task.Quantity ?? 1;
                                const plannedAt = task.plannedAt ?? task.PlannedAt;
                                const note = task.notes ?? task.Notes ?? '-';

                                return (
                                  <View key={task.id || idx} style={styles.historyItem}>
                                    <View style={styles.historyHeader}>
                                      <Text style={styles.historyTechName}>{techName}</Text>
                                      <View style={[styles.historyStatusBadge, { backgroundColor: statusInfo.color + '20' }]}>
                                        <Text style={[styles.historyStatusText, { color: statusInfo.color }]}>{statusInfo.label}</Text>
                                      </View>
                                    </View>
                                    
                                    <View style={styles.historyDetails}>
                                      <Text style={styles.historyDetailText}>Miktar: {qty}</Text>
                                      <Text style={styles.historyDetailText}>
                                        Tarih: {plannedAt ? new Date(plannedAt).toLocaleDateString('tr-TR') : '-'}
                                      </Text>
                                    </View>

                                    <Text style={styles.historyNotes}>📍 Atama Adresi: {task.customAddress ?? task.CustomAddress ?? '-'}</Text>
                                    <Text style={styles.historyNotes}>📝 Not: {note}</Text>
                                     {(() => {
                                       const isEditable = status === 'Planned' || status === 'Deferred' || status === 0 || status === 4;
                                       return isEditable ? (
                                         <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                                           <TouchableOpacity
                                             style={[styles.deferBtn, { flex: 1, backgroundColor: 'rgba(59, 130, 246, 0.08)', borderColor: 'rgba(59, 130, 246, 0.2)' }]}
                                             onPress={() => {
                                               setEditingTask(task);
                                               setEditTechId(task.assignedTechnicianId ?? task.AssignedTechnicianId ?? '');
                                               const tpAt = task.plannedAt ?? task.PlannedAt;
                                               setEditDate(tpAt ? new Date(tpAt).toISOString().slice(0, 10) : toIsoDateOnly(new Date()));
                                               setEditAddress(task.customAddress ?? task.CustomAddress ?? '');
                                               setEditNote(task.notes ?? task.Notes ?? '');
                                             }}
                                           >
                                             <Text style={[styles.deferBtnText, { color: '#3b82f6' }]}>Düzenle</Text>
                                           </TouchableOpacity>
                                           <TouchableOpacity
                                             style={[styles.deferBtn, { flex: 1 }]}
                                             onPress={() => handleDelete(task.id)}
                                             disabled={deleteTaskMutation.isPending}
                                           >
                                             <Text style={styles.deferBtnText}>Sil</Text>
                                           </TouchableOpacity>
                                         </View>
                                       ) : (
                                         <View style={{ marginTop: 10, alignItems: 'center' }}>
                                           <Text style={{ fontSize: 10, color: colors.textMuted, fontStyle: 'italic' }}>Kilitli (Değiştirilemez)</Text>
                                         </View>
                                       );
                                     })()}                                  </View>
                                );
                              })}
                            </View>
                          )}
                        </Card>
                      </>
                    )}
                  </View>
                );
              })()}
            </ScrollView>
          )}
        </View>
      </KeyboardAvoidingView>



      {/* ── Region Sidebar ─────────────────────────────── */}
      <RightSidebar
        visible={sidebar === 'region'}
        title="Bölge Seç"
        onClose={() => setSidebar(null)}
        styles={styles}
      >
        <View style={styles.sidebarSearch}>
          <Search color={colors.textSub} size={16} style={{ marginRight: 8 }} />
          <TextInput
            style={styles.sidebarSearchInput}
            value={regionSearch}
            onChangeText={setRegionSearch}
            placeholder="Bölge ara..."
            placeholderTextColor={colors.textMuted}
          />
        </View>
        {regionId && (
          <TouchableOpacity
            style={styles.clearRegionBtn}
            onPress={() => { setRegionId(null); setSidebar(null); }}
          >
            <X color="#ef4444" size={16} />
            <Text style={styles.clearRegionText}>Filtreyi Temizle</Text>
          </TouchableOpacity>
        )}
        <FlatList
          data={filteredRegions}
          keyExtractor={(x) => x.id}
          contentContainerStyle={{ padding: 12, gap: 8 }}
          ListEmptyComponent={() => <EmptyState message="Bölge bulunamadı." />}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.sidebarRow, regionId === item.id && styles.sidebarRowActive]}
              onPress={() => { setRegionId(item.id); setSidebar(null); }}
            >
              <Map color={regionId === item.id ? '#B91C1C' : 'rgba(255,255,255,0.4)'} size={18} style={{ marginRight: 10 }} />
              <Text style={[styles.sidebarRowTitle, regionId === item.id && { color: '#B91C1C' }]}>{item.name}</Text>
              {regionId === item.id && <CheckCircle color="#B91C1C" size={18} />}
            </TouchableOpacity>
          )}
        />
      </RightSidebar>

      {/* ── Filters Sidebar ────────────────────────────── */}
      <RightSidebar
        visible={sidebar === 'filters'}
        title="Filtreler"
        onClose={() => setSidebar(null)}
        styles={styles}
      >
        <ScrollView contentContainerStyle={{ padding: 16, gap: 20 }}>
          <View>
            <Text style={styles.filterSectionLabel}>Tarih</Text>
            <View style={styles.filterDateRow}>
              <Calendar color={colors.textSub} size={16} style={{ marginRight: 8 }} />
              <TextInput
                style={styles.filterDateInput}
                value={date}
                onChangeText={(val) => setDate(val.replace(/[^0-9.-]/g, ''))}
                placeholderTextColor={colors.textMuted}
                placeholder="YYYY-MM-DD"
              />
            </View>
          </View>

          <View>
            <Text style={styles.filterSectionLabel}>Servis Türü</Text>
            <View style={styles.filterTypeRow}>
              <TouchableOpacity
                style={[styles.filterTypeBtn, type === 'Repair' && styles.filterTypeBtnActive]}
                onPress={() => { setType('Repair'); }}
              >
                <Wrench color={type === 'Repair' ? '#fff' : colors.textSub} size={18} />
                <Text style={[styles.filterTypeBtnText, type === 'Repair' && { color: '#fff' }]}>Arıza</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.filterTypeBtn, type === 'Installation' && styles.filterTypeBtnActive]}
                onPress={() => { setType('Installation'); }}
              >
                <Package color={type === 'Installation' ? '#fff' : colors.textSub} size={18} />
                <Text style={[styles.filterTypeBtnText, type === 'Installation' && { color: '#fff' }]}>Montaj</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View>
            <Text style={styles.filterSectionLabel}>Bölge</Text>
            <TouchableOpacity style={styles.filterRegionSelector} onPress={() => setSidebar('region')}>
              <Map color={colors.textSub} size={16} style={{ marginRight: 8 }} />
              <Text style={styles.filterRegionText}>{selectedRegionName || 'Tüm Bölgeler'}</Text>
              <ChevronRight color={colors.textMuted} size={16} />
            </TouchableOpacity>
            {regionId && (
              <TouchableOpacity style={styles.filterClearBtn} onPress={() => setRegionId(null)}>
                <X color="#ef4444" size={13} />
                <Text style={styles.filterClearText}>Bölge filtresini temizle</Text>
              </TouchableOpacity>
            )}
          </View>

          <TouchableOpacity style={styles.applyFiltersBtn} onPress={() => setSidebar(null)}>
            <Text style={styles.applyFiltersBtnText}>Filtreleri Uygula</Text>
          </TouchableOpacity>
        </ScrollView>
      </RightSidebar>



      {/* ── Date Picker Modals ─────────────────────────── */}
      {datePickerVisible && (
        <DatePickerModal
          visible={true}
          value={date}
          onSelect={(d) => setDate(d)}
          onClose={() => setDatePickerVisible(false)}
        />
      )}
      {filterDatePickerVisible && (
        <DatePickerModal
          visible={true}
          value={date}
          onSelect={(d) => setDate(d)}
          onClose={() => setFilterDatePickerVisible(false)}
        />
      )}
      {planDatePickerVisible && (
        <DatePickerModal
          visible={true}
          value={planDate}
          onSelect={(d) => setPlanDate(d)}
          onClose={() => setPlanDatePickerVisible(false)}
        />
      )}

      {/* ── Result Modal ───────────────────────────────── */}
      {resultModal && (
        <ResultModal
          visible={true}
          title={resultModal.title}
          message={resultModal.message}
          isError={resultModal.isError}
          onClose={() => setResultModal(null)}
          styles={styles}
        />
      )}

      {/* ── Edit Task Modal ────────────────────────────── */}
      {editingTask && (
        <Modal visible={true} animationType="slide" transparent={true} onRequestClose={() => setEditingTask(null)}>
          <View style={styles.confirmOverlay}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setEditingTask(null)} />
            <View style={[styles.confirmBox, { maxHeight: '90%', padding: 0, overflow: 'hidden' }]}>
              <View style={styles.sidebarHeader}>
                <Text style={styles.sidebarTitle}>Planlamayı Düzenle</Text>
                <TouchableOpacity onPress={() => setEditingTask(null)} style={styles.sidebarCloseBtn}>
                  <X color={colors.text} size={20} />
                </TouchableOpacity>
              </View>
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20, gap: 12 }}>
                <Text style={styles.inputLabel}>Tarih *</Text>
                <TouchableOpacity
                  style={styles.planDateRow}
                  onPress={() => setEditDatePickerVisible(true)}
                  activeOpacity={0.7}
                >
                  <Calendar color={colors.textSub} size={18} style={{ marginRight: 8 }} />
                  <Text style={[styles.planDateInput, { lineHeight: 42 }]}>{editDate ? formatDate(editDate) : 'Tarih Seç'}</Text>
                  <ChevronRight color={colors.textMuted} size={16} />
                </TouchableOpacity>

                <Text style={styles.inputLabel}>Atama Adresi</Text>
                <TextInput
                  style={styles.planNotesInput}
                  value={editAddress}
                  onChangeText={setEditAddress}
                  placeholder="Atama adresi girin..."
                  placeholderTextColor={colors.textMuted}
                  multiline
                  numberOfLines={2}
                />

                <Text style={styles.inputLabel}>Not</Text>
                <TextInput
                  style={styles.planNotesInput}
                  value={editNote}
                  onChangeText={setEditNote}
                  placeholder="Not girin..."
                  placeholderTextColor={colors.textMuted}
                  multiline
                  numberOfLines={2}
                />

                <Text style={styles.inputLabel}>Teknisyen Seç *</Text>
                <View style={styles.techSelectionBox}>
                  {eligibleTechnicians.map((t) => {
                    const isSelected = editTechId === t.id;
                    const load = workloadMap?.[t.id] ?? 0;
                    return (
                      <TouchableOpacity
                        key={t.id}
                        style={[styles.techChip, isSelected && styles.techChipActive]}
                        onPress={() => setEditTechId(t.id)}
                      >
                        <Text style={[styles.techChipText, isSelected && styles.techChipTextActive]}>
                          {t.fullName} ({load} iş)
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </ScrollView>
              <View style={[styles.confirmActions, { padding: 20, borderTopWidth: 1, borderTopColor: colors.surfaceBorder }]}>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setEditingTask(null)}>
                  <Text style={styles.cancelBtnText}>Vazgeç</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.confirmBtn, { backgroundColor: '#B91C1C' }, (!editDate || !editTechId || updateTaskMutation.isPending) && styles.submitPlanBtnDisabled]} 
                  onPress={() => updateTaskMutation.mutate()}
                  disabled={!editDate || !editTechId || updateTaskMutation.isPending}
                >
                  {updateTaskMutation.isPending ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.confirmBtnText}>Kaydet</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {editDatePickerVisible && (
        <DatePickerModal
          visible={true}
          value={editDate}
          onSelect={(d) => setEditDate(d)}
          onClose={() => setEditDatePickerVisible(false)}
        />
      )}
    </SafeAreaView>
  );
}

const SIDEBAR_WIDTH = 300;

const createStyles = (colors: ThemeColors, isDark: boolean) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex1: { flex: 1 },
  orb: { position: 'absolute', borderRadius: 9999 },
  orb1: { top: '-10%', left: '-10%', width: '60%', height: '40%', backgroundColor: colors.orb1 },
  orb2: { bottom: '0%', right: '-20%', width: '70%', height: '50%', backgroundColor: colors.orb2 },

  container: { flex: 1, padding: 16, maxWidth: 650, width: '100%', alignSelf: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  title: { fontSize: 24, fontWeight: '800', color: colors.text },
  subtitle: { fontSize: 13, color: colors.textSub, marginTop: 2 },
  filterBtn: { width: 42, height: 42, borderRadius: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.surfaceBorder, alignItems: 'center', justifyContent: 'center' },

  tabContainer: { flexDirection: 'row', backgroundColor: colors.inputBg, borderRadius: 12, padding: 4, marginBottom: 16 },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 8 },
  tabActive: { backgroundColor: '#B91C1C' },
  tabText: { fontSize: 12, fontWeight: '700', color: colors.textSub },
  tabTextActive: { color: '#fff' },

  controlPanel: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  dateRow: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.inputBg, borderRadius: 12, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.inputBorder },
  dateInput: { flex: 1, color: colors.text, height: 42, fontSize: 13, fontWeight: '600' },
  typeRow: { flexDirection: 'row', gap: 6 },
  typeBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.inputBorder, borderRadius: 12, paddingHorizontal: 10, height: 42, gap: 5 },
  typeBtnActive: { backgroundColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)', borderColor: colors.text },
  typeBtnText: { color: colors.textSub, fontSize: 12, fontWeight: '600' },
  typeBtnTextActive: { color: colors.text },

  chipRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.inputBorder, borderRadius: 20, paddingHorizontal: 10, height: 36 },
  chipText: { color: colors.text, fontSize: 13, maxWidth: 120 },
  searchBar: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 20, paddingHorizontal: 10, height: 36, borderWidth: 1, borderColor: colors.surfaceBorder },
  searchInput: { flex: 1, color: colors.text, fontSize: 13 },

  bulkActions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'rgba(16, 185, 129, 0.08)', borderWidth: 1, borderColor: 'rgba(16, 185, 129, 0.2)', padding: 12, borderRadius: 12, marginBottom: 10 },
  selectedCountText: { color: '#10b981', fontWeight: '800', fontSize: 13 },
  bulkBtns: { flexDirection: 'row', gap: 8 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#10b981', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, gap: 4 },
  actionBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },



  list: { paddingBottom: 90, gap: 10 },
  card: { padding: 12, flexDirection: 'column' },
  cardSelected: { borderColor: 'rgba(185, 28, 28, 0.4)', backgroundColor: colors.accentLight },
  checkArea: { padding: 8, marginRight: 6 },
  cardContent: { flex: 1, marginRight: 6 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  serviceNumber: { color: '#B91C1C', fontWeight: '800', fontSize: 13 },
  cardMain: { color: colors.text, fontSize: 15, fontWeight: '600', marginBottom: 2 },
  cardSub: { color: colors.textSub, fontSize: 12 },

  scroll: { paddingBottom: 90 },
  statsContainer: { flexDirection: 'row', gap: 12, marginBottom: 20 },
  statBox: { flex: 1, padding: 16, alignItems: 'center' },
  statLabel: { color: colors.textSub, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', marginBottom: 4 },
  statValue: { color: colors.text, fontSize: 24, fontWeight: '800' },

  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: '800', marginBottom: 12 },
  itemCard: { padding: 12, marginBottom: 8 },
  itemCardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  itemCardTitle: { color: colors.text, fontWeight: '700' },
  itemCardDesc: { color: colors.text, fontSize: 14, marginBottom: 4 },
  itemCardTech: { color: '#B91C1C', fontSize: 12, fontWeight: '600' },

  // ── Sidebar ──────────────────────────────────────────
  sidebarOverlay: { flex: 1, flexDirection: 'row', justifyContent: 'flex-end' },
  sidebarBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  sidebarPanel: { width: SIDEBAR_WIDTH, backgroundColor: colors.card, borderLeftWidth: 1, borderLeftColor: colors.surfaceBorder },
  sidebarHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: colors.surfaceBorder },
  sidebarTitle: { color: colors.text, fontSize: 18, fontWeight: '800' },
  sidebarCloseBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.inputBg, alignItems: 'center', justifyContent: 'center' },
  sidebarSearch: { flexDirection: 'row', alignItems: 'center', margin: 12, backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.surfaceBorder, borderRadius: 10, paddingHorizontal: 10, height: 42 },
  sidebarSearchInput: { flex: 1, color: colors.text, fontSize: 14 },
  sidebarHint: { fontSize: 11, color: colors.textSub, textAlign: 'center', marginBottom: 4 },
  sidebarRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: colors.surfaceBorder },
  sidebarRowActive: { borderColor: 'rgba(185, 28, 28, 0.3)', backgroundColor: colors.accentLight },
  sidebarRowTitle: { color: colors.text, fontSize: 14, fontWeight: '600' },
  sidebarRowSub: { color: colors.textSub, fontSize: 12, marginTop: 2 },
  sidebarAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#B91C1C', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  sidebarAvatarText: { color: '#fff', fontWeight: '800', fontSize: 14 },

  clearRegionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginHorizontal: 12, marginBottom: 8, padding: 10, backgroundColor: 'rgba(239,68,68,0.08)', borderRadius: 8, borderWidth: 1, borderColor: 'rgba(239,68,68,0.2)' },
  clearRegionText: { color: '#ef4444', fontSize: 13, fontWeight: '600' },

  // ── Filters Sidebar ──────────────────────────────────
  filterSectionLabel: { color: colors.textSub, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  filterDateRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.inputBg, borderRadius: 10, paddingHorizontal: 12, height: 44, borderWidth: 1, borderColor: colors.inputBorder },
  filterDateInput: { flex: 1, color: colors.text, fontSize: 14 },
  filterTypeRow: { flexDirection: 'row', gap: 10 },
  filterTypeBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.inputBorder, borderRadius: 10, height: 44 },
  filterTypeBtnActive: { backgroundColor: colors.accentLight, borderColor: colors.accent },
  filterTypeBtnText: { color: colors.textSub, fontSize: 13, fontWeight: '600' },
  filterRegionSelector: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.inputBg, borderRadius: 10, paddingHorizontal: 12, height: 44, borderWidth: 1, borderColor: colors.inputBorder },
  filterRegionText: { flex: 1, color: colors.text, fontSize: 14 },
  filterClearBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  filterClearText: { color: '#ef4444', fontSize: 12 },
  applyFiltersBtn: { backgroundColor: '#B91C1C', borderRadius: 12, height: 48, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  applyFiltersBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },

  // ── Confirm Modal ────────────────────────────────────
  confirmOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  confirmBox: { width: '100%', maxWidth: 420, backgroundColor: colors.card, borderRadius: 24, padding: 24, borderWidth: 1, borderColor: colors.surfaceBorder },
  confirmIconRow: { alignItems: 'center', marginBottom: 16 },
  confirmIconBg: { width: 60, height: 60, borderRadius: 30, backgroundColor: 'rgba(16, 185, 129, 0.15)', alignItems: 'center', justifyContent: 'center' },
  confirmTitle: { color: colors.text, fontSize: 20, fontWeight: '800', textAlign: 'center', marginBottom: 8 },
  confirmDesc: { color: colors.textSub, fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 16 },
  confirmHighlight: { color: colors.text, fontWeight: '700' },

  confirmList: { backgroundColor: colors.surface, borderRadius: 12, padding: 12, gap: 8, marginBottom: 20, borderWidth: 1, borderColor: colors.surfaceBorder },
  confirmRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  confirmRowText: { color: colors.text, fontSize: 13, flex: 1 },
  confirmMore: { color: colors.textSub, fontSize: 12, textAlign: 'center', marginTop: 4 },

  confirmActions: { flexDirection: 'row', gap: 10 },
  cancelBtn: { flex: 1, height: 46, borderRadius: 12, borderWidth: 1, borderColor: colors.inputBorder, alignItems: 'center', justifyContent: 'center' },
  cancelBtnText: { color: colors.textSub, fontWeight: '700' },
  confirmBtn: { flex: 1, height: 46, borderRadius: 12, backgroundColor: '#10b981', alignItems: 'center', justifyContent: 'center' },
  confirmBtnText: { color: '#fff', fontWeight: '800', fontSize: 14 },

  // ── Smart Preview ────────────────────────────────────
  smartPreviewInfo: { backgroundColor: colors.surface, borderRadius: 12, padding: 14, gap: 10, marginBottom: 16, borderWidth: 1, borderColor: colors.surfaceBorder },
  smartInfoRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  smartInfoText: { color: colors.textSub, fontSize: 13 },
  smartInfoValue: { color: colors.text, fontWeight: '700' },

  techPreviewList: { maxHeight: 180, marginBottom: 12 },
  techPreviewRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.surfaceBorder },
  techPreviewAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(185,28,28,0.3)', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  techPreviewInitial: { color: '#B91C1C', fontWeight: '800', fontSize: 14 },
  techPreviewName: { color: colors.text, fontSize: 13, fontWeight: '600' },
  techPreviewRegion: { color: colors.textSub, fontSize: 11 },
  techPreviewLoadBadge: { backgroundColor: colors.inputBg, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  techPreviewLoadText: { color: colors.textSub, fontSize: 11 },

  smartWarning: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: 'rgba(245,158,11,0.06)', borderRadius: 10, padding: 10, marginBottom: 16, borderWidth: 1, borderColor: 'rgba(245,158,11,0.2)' },
  smartWarningText: { color: colors.textSub, fontSize: 12, flex: 1, lineHeight: 18 },

  // ── Modal Fields & Dropdown ──────────────────────────
  modalFieldRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
  modalFieldLabelRow: { flexDirection: 'row', alignItems: 'center' },
  modalFieldLabel: { color: colors.textSub, fontSize: 13, fontWeight: '600' },
  modalFieldInput: { color: colors.text, backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.inputBorder, borderRadius: 8, paddingHorizontal: 10, height: 36, width: 150, textAlign: 'right', fontSize: 13 },
  modalTypeContainer: { flexDirection: 'row', gap: 6 },
  modalTypeBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.inputBorder },
  modalTypeBtnActive: { backgroundColor: colors.accentLight, borderColor: colors.accent },
  modalTypeBtnText: { color: colors.textSub, fontSize: 12, fontWeight: '600' },
  modalTypeBtnTextActive: { color: '#fff' },
  modalRegionSelector: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.inputBorder, borderRadius: 8, paddingHorizontal: 10, height: 36, gap: 6 },
  modalRegionSelectorText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  modalDropdown: { backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.inputBorder, marginTop: 4, padding: 4 },
  modalDropdownItem: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 6 },
  modalDropdownItemActive: { backgroundColor: colors.accentLight },
  modalDropdownItemText: { color: colors.textSub, fontSize: 13 },
  modalDropdownItemTextActive: { color: colors.text, fontWeight: '700' },
  modalFieldValue: { color: colors.text, fontSize: 13, fontWeight: '700' },

  // ── Transfer Actions in Cards ────────────────────────
  cardMainRow: { flexDirection: 'row', alignItems: 'center', width: '100%' },
  cardTechName: { color: colors.textMuted, fontSize: 11, marginTop: 4 },
  transferRow: { borderTopWidth: 1, borderTopColor: colors.divider, marginTop: 10, paddingTop: 10, width: '100%', alignItems: 'flex-end' },
  transferBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, minWidth: 120, alignItems: 'center' },
  transferBtnAtolye: { backgroundColor: '#ea580c' },
  transferBtnSaha: { backgroundColor: '#059669' },
  transferBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },

  // ── Plan Detail Screen Styles ────────────────────────
  planDetailHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  backBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.inputBg, borderColor: colors.inputBorder, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  backBtnText: { color: colors.text, fontSize: 13, fontWeight: '700', marginLeft: 4 },
  planDetailTitle: { fontSize: 18, fontWeight: '800', color: colors.text, marginLeft: 16 },

  errorContainer: { padding: 20, alignItems: 'center' },
  errorText: { color: '#ef4444', fontSize: 14, fontWeight: '600' },

  detailCard: { padding: 16, backgroundColor: colors.surface, borderStyle: 'solid' },
  detailCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.surfaceBorder, paddingBottom: 12, marginBottom: 12 },
  detailServiceNumber: { color: '#B91C1C', fontWeight: '900', fontSize: 15 },
  detailInfoSection: { marginBottom: 10 },
  detailLabel: { color: colors.textSub, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', marginBottom: 2 },
  detailValue: { color: colors.text, fontSize: 14, fontWeight: '600' },
  detailSubValue: { color: colors.textSub, fontSize: 12, marginTop: 1 },
  detailProblemBox: { backgroundColor: 'rgba(185, 28, 28, 0.05)', borderWidth: 1, borderColor: 'rgba(185, 28, 28, 0.15)', borderRadius: 10, padding: 12, marginTop: 4 },
  detailProblemTitle: { color: '#ef4444', fontSize: 12, fontWeight: '700', marginBottom: 4 },
  detailProblemText: { color: colors.text, fontSize: 13, lineHeight: 18 },

  planCard: { padding: 16, backgroundColor: colors.surface },
  planCardTitle: { color: colors.text, fontSize: 15, fontWeight: '800', marginBottom: 12 },
  planCardSubTitle: { color: colors.textSub, fontSize: 11, fontWeight: '500', marginLeft: 6 },
  planCardHeaderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  planDateRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.inputBg, borderRadius: 10, paddingHorizontal: 12, height: 42, borderWidth: 1, borderColor: colors.inputBorder },
  planDateInput: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '600', height: '100%' },

  techList: { gap: 10 },
  techRowBtn: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.surfaceBorder, borderRadius: 12, padding: 12 },
  techRowBtnActive: { borderColor: colors.accent, backgroundColor: colors.accentLight },
  techRowHeader: { flexDirection: 'row', alignItems: 'center' },
  techAvatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#B91C1C', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  techAvatarText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  techName: { color: colors.text, fontSize: 14, fontWeight: '700' },
  techRegion: { color: colors.textSub, fontSize: 12 },
  techLoadBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  loadBadgeRed: { backgroundColor: 'rgba(239, 68, 68, 0.15)' },
  loadBadgeOrange: { backgroundColor: 'rgba(245, 158, 11, 0.15)' },
  loadBadgeGreen: { backgroundColor: 'rgba(16, 185, 129, 0.15)' },
  techLoadText: { color: colors.text, fontSize: 11, fontWeight: '700' },

  submitPlanBtn: { backgroundColor: '#B91C1C', borderRadius: 12, height: 46, alignItems: 'center', justifyContent: 'center', shadowColor: '#B91C1C', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 6, elevation: 5 },
  submitPlanBtnDisabled: { backgroundColor: 'rgba(255,255,255,0.08)', shadowOpacity: 0, elevation: 0 },
  submitPlanBtnText: { color: '#fff', fontWeight: '800', fontSize: 14 },

  installStatsCard: { padding: 14, borderWidth: 1, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statsComplete: { backgroundColor: 'rgba(16, 185, 129, 0.06)', borderColor: 'rgba(16, 185, 129, 0.2)' },
  statsPartial: { backgroundColor: 'rgba(245, 158, 11, 0.06)', borderColor: 'rgba(245, 158, 11, 0.2)' },
  statsEmpty: { backgroundColor: 'rgba(59, 130, 246, 0.06)', borderColor: 'rgba(59, 130, 246, 0.2)' },
  installStatsRow: { flexDirection: 'row', alignItems: 'center', flex: 1, justifyContent: 'space-around' },
  installStatItem: { alignItems: 'center' },
  installStatValue: { color: colors.text, fontSize: 18, fontWeight: '800' },
  installStatLabel: { color: colors.textSub, fontSize: 10, fontWeight: '600', marginTop: 2 },
  installStatDivider: { width: 1, height: 24, backgroundColor: colors.divider },
  transferSahaBtn: { backgroundColor: '#10b981', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, shadowColor: '#10b981', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.25, shadowRadius: 4, elevation: 3 },
  transferSahaBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },

  inputLabel: { color: colors.textSub, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', marginTop: 10, marginBottom: 6 },
  planQtyInput: { color: colors.text, backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.inputBorder, borderRadius: 10, paddingHorizontal: 12, height: 42, fontSize: 14, fontWeight: '600', marginBottom: 10 },
  planNotesInput: { color: colors.text, backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.inputBorder, borderRadius: 10, paddingHorizontal: 12, paddingTop: 10, fontSize: 14, fontWeight: '600', minHeight: 60, textAlignVertical: 'top', marginBottom: 10 },
  techSelectionBox: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  techChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.surfaceBorder },
  techChipActive: { backgroundColor: colors.accentLight, borderColor: colors.accent },
  techChipText: { color: colors.textSub, fontSize: 12, fontWeight: '600' },
  techChipTextActive: { color: colors.text, fontWeight: '700' },

  historyList: { gap: 10 },
  historyItem: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.surfaceBorder, borderRadius: 12, padding: 12 },
  historyHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  historyTechName: { color: colors.text, fontSize: 13, fontWeight: '700' },
  historyStatusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  historyStatusText: { fontSize: 10, fontWeight: '800' },
  historyDetails: { flexDirection: 'row', gap: 16, marginBottom: 4 },
  historyDetailText: { color: colors.textSub, fontSize: 12 },
  historyNotes: { color: colors.textSub, fontSize: 11, fontStyle: 'italic', marginBottom: 10 },
  deferBtn: { backgroundColor: 'rgba(239, 68, 68, 0.08)', borderWidth: 1, borderColor: 'rgba(239, 68, 68, 0.2)', paddingVertical: 6, borderRadius: 8, alignItems: 'center' },
  deferBtnText: { color: '#ef4444', fontSize: 11, fontWeight: '700' },
  emptyText: { color: colors.textMuted, textAlign: 'center', paddingVertical: 16 },

  cardActionsRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.divider, marginTop: 10, paddingTop: 10, justifyContent: 'flex-end' },
  cardPlanBtn: { backgroundColor: '#B91C1C', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, alignItems: 'center', minWidth: 100 },
  cardPlanBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  cardDoubleActions: { flexDirection: 'row', gap: 8, width: '100%', justifyContent: 'flex-end' },
  cardContinueBtn: { backgroundColor: '#2563eb', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, alignItems: 'center', flex: 1 },
  cardContinueBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  cardTransferBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, alignItems: 'center', flex: 1 },
  cardTransferAtolye: { backgroundColor: '#ea580c' },
  cardTransferSaha: { backgroundColor: '#059669' },
  cardTransferText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  addressHighlightBox: {
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.2)',
    borderRadius: 10,
    padding: 10,
    marginBottom: 12,
  },
  addressHighlightText: {
    color: '#fca5a5',
    fontSize: 13,
    lineHeight: 18,
  },
});

