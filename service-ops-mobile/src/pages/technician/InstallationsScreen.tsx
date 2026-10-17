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
  Modal,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSessionStore } from '../../shared/session/store';
import { fetchServiceRecordsPaged, PagedResult, ServiceRecord, updateServiceRecordStatus } from './serviceRecordsApi';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { InstallationStackParamList } from '../../app/InstallationStack';
import { Search, Clock, Check, X, ChevronDown, ChevronUp, Filter, MapPin, User } from 'lucide-react-native';
import { getStatusLabel, getStatusBadgeType } from '../../shared/utils/statusTranslator';
import Card from '../../components/ui/Card';
import Badge, { BadgeType } from '../../components/ui/Badge';
import Spinner from '../../components/ui/Spinner';
import { fetchInstallationTasks, updateInstallationTaskStatus, InstallationTaskDto } from './installationsApi';
import { fetchTechnicians } from '../admin/techniciansApi';
import DatePickerModal from '../../components/ui/DatePickerModal';
import { useThemeColors, useThemeStore, type ThemeColors } from '../../shared/theme/store';
import { useAutoRefetch } from '../../shared/hooks/useAutoRefetch';
import { useSignalR } from '../../shared/hooks/useSignalR';

const STATUS_MAPPING: Record<string | number, { label: string; type: BadgeType }> = {
  New: { label: 'Yeni', type: 'neutral' },
  Planned: { label: 'Planlandı', type: 'info' },
  Workshop: { label: 'Aktif / Sahada', type: 'warning' },
  Completed: { label: 'Gerçekleşti', type: 'success' },
  Cancelled: { label: 'İptal', type: 'error' },
  Deferred: { label: 'Ertelendi', type: 'neutral' },
  '0': { label: 'Planlandı', type: 'info' },
  '1': { label: 'Devam Ediyor', type: 'warning' },
  '2': { label: 'Gerçekleşti', type: 'success' },
  '3': { label: 'İptal', type: 'error' },
  '4': { label: 'Ertelendi', type: 'neutral' },
};

