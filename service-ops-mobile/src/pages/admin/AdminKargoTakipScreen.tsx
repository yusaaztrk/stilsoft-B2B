import React, { useEffect, useState, useMemo } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Alert
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, UserCheck, RefreshCw, X, ChevronRight, Package, Calendar, Info, Check, CheckCircle, Truck, Clock } from 'lucide-react-native';
import { apiJson } from '../../shared/api/client';
import { useThemeColors, useThemeStore, type ThemeColors } from '../../shared/theme/store';
import Card from '../../components/ui/Card';
import Badge, { BadgeType } from '../../components/ui/Badge';
import Spinner from '../../components/ui/Spinner';
import EmptyState from '../../components/ui/EmptyState';
import { useSignalR } from '../../shared/hooks/useSignalR';

type CargoStatus = 0 | 1 | 2 | 3 | 4;
const statusMap: Record<CargoStatus, { label: string; type: BadgeType; color: string }> = {
  0: { label: 'Siparişiniz Alındı', type: 'neutral', color: '#3b82f6' },
  1: { label: 'Planlandı', type: 'info', color: '#6366f1' },
  2: { label: 'Hazırlanıyor', type: 'warning', color: '#f59e0b' },
  3: { label: 'Dağıtımda', type: 'warning', color: '#f97316' },
  4: { label: 'Teslim Edildi', type: 'success', color: '#10b981' },
};

interface CargoTask {
  id: string;
  orderNumber: string;
  productDetails: string;
  customerName: string;
  deliveryAddress: string;
  orderDate: string;
  assignedTechnicianId: string | null;
  assignedTechnicianName: string | null;
  status: CargoStatus;
  plannedDate?: string;
  historyJson?: string;
}

interface OrderDetailLine {
  productId: string;
  tenantCode: string;
  productName: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

interface EcommerceOrderDetail {
  id: string;
  orderNo: string;
  customerName: string;
  email: string;
  phone: string;
  address: string;
  status: string;
  paymentStatus: string;
  total: number;
  couponCode?: string;
  discountAmount: number;
  createdAtUtc: string;
  lines: OrderDetailLine[];
}

interface CombinedCargoDetail {
  cargo: CargoTask;
  order?: EcommerceOrderDetail;
}

interface TechnicianDto {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
}

export default function AdminKargoTakipScreen() {
  const colors = useThemeColors();
  const theme = useThemeStore((s) => s.theme);
  const isDark = theme === 'dark';
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);
  const qc = useQueryClient();
  const modalBg = isDark ? '#121212' : '#ffffff';

  // Real-time sync: update list instantly when cargo changes anywhere
  useSignalR(['cargo_updated']);

  const [activeTab, setActiveTab] = useState<'bekleyen' | 'aktif'>('bekleyen');
  const [q, setQ] = useState('');

  // Assign modal state
  const [assigningTask, setAssigningTask] = useState<CargoTask | null>(null);
  const [selectedTechId, setSelectedTechId] = useState<string>('');
  const [selectedTechName, setSelectedTechName] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<string>('');

  // Status modal state
  const [statusUpdatingTask, setStatusUpdatingTask] = useState<CargoTask | null>(null);
  const [statusValue, setStatusValue] = useState<number>(1);
  const [statusNote, setStatusNote] = useState<string>('');

  const openStatusUpdateModal = (task: CargoTask) => {
    setStatusUpdatingTask(task);
    setStatusValue(task.status);
    setStatusNote('');
  };

  // Detail Modal state
  const [infoOpen, setInfoOpen] = useState(false);
  const [infoLoading, setInfoLoading] = useState(false);
  const [infoData, setInfoData] = useState<CombinedCargoDetail | null>(null);

  // Queries
  const cargoQuery = useQuery<CargoTask[]>({
    queryKey: ['admin-cargos'],
    queryFn: () => apiJson<CargoTask[]>('/api/cargotracking'),
  });

  const techsQuery = useQuery<TechnicianDto[]>({
    queryKey: ['admin-cargo-techs'],
    queryFn: () => apiJson<TechnicianDto[]>('/api/technicians?role=Kargo'),
  });

  // Mutations
  const assignMutation = useMutation({
    mutationFn: async ({ taskId, techId, techName, plannedDate }: { taskId: string; techId: string; techName: string; plannedDate: string }) => {
      return await apiJson(`/api/cargotracking/${taskId}/assign`, {
        method: 'PUT',
        body: JSON.stringify({
          technicianId: techId,
          technicianName: techName,
          plannedDate: new Date(plannedDate).toISOString()
        }),
        headers: { 'Content-Type': 'application/json' },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-cargos'] });
      setAssigningTask(null);
      setSelectedTechId('');
      setSelectedTechName('');
      setSelectedDate('');
      Alert.alert('Başarılı', 'Kurye ve planlanan tarih başarıyla kaydedildi.');
    },
    onError: (err: any) => {
      Alert.alert('Hata', err?.message || 'Atama işlemi başarısız oldu.');
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ taskId, status, detail }: { taskId: string; status: number; detail?: string }) => {
      return await apiJson(`/api/cargotracking/${taskId}/status`, {
        method: 'PUT',
        body: JSON.stringify({
          status,
          actor: 'Admin',
          detail: detail || undefined
        }),
        headers: { 'Content-Type': 'application/json' },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-cargos'] });
      setStatusUpdatingTask(null);
      Alert.alert('Başarılı', 'Kargo durumu güncellendi.');
    },
    onError: (err: any) => {
      Alert.alert('Hata', err?.message || 'Durum güncelleme başarısız oldu.');
    },
  });

  const handleRefresh = async () => {
    await Promise.all([
      cargoQuery.refetch(),
      techsQuery.refetch(),
    ]);
  };

  const openAssignModal = (task: CargoTask) => {
    setAssigningTask(task);
    setSelectedTechId(task.assignedTechnicianId || '');
    setSelectedTechName(task.assignedTechnicianName || '');
    setSelectedDate(task.plannedDate ? task.plannedDate.substring(0, 10) : new Date().toISOString().substring(0, 10));
  };

  const openInfo = async (id: string) => {
    setInfoOpen(true);
    setInfoLoading(true);
    setInfoData(null);
    try {
      const data = await apiJson<CombinedCargoDetail>(`/api/cargotracking/${id}/details`);
      setInfoData(data);
    } catch (err) {
      console.error('Error fetching details', err);
    } finally {
      setInfoLoading(false);
    }
  };

  const filteredTasks = useMemo(() => {
    const all = cargoQuery.data ?? [];
    
    // Tab filter
    const tabFiltered = all.filter(t => {
      if (activeTab === 'bekleyen') {
        return t.status === 0;
      } else {
        return t.status === 1 || t.status === 2 || t.status === 3 || t.status === 4;
      }
    });

    if (!q.trim()) return tabFiltered;
    const s = q.toLowerCase();
    return tabFiltered.filter(
      (t) =>
        t.orderNumber?.toLowerCase().includes(s) ||
        t.customerName?.toLowerCase().includes(s) ||
        t.productDetails?.toLowerCase().includes(s)
    );
  }, [cargoQuery.data, activeTab, q]);

  const parseHistory = (jsonStr?: string): any[] => {
    if (!jsonStr) return [];
    try {
      const parsed = JSON.parse(jsonStr);
      if (Array.isArray(parsed)) {
        return parsed.map((item: any) => ({
          status: item.status !== undefined ? item.status : item.Status,
          statusLabel: item.statusLabel !== undefined ? item.statusLabel : item.StatusLabel,
          timestamp: item.timestamp !== undefined ? item.timestamp : item.Timestamp,
          actor: item.actor !== undefined ? item.actor : item.Actor,
          detail: item.detail !== undefined ? item.detail : item.Detail
        }));
      }
      return [];
    } catch {
      return [];
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={[styles.orb, styles.orb1]} />
      <View style={[styles.orb, styles.orb2]} />

      <View style={styles.container}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Kargo Takibi</Text>
            <Text style={styles.subtitle}>E-ticaret siparişleri kargo durum yönetimi</Text>
          </View>
          <TouchableOpacity style={styles.refreshBtn} onPress={handleRefresh} disabled={cargoQuery.isFetching}>
            {cargoQuery.isFetching ? (
              <ActivityIndicator size="small" color="#B91C1C" />
            ) : (
              <RefreshCw color={colors.textSub} size={18} />
            )}
          </TouchableOpacity>
        </View>

        {/* Tabs */}
        <View style={styles.tabContainer}>
          <TouchableOpacity
            style={[styles.tabButton, activeTab === 'bekleyen' && styles.tabButtonActive]}
            onPress={() => setActiveTab('bekleyen')}
          >
            <Text style={[styles.tabButtonText, activeTab === 'bekleyen' && styles.tabButtonTextActive]}>
              KARGO BEKLEYEN
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabButton, activeTab === 'aktif' && styles.tabButtonActive]}
            onPress={() => setActiveTab('aktif')}
          >
            <Text style={[styles.tabButtonText, activeTab === 'aktif' && styles.tabButtonTextActive]}>
              KARGO AKTİF
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.searchBar}>
          <Search color={colors.textSub} size={16} style={{ marginRight: 8 }} />
          <TextInput
            style={styles.searchInput}
            value={q}
            onChangeText={setQ}
            placeholder="Sipariş No veya Müşteri Ara..."
            placeholderTextColor={colors.textMuted}
          />
        </View>

        {cargoQuery.isLoading ? (
          <Spinner style={{ marginTop: 40 }} />
        ) : filteredTasks.length === 0 ? (
          <EmptyState message="Bu sekmeye ait kargo kaydı bulunamadı." />
        ) : (
          <FlatList
            data={filteredTasks}
            keyExtractor={(item) => item.id}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.list}
            refreshing={false}
            onRefresh={handleRefresh}
            renderItem={({ item }) => {
              const statusInfo = statusMap[item.status] || { label: 'Bilinmiyor', type: 'neutral' };
              return (
                <Card style={styles.card}>
                  {/* Touchable zone for details screen */}
                  <View style={styles.cardMain}>
                    <View style={styles.cardHeader}>
                      <View style={styles.orderBadge}>
                        <Text style={styles.orderNoText}>{item.orderNumber}</Text>
                      </View>
                      <Badge label={statusInfo.label} type={statusInfo.type} />
                    </View>

                    <View style={styles.cardBody}>
                      <Text style={styles.customerName}>{item.customerName}</Text>
                      <Text style={styles.address}>📍 {item.deliveryAddress}</Text>
                      <Text style={styles.products}>📦 {item.productDetails}</Text>
                      
                      <View style={styles.dateRow}>
                        <Calendar color={colors.textMuted} size={14} style={{ marginRight: 6 }} />
                        <Text style={styles.dateText}>
                          Sipariş Tarihi: {item.orderDate ? new Date(item.orderDate).toLocaleDateString('tr-TR') : '-'}
                        </Text>
                      </View>

                      {item.plannedDate && (
                        <View style={styles.dateRow}>
                          <Clock color={colors.textMuted} size={14} style={{ marginRight: 6 }} />
                          <Text style={styles.dateText}>
                            Planlanan Teslimat: {new Date(item.plannedDate).toLocaleDateString('tr-TR')}
                          </Text>
                        </View>
                      )}
                    </View>
                  </View>

                  {/* Actions bar */}
                  <View style={styles.actionsBar}>
                    <View style={styles.techCol}>
                      <Text style={styles.techLabel}>Kurye/Teknisyen:</Text>
                      <Text style={styles.techValText}>{item.assignedTechnicianName || 'Atanmamış'}</Text>
                    </View>

                    <View style={styles.buttonsRow}>
                      <TouchableOpacity
                        style={styles.infoBtn}
                        onPress={() => openInfo(item.id)}
                      >
                        <Info color="#3b82f6" size={16} />
                      </TouchableOpacity>

                      {activeTab === 'bekleyen' && item.status === 0 && (
                        <TouchableOpacity
                          style={styles.assignBtn}
                          onPress={() => openAssignModal(item)}
                        >
                          <UserCheck color="#fff" size={14} style={{ marginRight: 4 }} />
                          <Text style={styles.btnText}>{item.assignedTechnicianId ? 'Planı Güncelle' : 'Ata'}</Text>
                        </TouchableOpacity>
                      )}

                      {activeTab === 'bekleyen' && item.status === 0 && item.assignedTechnicianId !== null && (
                        <TouchableOpacity
                          style={styles.approveBtn}
                          onPress={() => updateStatusMutation.mutate({
                            taskId: item.id,
                            status: 1,
                            detail: 'Kargo planlandı, sahaya aktarıldı.'
                          })}
                        >
                          <Truck color="#fff" size={14} style={{ marginRight: 4 }} />
                          <Text style={styles.btnText}>Sahaya Aktar</Text>
                        </TouchableOpacity>
                      )}

                      {activeTab === 'aktif' && (
                        <TouchableOpacity
                          style={styles.statusChangeBtn}
                          onPress={() => openStatusUpdateModal(item)}
                        >
                          <Text style={styles.btnText}>Durum Güncelle</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                </Card>
              );
            }}
          />
        )}
      </View>

      {/* ── Assign Courier/Date Modal ───────────────────── */}
      <Modal visible={!!assigningTask} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: modalBg }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Kurye & Tarih Planla</Text>
              <TouchableOpacity onPress={() => setAssigningTask(null)}>
                <X color={colors.text} size={22} />
              </TouchableOpacity>
            </View>

            <View style={styles.formGroup}>
              <Text style={[styles.formLabel, { color: colors.textSub }]}>PLANLANAN TARİH (YYYY-MM-DD)</Text>
              <TextInput
                style={styles.formInput}
                value={selectedDate}
                onChangeText={setSelectedDate}
                placeholder="Örn: 2026-06-15"
                placeholderTextColor={colors.placeholder}
              />
            </View>

            <Text style={[styles.formLabel, { color: colors.textSub, marginTop: 12, marginBottom: 8 }]}>KURYE SEÇİNİZ</Text>

            {techsQuery.isLoading ? (
              <ActivityIndicator size="large" color="#B91C1C" style={{ marginVertical: 30 }} />
            ) : (techsQuery.data ?? []).length === 0 ? (
              <Text style={[styles.emptyText, { marginVertical: 30 }]}>"Kargo" rolünde teknisyen bulunamadı.</Text>
            ) : (
              <ScrollView style={styles.techListScroll} keyboardShouldPersistTaps="handled">
                {(techsQuery.data ?? []).map((tech) => {
                  const isSelected = selectedTechId === tech.id;
                  return (
                    <TouchableOpacity
                      key={tech.id}
                      style={[
                        styles.techRowItem,
                        { borderBottomColor: colors.inputBorder },
                        isSelected && styles.techRowItemActive
                      ]}
                      onPress={() => {
                        setSelectedTechId(tech.id);
                        setSelectedTechName(`${tech.firstName} ${tech.lastName}`);
                      }}
                    >
                      <View style={styles.techAvatar}>
                        <Text style={styles.techAvatarText}>{tech.firstName[0]}</Text>
                      </View>
                      <Text style={[styles.techNameText, { color: colors.text }, isSelected && { fontWeight: '800', color: '#B91C1C' }]}>
                        {tech.firstName} {tech.lastName}
                      </Text>
                      {isSelected && <CheckCircle color="#B91C1C" size={16} />}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}

            <TouchableOpacity
              style={[styles.saveBtn, (!selectedTechId || !selectedDate) && styles.saveBtnDisabled]}
              disabled={!selectedTechId || !selectedDate || assignMutation.isPending}
              onPress={() => assignMutation.mutate({
                taskId: assigningTask!.id,
                techId: selectedTechId,
                techName: selectedTechName,
                plannedDate: selectedDate
              })}
            >
              <Text style={styles.saveBtnText}>{assignMutation.isPending ? 'Kaydediliyor...' : 'Planlamayı Kaydet'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Update Status Modal ─────────────────────────── */}
      <Modal visible={!!statusUpdatingTask} transparent animationType="slide" onRequestClose={() => setStatusUpdatingTask(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: modalBg }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Durum Güncelle</Text>
              <TouchableOpacity onPress={() => setStatusUpdatingTask(null)}>
                <X color={colors.text} size={22} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={[styles.formLabel, { color: colors.textSub, marginBottom: 4 }]}>SİPARİŞ NO</Text>
              <Text style={{ color: colors.text, fontSize: 15, fontWeight: '700', marginBottom: 16 }}>{statusUpdatingTask?.orderNumber}</Text>
              
              <Text style={[styles.formLabel, { color: colors.textSub, marginBottom: 8 }]}>YENİ DURUM</Text>
              {([1, 2, 3, 4] as const).map((statusVal) => {
                const isSelected = statusValue === statusVal;
                const labels: Record<number, string> = { 1: 'Planlandı', 2: 'Hazırlanıyor', 3: 'Dağıtımda', 4: 'Teslim Edildi' };
                return (
                  <TouchableOpacity
                    key={statusVal}
                    style={[
                      { paddingHorizontal: 14, paddingVertical: 12, borderRadius: 10, marginBottom: 6, borderWidth: 1 },
                      isSelected
                        ? { backgroundColor: '#B91C1C', borderColor: '#B91C1C' }
                        : { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)', borderColor: colors.inputBorder }
                    ]}
                    onPress={() => setStatusValue(statusVal)}
                  >
                    <Text style={{ fontSize: 14, fontWeight: '600', color: isSelected ? '#fff' : colors.text }}>
                      {labels[statusVal]}
                    </Text>
                  </TouchableOpacity>
                );
              })}

              <Text style={[styles.formLabel, { color: colors.textSub, marginTop: 16, marginBottom: 8 }]}>İŞLEM NOTU (OPSİYONEL)</Text>
              <TextInput
                style={{ backgroundColor: colors.inputBg, borderRadius: 12, padding: 12, color: colors.text, fontSize: 13, minHeight: 80, textAlignVertical: 'top', marginBottom: 16, borderWidth: 1, borderColor: colors.inputBorder }}
                value={statusNote}
                onChangeText={setStatusNote}
                placeholder="Yapılan işlem, ek bilgi veya not..."
                placeholderTextColor={colors.placeholder}
                multiline
              />

              <TouchableOpacity
                style={[styles.saveBtn, updateStatusMutation.isPending && styles.saveBtnDisabled]}
                disabled={updateStatusMutation.isPending}
                onPress={() =>
                  updateStatusMutation.mutate({
                    taskId: statusUpdatingTask!.id,
                    status: statusValue,
                    detail: statusNote || undefined
                  })
                }
              >
                <Text style={styles.saveBtnText}>
                  {updateStatusMutation.isPending ? 'Kaydediliyor...' : 'Durumu Kaydet'}
                </Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── Details & Timeline Modal ────────────────────── */}
      <Modal visible={infoOpen} transparent animationType="fade" onRequestClose={() => setInfoOpen(false)}>
        <View style={styles.infoModalOverlay}>
          <View style={[styles.infoModalContent, { backgroundColor: modalBg, borderColor: colors.inputBorder }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Kargo Detay & Çizelge</Text>
              <TouchableOpacity onPress={() => setInfoOpen(false)}>
                <X color={colors.text} size={22} />
              </TouchableOpacity>
            </View>

            {infoLoading ? (
              <Spinner style={{ marginVertical: 40 }} />
            ) : !infoData ? (
              <Text style={{ color: '#ef4444', fontSize: 13, textAlign: 'center', marginVertical: 20 }}>Bilgi yüklenemedi.</Text>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={styles.infoGrid}>
                  <View style={styles.gridColHalf}>
                    <Text style={[styles.gridLabel, { color: colors.textSub }]}>SİPARİŞ NO</Text>
                    <Text style={[styles.gridVal, { color: colors.text }]}>{infoData.cargo.orderNumber}</Text>
                  </View>
                  <View style={styles.gridColHalf}>
                    <Text style={[styles.gridLabel, { color: colors.textSub }]}>DURUM</Text>
                    <Text style={[styles.gridVal, { color: colors.text, fontWeight: '700' }]}>
                      {statusMap[infoData.cargo.status]?.label || 'Bilinmiyor'}
                    </Text>
                  </View>
                  <View style={styles.gridColHalf}>
                    <Text style={[styles.gridLabel, { color: colors.textSub }]}>MÜŞTERİ</Text>
                    <Text style={[styles.gridVal, { color: colors.text }]}>{infoData.cargo.customerName}</Text>
                  </View>
                  <View style={styles.gridColHalf}>
                    <Text style={[styles.gridLabel, { color: colors.textSub }]}>TELEFON</Text>
                    <Text style={[styles.gridVal, { color: colors.text }]}>{infoData.order?.phone || '-'}</Text>
                  </View>
                  <View style={styles.gridColFull}>
                    <Text style={[styles.gridLabel, { color: colors.textSub }]}>TESLİMAT ADRESİ</Text>
                    <Text style={[styles.gridVal, { color: colors.text }]}>{infoData.cargo.deliveryAddress}</Text>
                  </View>
                  <View style={styles.gridColHalf}>
                    <Text style={[styles.gridLabel, { color: colors.textSub }]}>ATANAN KURYE</Text>
                    <Text style={[styles.gridVal, { color: '#B91C1C', fontWeight: '700' }]}>
                      {infoData.cargo.assignedTechnicianName || 'Atanmamış'}
                    </Text>
                  </View>
                  <View style={styles.gridColHalf}>
                    <Text style={[styles.gridLabel, { color: colors.textSub }]}>PLANLANAN TESLİMAT</Text>
                    <Text style={[styles.gridVal, { color: colors.text }]}>
                      {infoData.cargo.plannedDate ? new Date(infoData.cargo.plannedDate).toLocaleDateString('tr-TR') : 'Planlanmamış'}
                    </Text>
                  </View>
                </View>

                {/* E-Commerce details */}
                {infoData.order ? (
                  <View style={[styles.orderSection, { borderColor: colors.inputBorder }]}>
                    <Text style={[styles.sectionTitle, { color: colors.text }]}>Sipariş Kalemleri</Text>
                    {infoData.order.lines.map((line, idx) => (
                      <View key={idx} style={[styles.orderLine, { borderBottomColor: colors.divider }]}>
                        <View style={{ flex: 1, marginRight: 8 }}>
                          <Text style={[styles.orderLineName, { color: colors.text }]}>{line.productName}</Text>
                          <Text style={{ fontSize: 11, color: colors.textSub }}>{line.quantity} adet x ₺{line.unitPrice.toLocaleString('tr-TR')}</Text>
                        </View>
                        <Text style={[styles.orderLineTotal, { color: colors.text }]}>₺{line.lineTotal.toLocaleString('tr-TR')}</Text>
                      </View>
                    ))}
                    <View style={styles.orderSummaryRow}>
                      <Text style={[styles.orderSummaryLabel, { color: colors.textSub }]}>Genel Toplam</Text>
                      <Text style={[styles.orderSummaryVal, { color: colors.text }]}>₺{infoData.order.total.toLocaleString('tr-TR')}</Text>
                    </View>
                  </View>
                ) : (
                  <View style={styles.warningBox}>
                    <Text style={styles.warningText}>⚠ E-ticaret sipariş detayları yüklenemedi.</Text>
                  </View>
                )}

                {/* History timeline */}
                <Text style={[styles.sectionTitle, { color: colors.text, marginTop: 16, marginBottom: 8 }]}>Sevkiyat Günlüğü</Text>
                {parseHistory(infoData.cargo.historyJson).length === 0 ? (
                  <Text style={{ color: colors.textSub, fontSize: 12, fontStyle: 'italic' }}>Kayıtlı işlem geçmişi bulunmamaktadır.</Text>
                ) : (
                  <View style={{ gap: 8, paddingBottom: 20 }}>
                    {parseHistory(infoData.cargo.historyJson).map((entry, idx) => (
                      <View key={idx} style={[styles.timelineItem, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder }]}>
                        <View style={styles.timelineItemHeader}>
                          <Text style={[styles.timelineStatus, { color: colors.text }]}>{entry.statusLabel}</Text>
                          <Text style={{ fontSize: 10, color: colors.textMuted }}>
                            {new Date(entry.timestamp).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })}
                          </Text>
                        </View>
                        {entry.detail && <Text style={{ fontSize: 12, color: colors.textSub, marginTop: 4 }}>{entry.detail}</Text>}
                        <Text style={{ fontSize: 10, color: colors.textMuted, marginTop: 4, fontStyle: 'italic' }}>Aktör: {entry.actor}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const createStyles = (colors: ThemeColors, isDark: boolean) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },
    orb: { position: 'absolute', borderRadius: 9999 },
    orb1: { top: '-10%', left: '-10%', width: '60%', height: '40%', backgroundColor: colors.orb1 },
    orb2: { bottom: '0%', right: '-20%', width: '70%', height: '50%', backgroundColor: colors.orb2 },

    container: { flex: 1, padding: 16, maxWidth: 650, width: '100%', alignSelf: 'center' },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
    title: { fontSize: 24, fontWeight: '800', color: colors.text, letterSpacing: -0.5 },
    subtitle: { fontSize: 13, color: colors.textSub, marginTop: 2 },
    refreshBtn: { width: 42, height: 42, borderRadius: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.surfaceBorder, alignItems: 'center', justifyContent: 'center' },

    tabContainer: { flexDirection: 'row', backgroundColor: colors.inputBg, borderRadius: 12, padding: 4, marginBottom: 12, borderWidth: 1, borderColor: colors.inputBorder },
    tabButton: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 8 },
    tabButtonActive: { backgroundColor: '#B91C1C' },
    tabButtonText: { fontSize: 11, fontWeight: '700', color: isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.45)' },
    tabButtonTextActive: { color: '#fff' },

    searchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.inputBg, borderRadius: 12, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.inputBorder, marginBottom: 16, height: 44 },
    searchInput: { flex: 1, color: colors.text, fontSize: 14 },

    list: { paddingBottom: 24, gap: 12 },
    card: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.surfaceBorder, padding: 0, overflow: 'hidden' },
    cardMain: { padding: 16 },
    cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
    orderBadge: { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
    orderNoText: { fontSize: 14, fontWeight: '800', color: colors.text },

    cardBody: { gap: 6 },
    customerName: { fontSize: 16, fontWeight: '700', color: colors.text },
    address: { fontSize: 13, color: colors.textSub },
    products: { fontSize: 13, color: colors.textSub },
    dateRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
    dateText: { fontSize: 12, color: colors.textMuted },

    actionsBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)', paddingHorizontal: 16, paddingBottom: 14, paddingTop: 10 },
    techCol: { flex: 1, marginRight: 8 },
    techLabel: { fontSize: 10, color: colors.textSub, fontWeight: '600' },
    techValText: { fontSize: 13, fontWeight: '700', color: colors.text, marginTop: 1 },

    buttonsRow: { flexDirection: 'row', gap: 6, alignItems: 'center' },
    infoBtn: { padding: 8, backgroundColor: 'rgba(59,130,246,0.1)', borderRadius: 8 },
    assignBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#2563EB', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
    approveBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#10B981', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
    statusChangeBtn: { backgroundColor: '#B91C1C', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
    btnText: { color: '#fff', fontSize: 11, fontWeight: '800' },

    // Modals
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
    modalContent: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 50, maxHeight: '80%' },
    modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
    modalTitle: { fontSize: 18, fontWeight: '800' },

    formGroup: { gap: 6 },
    formLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
    formInput: { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, borderWidth: 1, borderRadius: 12, height: 46, paddingHorizontal: 12, color: colors.text, fontSize: 14 },

    techListScroll: { gap: 4, maxHeight: 250 },
    techRowItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, gap: 12 },
    techRowItemActive: { backgroundColor: 'rgba(185,28,28,0.05)' },
    techAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#B91C1C', alignItems: 'center', justifyContent: 'center' },
    techAvatarText: { color: '#fff', fontSize: 16, fontWeight: '800' },
    techNameText: { flex: 1, fontSize: 15, fontWeight: '600' },

    saveBtn: { backgroundColor: '#B91C1C', height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 16 },
    saveBtnDisabled: { opacity: 0.5 },
    saveBtnText: { color: '#fff', fontSize: 14, fontWeight: '800' },

    statusOptionsList: { gap: 4, paddingBottom: 20 },
    statusOptionItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 16, borderBottomWidth: 1 },
    statusOptionItemActive: { backgroundColor: 'rgba(185,28,28,0.05)' },
    statusOptionText: { fontSize: 15, fontWeight: '600' },

    emptyText: { color: colors.textMuted, textAlign: 'center', fontSize: 14 },

    // Details Modal
    infoModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 16 },
    infoModalContent: { borderRadius: 18, padding: 18, maxHeight: '90%', borderWidth: 1 },
    infoGrid: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 16, gap: 12 },
    gridColHalf: { width: '47%' },
    gridColFull: { width: '100%' },
    gridLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1 },
    gridVal: { fontSize: 13, fontWeight: '600', marginTop: 2 },

    orderSection: { borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 8 },
    sectionTitle: { fontSize: 12, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
    orderLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1 },
    orderLineName: { fontSize: 12, fontWeight: '700' },
    orderLineTotal: { fontSize: 12, fontWeight: '800' },
    orderSummaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
    orderSummaryLabel: { fontSize: 12, fontWeight: '700' },
    orderSummaryVal: { fontSize: 14, fontWeight: '800' },

    warningBox: { backgroundColor: 'rgba(245,158,11,0.08)', borderRadius: 10, padding: 10, marginTop: 8 },
    warningText: { color: '#d97706', fontSize: 12, fontWeight: '600' },

    timelineItem: { borderWidth: 1, borderRadius: 10, padding: 10 },
    timelineItemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    timelineStatus: { fontSize: 12, fontWeight: '800' }
  });