export default function InstallationsScreen() {
  const colors = useThemeColors();
  const theme = useThemeStore((s) => s.theme);
  const isDark = theme === 'dark';
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);

  const navigation = useNavigation<NativeStackNavigationProp<InstallationStackParamList>>();
  const technicianId = useSessionStore((s) => s.technicianId);
  const qc = useQueryClient();

  // Auto-refresh when screen gains focus + every 30s while focused (polling fallback)
  useAutoRefetch(['servicerecords', 'paged', 'installation']);
  // Real-time sync via SignalR
  useSignalR(['installation_updated', 'service_record_updated']);
  
  const [tab, setTab] = useState<'pending' | 'active'>('pending');
  const [page, setPage] = useState(1);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const pageSize = 20;

  // Filter states
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [statusModalOpen, setStatusModalOpen] = useState(false);
  const [dateFromOpen, setDateFromOpen] = useState(false);
  const [dateToOpen, setDateToOpen] = useState(false);

  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Scheduling Modal States
  const role = useSessionStore((s) => s.role);
  const isAdmin = role === 'Admin' || role === 'SuperAdmin';

  const [selectedTask, setSelectedTask] = useState<InstallationTaskDto | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState('Planned');
  const [reasonNote, setReasonNote] = useState('');
  const [assignedTechnicianId, setAssignedTechnicianId] = useState<string | null>(null);
  const [plannedAt, setPlannedAt] = useState<string | null>(null);
  const [datePickerVisible, setDatePickerVisible] = useState(false);

  const statuses = useMemo(() => {
    if (statusFilter) return statusFilter;
    return tab === 'pending'
      ? 'New,Planned'
      : 'Workshop,InRepair,WaitingForParts,Ready';
  }, [tab, statusFilter]);

  const INSTALL_STATUS_OPTS = [
    { value: '', label: 'Tüm Durumlar' },
    { value: 'New', label: 'Yeni' },
    { value: 'Planned', label: 'Planlandı' },
    { value: 'Workshop', label: 'Sahada' },
    { value: 'InRepair', label: 'İşlemde' },
    { value: 'WaitingForParts', label: 'Parça Bekliyor' },
    { value: 'Ready', label: 'Hazır' },
    { value: 'Completed', label: 'Tamamlandı' },
    { value: 'Cancelled', label: 'İptal' },
  ];

  const query = useQuery<PagedResult<ServiceRecord>>({
    queryKey: ['servicerecords', 'paged', 'installation', tab, page, technicianId, search, statuses, dateFrom, dateTo],
    queryFn: ({ signal }) =>
      fetchServiceRecordsPaged(
        {
          type: 'Installation',
          statuses,
          technicianId: technicianId ?? undefined,
          q: search || undefined,
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
          page,
          pageSize,
        },
        signal
      ),
    placeholderData: keepPreviousData,
  });

  const tasksQuery = useQuery({
    queryKey: ['installations', 'tasks', expandedId],
    queryFn: ({ signal }) => fetchInstallationTasks(expandedId!, signal),
    enabled: !!expandedId,
  });

  const techsQuery = useQuery({
    queryKey: ['technicians'],
    queryFn: ({ signal }) => fetchTechnicians(undefined, signal),
    enabled: isAdmin,
  });

  const transferMutation = useMutation({
    mutationFn: async (id: string) => {
      return await updateServiceRecordStatus(id, { status: 'Workshop', notes: 'Sahaya aktarıldı.' });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['servicerecords', 'paged', 'installation'] });
    }
  });

  const updateMutation = useMutation({
    mutationFn: async ({
      taskId,
      status,
      reason,
      assignedTechnicianId: techId,
      plannedAt: plannedDate,
    }: {
      taskId: string;
      status: string;
      reason?: string;
      assignedTechnicianId?: string | null;
      plannedAt?: string | null;
    }) => {
      return await updateInstallationTaskStatus(taskId, {
        status,
        reason: reason ?? null,
        assignedTechnicianId: techId,
        plannedAt: plannedDate,
      });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['installations', 'tasks', expandedId] });
      await qc.invalidateQueries({ queryKey: ['servicerecords', 'paged', 'installation'] });
      setModalVisible(false);
    },
  });

  const openActionModal = (task: InstallationTaskDto) => {
    setSelectedTask(task);
    setSelectedStatus(task.status ?? 'Planned');
    setReasonNote(task.notes ?? '');
    setAssignedTechnicianId(task.assignedTechnicianId ?? null);
    setPlannedAt(task.plannedAt ? task.plannedAt.split('T')[0] : null);
    setModalVisible(true);
  };

  const handleUpdate = () => {
    if (!selectedTask) return;
    updateMutation.mutate({
      taskId: selectedTask.id,
      status: selectedStatus,
      reason: reasonNote.trim() || undefined,
      assignedTechnicianId,
      plannedAt: plannedAt ? `${plannedAt}T00:00:00Z` : null,
    });
  };

  const data = query.data;
  const items = data?.items ?? [];

  const onChangeTab = (next: 'pending' | 'active') => {
    setTab(next);
    setPage(1);
  };

  const renderItem = ({ item }: { item: ServiceRecord }) => {
    const lookupKey = Object.keys(STATUS_MAPPING).find(
      (k) => k.toLowerCase() === String(item.status ?? '').toLowerCase()
    );
    const badgeInfo = lookupKey ? STATUS_MAPPING[lookupKey] : { label: getStatusLabel(item.status, item.statusLabel), type: getStatusBadgeType(item.status) };
    const isExpanded = expandedId === item.id;
    
    return (
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={() => {
          setExpandedId(prev => prev === item.id ? null : item.id);
        }}
      >
        <Card style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              {isExpanded ? <ChevronUp color="#B91C1C" size={20} /> : <ChevronDown color="rgba(255,255,255,0.4)" size={20} />}
              <Text style={styles.serviceNumber}>{item.serviceNumber}</Text>
            </View>
            <Badge label={badgeInfo.label} type={badgeInfo.type} />
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.infoText}>{item.createdAt ? new Date(item.createdAt).toLocaleDateString('tr-TR') : '-'}</Text>
            <Text style={styles.infoTextBold}>{item.dealerName || '-'}</Text>
          </View>

          <View style={styles.productBlock}>
            <Text style={styles.productName}>{item.productName}</Text>
            <Text style={styles.serialText}>{item.serialNumber ? `SN: ${item.serialNumber}` : 'Seri No Yok'}</Text>
          </View>

          {!!item.customerAddress && (
            <View style={styles.addressBlock}>
              <Text style={styles.addressText} numberOfLines={2}>
                Adres: {item.customerAddress}
              </Text>
            </View>
          )}

          <View style={styles.infoRow}>
            <Text style={styles.customerText}>{item.customerName || '-'}</Text>
            <Text style={styles.regionText}>{item.regionName || '-'}</Text>
          </View>

          <View style={styles.actionRow}>
            <View style={styles.techWrapper}>
              {item.assignedTechnicianName ? (
                <View style={styles.techBadge}>
                  <View style={styles.techAvatar}>
                    <Text style={styles.techAvatarText}>
                      {item.assignedTechnicianName.split(' ').filter(Boolean).slice(0, 2).map(n => n[0]).join('')}
                    </Text>
                  </View>
                  <Text style={styles.techName} numberOfLines={1}>{item.assignedTechnicianName}</Text>
                </View>
              ) : (
                <Text style={styles.unassignedText}>Atanmadı</Text>
              )}
            </View>

            <View style={{ flexDirection: 'row', gap: 8 }}>
              {tab === 'pending' && (item.status === 'New' || item.status === 'Planned') && (
                <TouchableOpacity 
                  style={[styles.actionBtn, { backgroundColor: '#B91C1C' }]}
                  onPress={(e) => {
                    e.stopPropagation();
                    (navigation as any).navigate('MontajPlanning', {
                      screen: 'PlanningHome',
                      params: { serviceId: item.id }
                    });
                  }}
                >
                  <Text style={styles.actionBtnText}>Planlamaya Devam Et</Text>
                </TouchableOpacity>
              )}
              {tab === 'pending' && item.status === 'Planned' && (
                <TouchableOpacity 
                  style={[styles.actionBtn, styles.actionBtnSuccess]}
                  disabled={transferMutation.isPending}
                  onPress={(e) => {
                    e.stopPropagation();
                    transferMutation.mutate(item.id);
                  }}
                >
                  {transferMutation.isPending ? (
                    <Spinner size="small" color="#fff" style={styles.btnSpinner} />
                  ) : (
                    <Text style={styles.actionBtnText}>Sahaya Aktar</Text>
                  )}
                </TouchableOpacity>
              )}
              <TouchableOpacity 
                style={styles.actionBtn}
                onPress={(e) => {
                  e.stopPropagation();
                  navigation.navigate('InstallationDetail', { serviceId: item.id });
                }}
              >
                <Text style={styles.actionBtnText}>Detay</Text>
              </TouchableOpacity>
            </View>
          </View>

          {isExpanded && (
            <View style={styles.accordionContainer} onStartShouldSetResponder={() => true}>
              <Text style={styles.accordionTitle}>Montaj Kalemleri</Text>
              {tasksQuery.isLoading ? (
                <Spinner size="small" style={{ marginVertical: 12 }} />
              ) : tasksQuery.isError ? (
                <Text style={styles.accordionError}>Kalemler yüklenemedi.</Text>
              ) : !tasksQuery.data || tasksQuery.data.length === 0 ? (
                <Text style={styles.accordionEmpty}>Kayıtlı kalem bulunamadı.</Text>
              ) : (
                <View style={styles.tasksList}>
                  {tasksQuery.data.map((task, index) => {
                    const taskLookupKey = Object.keys(STATUS_MAPPING).find(
                      (k) => k.toLowerCase() === String(task.status ?? '').toLowerCase()
                    );
                    const taskBadge = taskLookupKey ? STATUS_MAPPING[taskLookupKey] : { label: getStatusLabel(String(task.status)), type: getStatusBadgeType(String(task.status)) };
                    const hasAddress = !!(task.customAddress);
                    const hasTech = !!(task.technicianName);
                    return (
                      <View key={task.id} style={[
                        styles.taskItem,
                        !hasTech && styles.taskItemUnassigned
                      ]}>
                        <View style={styles.taskMainInfo}>
                          <View style={styles.taskTitleRow}>
                            <Text style={styles.taskTitleText}>Kalem #{index + 1}</Text>
                            {!hasTech && (
                              <View style={styles.unassignedPill}>
                                <Text style={styles.unassignedPillText}>Atanmamış</Text>
                              </View>
                            )}
                          </View>
                          {/* Assigned Technician */}
                          {hasTech ? (
                            <View style={styles.taskTechRow}>
                              <User size={12} color="rgb(147, 197, 253)" />
                              <Text style={styles.taskTechName}>{task.technicianName}</Text>
                            </View>
                          ) : (
                            <View style={styles.taskTechRow}>
                              <User size={12} color={colors.textMuted} />
                              <Text style={styles.taskTechNameMuted}>Teknisyen atanmadı</Text>
                            </View>
                          )}
                          {/* Custom Address */}
                          {hasAddress ? (
                            <View style={styles.taskAddressRow}>
                              <MapPin size={12} color="#F97316" />
                              <Text style={styles.taskAddressText} numberOfLines={2}>{task.customAddress}</Text>
                            </View>
                          ) : (
                            <View style={styles.taskAddressRow}>
                              <MapPin size={12} color={colors.textMuted} />
                              <Text style={styles.taskAddressMuted}>Adres belirtilmedi</Text>
                            </View>
                          )}
                          <View style={styles.taskMetaRow}>
                            <Text style={styles.taskMetaLabel}>Adet: {task.quantity ?? 1}</Text>
                            {task.plannedAt && (
                              <Text style={styles.taskMetaLabel}>
                                Plan: {new Date(task.plannedAt).toLocaleDateString('tr-TR')}
                              </Text>
                            )}
                          </View>
                          {!!task.notes && (
                            <Text style={styles.taskNotesText}>{task.notes}</Text>
                          )}
                        </View>
                        <View style={styles.taskActionGroup}>
                          <Badge label={taskBadge.label} type={taskBadge.type} />
                          <TouchableOpacity
                            style={styles.taskActionBtn}
                            onPress={(e) => {
                              e.stopPropagation();
                              if (tab === 'pending') {
                                (navigation as any).navigate('MontajPlanning', {
                                  screen: 'PlanningHome',
                                  params: { serviceId: item.id }
                                });
                              } else {
                                openActionModal(task);
                              }
                            }}
                          >
                            <Text style={styles.taskActionBtnText}>{tab === 'pending' ? 'Planlamaya Devam Et' : 'Düzenle'}</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          )}
        </Card>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      {/* Decorative Orbs */}
      <View style={[styles.orb, styles.orb1]} />
      <View style={[styles.orb, styles.orb2]} />

      <KeyboardAvoidingView style={styles.flex1} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.container}>
          <View style={styles.header}>
            <Text style={styles.title}>Montaj Yönetimi</Text>
            <Text style={styles.subtitle}>Montaj operasyonlarınızı buradan yönetin.</Text>
          </View>

          <View style={styles.tabContainer}>
            <TouchableOpacity
              onPress={() => onChangeTab('pending')}
              style={[styles.tab, tab === 'pending' && styles.tabActive]}
            >
              <Text style={[styles.tabText, tab === 'pending' && styles.tabTextActive]}>BEKLEYEN</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => onChangeTab('active')}
              style={[styles.tab, tab === 'active' && styles.tabActive]}
            >
              <Text style={[styles.tabText, tab === 'active' && styles.tabTextActive]}>AKTİF MONTAJLAR</Text>
            </TouchableOpacity>
          </View>

          {/* Search + Filter Bar */}
          <View style={styles.searchRow}>
            <View style={styles.searchContainer}>
              <Search size={16} color={colors.textSub} style={styles.searchIcon} />
              <TextInput
                style={styles.searchInput}
                value={search}
                onChangeText={(t) => { setSearch(t); setPage(1); }}
                placeholder="Ara: müşteri, ürün, seri no..."
                placeholderTextColor={colors.placeholder}
                returnKeyType="search"
              />
              {!!search && (
                <TouchableOpacity onPress={() => { setSearch(''); setPage(1); }}>
                  <X size={16} color={colors.textSub} />
                </TouchableOpacity>
              )}
            </View>
            <TouchableOpacity
              style={[
                styles.filterBtn,
                (filtersOpen || !!statusFilter || !!dateFrom || !!dateTo) && styles.filterBtnActive
              ]}
              onPress={() => setFiltersOpen(v => !v)}
            >
              <Filter size={18} color={(filtersOpen || !!statusFilter || !!dateFrom || !!dateTo) ? '#B91C1C' : colors.textSub} />
              {(!!statusFilter || !!dateFrom || !!dateTo) && (
                <View style={styles.filterDot} />
              )}
            </TouchableOpacity>
          </View>

          {/* Filter Panel */}
          {filtersOpen && (
            <View style={styles.filterPanel}>
              <Text style={styles.filterLabel}>Durum</Text>
              <TouchableOpacity
                style={styles.filterSelect}
                onPress={() => setStatusModalOpen(true)}
              >
                <Text style={styles.filterSelectText}>
                  {INSTALL_STATUS_OPTS.find(o => o.value === statusFilter)?.label || 'Tüm Durumlar'}
                </Text>
              </TouchableOpacity>
              <View style={styles.dateRow}>
                <View style={styles.dateField}>
                  <Text style={styles.filterLabel}>Başlangıç</Text>
                  <TouchableOpacity style={styles.filterSelect} onPress={() => setDateFromOpen(true)}>
                    <Text style={styles.filterSelectText}>{dateFrom || 'Seçin'}</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.dateField}>
                  <Text style={styles.filterLabel}>Bitiş</Text>
                  <TouchableOpacity style={styles.filterSelect} onPress={() => setDateToOpen(true)}>
                    <Text style={styles.filterSelectText}>{dateTo || 'Seçin'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
              {(!!statusFilter || !!dateFrom || !!dateTo) && (
                <TouchableOpacity
                  style={styles.clearFiltersBtn}
                  onPress={() => { setStatusFilter(''); setDateFrom(''); setDateTo(''); setPage(1); }}
                >
                  <Text style={styles.clearFiltersBtnText}>Filtreleri Temizle</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {query.isLoading && !query.data ? (
            <Spinner style={styles.loader} />
          ) : (
            <FlatList
              data={items}
              keyExtractor={(x) => x.id}
              renderItem={renderItem}
              contentContainerStyle={styles.list}
              onRefresh={() => {
                setIsRefreshing(true);
                query.refetch().finally(() => setIsRefreshing(false));
              }}
              refreshing={isRefreshing}
              ListEmptyComponent={() => (
                <Text style={styles.emptyText}>Kayıt bulunamadı.</Text>
              )}
            />
          )}

          <View style={styles.pagination}>
            <TouchableOpacity 
              style={[styles.pageBtn, page <= 1 && styles.pageBtnDisabled]}
              disabled={page <= 1}
              onPress={() => setPage(p => Math.max(1, p - 1))}
            >
              <Text style={[styles.pageBtnText, page <= 1 && styles.pageBtnTextDisabled]}>{'<'}</Text>
            </TouchableOpacity>
            
            <View style={styles.pageIndicator}>
              <Text style={styles.pageIndicatorText}>{page}</Text>
            </View>

            <TouchableOpacity 
              style={[styles.pageBtn, (data?.totalPages ? page >= data.totalPages : items.length < pageSize) && styles.pageBtnDisabled]}
              disabled={data?.totalPages ? page >= data.totalPages : items.length < pageSize}
              onPress={() => setPage(p => p + 1)}
            >
              <Text style={[styles.pageBtnText, (data?.totalPages ? page >= data.totalPages : items.length < pageSize) && styles.pageBtnTextDisabled]}>{'>'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* Action Modal */}
      <Modal visible={modalVisible} transparent={true} animationType="fade" onRequestClose={() => setModalVisible(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setModalVisible(false)}>
          <Pressable style={styles.modalContent} onPress={() => {}}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>İşlem Yap</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <X color="#fff" size={24} />
              </TouchableOpacity>
            </View>

            <Text style={styles.taskNamePreview}>{selectedTask?.title}</Text>

            <Text style={styles.inputLabel}>Durum Değiştir</Text>
            <View style={styles.statusGrid}>
              {[
                { value: 'Planned', label: 'Planlandı', color: '#60A5FA', bg: 'rgba(96, 165, 250, 0.1)' },
                { value: 'InProgress', label: 'Devam Ediyor', color: '#F59E0B', bg: 'rgba(245, 158, 11, 0.1)' },
                { value: 'Completed', label: 'Gerçekleşti', color: '#10B981', bg: 'rgba(16, 185, 129, 0.1)' },
                { value: 'Deferred', label: 'Ertelendi', color: '#F97316', bg: 'rgba(249, 115, 22, 0.1)' },
                { value: 'Cancelled', label: 'İptal', color: '#EF4444', bg: 'rgba(239, 68, 68, 0.1)' },
              ].map(opt => (
                <TouchableOpacity
                  key={opt.value}
                  style={[
                    styles.statusBtn,
                    selectedStatus === opt.value && { backgroundColor: opt.bg, borderColor: opt.color }
                  ]}
                  onPress={() => setSelectedStatus(opt.value)}
                >
                  {selectedStatus === opt.value && <Check color={opt.color} size={16} style={{marginRight: 4}}/>}
                  <Text style={[styles.statusBtnText, selectedStatus === opt.value && {color: opt.color}]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {isAdmin && (
              <>


                <Text style={styles.inputLabel}>Planlanan Tarih</Text>
                <TouchableOpacity
                  style={styles.datePickerBtn}
                  onPress={() => setDatePickerVisible(true)}
                >
                  <Clock color="#B91C1C" size={20} />
                  <Text style={styles.datePickerBtnText}>
                    {plannedAt ? new Date(plannedAt).toLocaleDateString('tr-TR') : 'Tarih Seçilmedi'}
                  </Text>
                </TouchableOpacity>
              </>
            )}

            <Text style={styles.inputLabel}>Not / Atama Adresi (Opsiyonel)</Text>
            <TextInput
              style={styles.textArea}
              value={reasonNote}
              onChangeText={setReasonNote}
              placeholder="Atama adresi veya notu girin..."
              placeholderTextColor={colors.placeholder}
              multiline
              textAlignVertical="top"
            />

            {updateMutation.isError && (
              <Text style={styles.modalError}>Güncelleme başarısız oldu.</Text>
            )}

            <TouchableOpacity 
              style={styles.submitBtn}
              onPress={handleUpdate}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? (
                <Spinner size="small" color="#fff" style={styles.btnSpinner} />
              ) : (
                <Text style={styles.submitBtnText}>Kaydet</Text>
              )}
            </TouchableOpacity>

          </Pressable>
        </Pressable>
      </Modal>

      <DatePickerModal
        visible={datePickerVisible}
        value={plannedAt ?? undefined}
        onSelect={(dateIso) => setPlannedAt(dateIso)}
        onClose={() => setDatePickerVisible(false)}
      />

      {/* Status Filter Modal */}
      <Modal visible={statusModalOpen} transparent animationType="fade" onRequestClose={() => setStatusModalOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { paddingBottom: 32 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Durum Seçin</Text>
              <TouchableOpacity onPress={() => setStatusModalOpen(false)}>
                <X color={colors.text} size={24} />
              </TouchableOpacity>
            </View>
            {INSTALL_STATUS_OPTS.map(opt => (
              <TouchableOpacity
                key={opt.value}
                style={[
                  styles.statusPickerRow,
                  statusFilter === opt.value && styles.statusPickerRowActive
                ]}
                onPress={() => {
                  setStatusFilter(opt.value);
                  setPage(1);
                  setStatusModalOpen(false);
                }}
              >
                <Text style={[
                  styles.statusPickerText,
                  statusFilter === opt.value && styles.statusPickerTextActive
                ]}>{opt.label}</Text>
                {statusFilter === opt.value && <Check size={16} color="#B91C1C" />}
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </Modal>

      <DatePickerModal
        visible={dateFromOpen}
        value={dateFrom || undefined}
        onSelect={(d) => { setDateFrom(d); setPage(1); }}
        onClose={() => setDateFromOpen(false)}
      />
      <DatePickerModal
        visible={dateToOpen}
        value={dateTo || undefined}
        onSelect={(d) => { setDateTo(d); setPage(1); }}
        onClose={() => setDateToOpen(false)}
      />
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
  header: { marginBottom: 16 },
  title: { fontSize: 28, fontWeight: '800', color: colors.text },
  subtitle: { fontSize: 14, color: colors.textSub, marginTop: 4 },
  
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: colors.inputBg,
    borderRadius: 12,
    padding: 4,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.inputBorder,
  },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 8 },
  tabActive: { backgroundColor: '#B91C1C' },
  tabText: { fontSize: 12, fontWeight: '700', color: colors.textSub },
  tabTextActive: { color: '#fff' },

  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  searchContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: 12,
    paddingHorizontal: 12,
  },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, height: 44, color: colors.text, fontSize: 14 },
  filterBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBtnActive: {
    borderColor: '#B91C1C',
    backgroundColor: 'rgba(185, 28, 28, 0.06)',
  },
  filterDot: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#B91C1C',
  },
  filterPanel: {
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  filterLabel: { color: colors.textSub, fontSize: 11, fontWeight: '700', marginBottom: 4, textTransform: 'uppercase' },
  filterSelect: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
  },
  filterSelectText: { color: colors.text, fontSize: 13 },
  dateRow: { flexDirection: 'row', gap: 8 },
  dateField: { flex: 1 },
  clearFiltersBtn: {
    alignItems: 'center',
    paddingVertical: 8,
    backgroundColor: 'rgba(185,28,28,0.08)',
    borderRadius: 8,
    marginTop: 4,
  },
  clearFiltersBtnText: { color: '#B91C1C', fontSize: 13, fontWeight: '700' },
  statusPickerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 8,
    marginBottom: 2,
  },
  statusPickerRowActive: { backgroundColor: 'rgba(185,28,28,0.08)' },
  statusPickerText: { color: colors.text, fontSize: 14 },
  statusPickerTextActive: { color: '#B91C1C', fontWeight: '700' },
  
  loader: { marginTop: 40 },
  list: { paddingBottom: 95, gap: 12 },
  emptyText: { color: colors.textSub, textAlign: 'center', marginTop: 40 },

  card: {
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  serviceNumber: { fontSize: 16, fontWeight: '800', color: '#B91C1C', letterSpacing: 0.5 },

  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  infoText: { fontSize: 12, color: colors.textSub },
  infoTextBold: { fontSize: 12, fontWeight: '700', color: colors.text },
  
  productBlock: {
    backgroundColor: colors.surface,
    padding: 10,
    borderRadius: 8,
    marginBottom: 8,
  },
  productName: { fontSize: 14, fontWeight: '700', color: colors.text },
  serialText: { fontSize: 11, color: colors.textSub, marginTop: 2 },

  customerText: { fontSize: 14, fontWeight: '700', color: colors.text },
  regionText: { fontSize: 12, color: colors.textSub },

  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    paddingTop: 12,
  },
  techWrapper: { flex: 1 },
  unassignedText: { fontSize: 12, color: colors.textMuted, fontStyle: 'italic' },
  techBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    alignSelf: 'flex-start',
    paddingRight: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.2)',
  },
  techAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  techAvatarText: { fontSize: 9, fontWeight: '800', color: 'rgb(96, 165, 250)' },
  techName: { fontSize: 11, fontWeight: '600', color: 'rgb(147, 197, 253)' },

  actionBtn: {
    backgroundColor: '#B91C1C',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    minHeight: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionBtnSuccess: {
    backgroundColor: 'rgb(5, 150, 105)',
  },
  actionBtnText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  btnSpinner: { padding: 0 },

  pagination: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    marginTop: 8,
    gap: 12,
  },
  pageBtn: {
    padding: 8,
    backgroundColor: colors.inputBg,
    borderRadius: 8,
  },
  pageBtnDisabled: { opacity: 0.3 },
  pageBtnText: { color: colors.text, fontWeight: '800' },
  pageBtnTextDisabled: { color: colors.textMuted },
  pageIndicator: {
    backgroundColor: '#B91C1C',
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageIndicatorText: { color: '#fff', fontWeight: '800', fontSize: 12 },

  addressBlock: {
    backgroundColor: colors.surface,
    padding: 8,
    borderRadius: 8,
    marginBottom: 8,
    borderLeftWidth: 2,
    borderLeftColor: '#B91C1C',
  },
  addressText: {
    color: colors.textSub,
    fontSize: 12,
    lineHeight: 16,
  },
  accordionContainer: {
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    paddingTop: 12,
  },
  accordionTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 8,
  },
  accordionError: {
    color: '#EF4444',
    fontSize: 12,
    textAlign: 'center',
    marginVertical: 8,
  },
  accordionEmpty: {
    color: colors.textSub,
    fontSize: 12,
    textAlign: 'center',
    marginVertical: 8,
  },
  tasksList: {
    gap: 8,
  },
  taskItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    backgroundColor: colors.surface,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  taskItemUnassigned: {
    borderColor: 'rgba(245,158,11,0.4)',
    backgroundColor: isDark ? 'rgba(245,158,11,0.05)' : 'rgba(254,243,199,0.5)',
  },
  taskMainInfo: {
    flex: 1,
    paddingRight: 8,
  },
  taskTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  taskTitleText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  unassignedPill: {
    backgroundColor: 'rgba(245,158,11,0.15)',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  unassignedPillText: {
    color: '#F59E0B',
    fontSize: 10,
    fontWeight: '700',
  },
  taskTechRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 3,
  },
  taskTechName: {
    color: 'rgb(147, 197, 253)',
    fontSize: 12,
    fontWeight: '600',
  },
  taskTechNameMuted: {
    color: colors.textMuted,
    fontSize: 12,
    fontStyle: 'italic',
  },
  taskAddressRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 4,
    marginBottom: 4,
    backgroundColor: isDark ? 'rgba(249,115,22,0.08)' : 'rgba(255,237,213,0.6)',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  taskAddressText: {
    color: '#F97316',
    fontSize: 11,
    fontWeight: '600',
    flex: 1,
    lineHeight: 16,
  },
  taskAddressMuted: {
    color: colors.textMuted,
    fontSize: 11,
    fontStyle: 'italic',
  },
  taskNotesText: {
    color: colors.textSub,
    fontSize: 12,
    marginTop: 4,
    fontStyle: 'italic',
  },
  taskMetaRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  taskMetaLabel: {
    color: colors.textSub,
    fontSize: 11,
  },
  taskActionGroup: {
    alignItems: 'flex-end',
    gap: 6,
  },
  taskActionBtn: {
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  taskActionBtnText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '700',
  },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { color: colors.text, fontSize: 20, fontWeight: '800' },
  taskNamePreview: { color: colors.textSub, fontSize: 14, marginBottom: 24 },

  inputLabel: { color: colors.text, fontSize: 13, fontWeight: '700', marginBottom: 8, textTransform: 'uppercase' },
  statusGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 24 },
  statusBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.inputBorder, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  statusBtnText: { color: colors.textSub, fontSize: 13, fontWeight: '700' },

  textArea: { backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.inputBorder, borderRadius: 12, color: colors.text, padding: 12, minHeight: 100, marginBottom: 24, fontSize: 14 },
  
  modalError: { color: '#ef4444', marginBottom: 12, textAlign: 'center', fontWeight: '600' },
  
  submitBtn: { backgroundColor: '#B91C1C', paddingVertical: 16, borderRadius: 12, alignItems: 'center', height: 52, justifyContent: 'center' },
  submitBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },

  techScroll: { marginVertical: 8, maxHeight: 80 },
  techScrollContent: { gap: 12, paddingHorizontal: 4, paddingBottom: 4 },
  techCard: { alignItems: 'center', width: 68 },
  techAvatarWrapper: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.inputBg, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent', marginBottom: 4 },
  techAvatarWrapperActive: { borderColor: '#B91C1C', backgroundColor: 'rgba(185, 28, 28, 0.1)' },
  techAvatarTxt: { color: colors.textSub, fontSize: 13, fontWeight: '700' },
  techAvatarTxtActive: { color: '#fff' },
  techNameTxt: { color: colors.textSub, fontSize: 11, textAlign: 'center' },
  techNameTxtActive: { color: '#fff', fontWeight: '700' },

  datePickerBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.inputBorder, borderRadius: 12, padding: 14, marginBottom: 24 },
  datePickerBtnText: { color: colors.text, fontSize: 14, fontWeight: '600', marginLeft: 8 }
});
