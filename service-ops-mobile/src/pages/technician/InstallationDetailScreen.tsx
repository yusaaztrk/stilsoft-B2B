import React, { useState } from 'react';
import {
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Image,
  Alert,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute, useNavigation } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InstallationStackParamList } from '../../app/InstallationStack';
import { fetchInstallationTasks, updateInstallationTaskStatus, InstallationTaskDto } from './installationsApi';
import { uploadServiceRecordPhoto, uploadInstallationTaskPhoto, deleteServiceRecord } from './serviceRecordsApi';
import { ArrowLeft, CheckCircle, Clock, XCircle, AlertTriangle, AlertCircle, X, Check, Camera, FileText } from 'lucide-react-native';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import ImageSlider from '../../components/ui/ImageSlider';
import Card from '../../components/ui/Card';
import Badge, { BadgeType } from '../../components/ui/Badge';
import Spinner from '../../components/ui/Spinner';
import { useSessionStore } from '../../shared/session/store';
import { fetchTechnicians } from '../admin/techniciansApi';
import DatePickerModal from '../../components/ui/DatePickerModal';
import { useThemeColors, useThemeStore, type ThemeColors } from '../../shared/theme/store';
import { useMemo } from 'react';
import { API_BASE_URL } from '../../shared/config';

type StatusOpt = {
  value: string;
  label: string;
  icon: React.ReactNode;
  badgeType: BadgeType;
  color: string;
  bg: string;
};

const STATUS_OPTIONS: StatusOpt[] = [
  { value: 'Planned', label: 'Planlandı', icon: <Clock color="#60A5FA" size={20} />, badgeType: 'info', color: '#60A5FA', bg: 'rgba(96, 165, 250, 0.1)' },
  { value: 'InProgress', label: 'Devam Ediyor', icon: <AlertCircle color="#F59E0B" size={20} />, badgeType: 'warning', color: '#F59E0B', bg: 'rgba(245, 158, 11, 0.1)' },
  { value: 'Completed', label: 'Gerçekleşti', icon: <CheckCircle color="#10B981" size={20} />, badgeType: 'success', color: '#10B981', bg: 'rgba(16, 185, 129, 0.1)' },
  { value: 'Deferred', label: 'Ertelendi', icon: <AlertTriangle color="#F97316" size={20} />, badgeType: 'neutral', color: '#F97316', bg: 'rgba(249, 115, 22, 0.1)' },
  { value: 'Cancelled', label: 'İptal', icon: <XCircle color="#EF4444" size={20} />, badgeType: 'error', color: '#EF4444', bg: 'rgba(239, 68, 68, 0.1)' },
];

export default function InstallationDetailScreen() {
  const colors = useThemeColors();
  const theme = useThemeStore((s) => s.theme);
  const isDark = theme === 'dark';
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);

  const navigation = useNavigation<NativeStackNavigationProp<InstallationStackParamList>>();
  const route = useRoute<RouteProp<InstallationStackParamList, 'InstallationDetail'>>();
  const { serviceId } = route.params;
  const qc = useQueryClient();

  const [uploadingTaskId, setUploadingTaskId] = useState<string | null>(null);

  const handleTakePhotoForTask = (taskId: string) => {
    launchCamera({
      mediaType: 'photo',
      quality: 0.8,
    }, async (response) => {
      if (response.didCancel) return;
      if (response.errorMessage) {
        Alert.alert('Hata', response.errorMessage);
        return;
      }
      const asset = response.assets?.[0];
      if (asset && asset.uri) {
        setUploadingTaskId(taskId);
        try {
          await uploadInstallationTaskPhoto(taskId, asset.uri, asset.fileName || 'photo.jpg', asset.type || 'image/jpeg');
          await qc.invalidateQueries({ queryKey: ['installations', 'tasks', serviceId] });
        } catch (err: any) {
          Alert.alert('Hata', err.message || 'Yükleme başarısız');
        } finally {
          setUploadingTaskId(null);
        }
      }
    });
  };

  const handleSelectPhotoForTask = (taskId: string) => {
    launchImageLibrary({
      mediaType: 'photo',
      quality: 0.8,
      selectionLimit: 0,
    }, async (response) => {
      if (response.didCancel) return;
      if (response.errorMessage) {
        Alert.alert('Hata', response.errorMessage);
        return;
      }
      if (response.assets && response.assets.length > 0) {
        setUploadingTaskId(taskId);
        try {
          for (const asset of response.assets) {
            if (asset.uri) {
              await uploadInstallationTaskPhoto(taskId, asset.uri, asset.fileName || 'photo.jpg', asset.type || 'image/jpeg');
            }
          }
          await qc.invalidateQueries({ queryKey: ['installations', 'tasks', serviceId] });
        } catch (err: any) {
          Alert.alert('Hata', err.message || 'Yükleme başarısız');
        } finally {
          setUploadingTaskId(null);
        }
      }
    });
  };

  const role = useSessionStore((s) => s.role);
  const isAdmin = role === 'Admin' || role === 'SuperAdmin';

  const [selectedTask, setSelectedTask] = useState<InstallationTaskDto | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState('Planned');
  const [reasonNote, setReasonNote] = useState('');
  const [customAddress, setCustomAddress] = useState('');
  const [assignedTechnicianId, setAssignedTechnicianId] = useState<string | null>(null);
  const [plannedAt, setPlannedAt] = useState<string | null>(null);
  const [datePickerVisible, setDatePickerVisible] = useState(false);

  const tasksQuery = useQuery({
    queryKey: ['installations', 'tasks', serviceId],
    queryFn: ({ signal }) => fetchInstallationTasks(serviceId, signal),
  });

  const techsQuery = useQuery({
    queryKey: ['technicians'],
    queryFn: ({ signal }) => fetchTechnicians(undefined, signal),
    enabled: isAdmin,
  });

  const updateMutation = useMutation({
    mutationFn: async ({
      taskId,
      status,
      reason,
      assignedTechnicianId: techId,
      plannedAt: plannedDate,
      customAddress: addr,
    }: {
      taskId: string;
      status: string;
      reason?: string;
      assignedTechnicianId?: string | null;
      plannedAt?: string | null;
      customAddress?: string | null;
    }) => {
      return await updateInstallationTaskStatus(taskId, {
        status,
        reason: reason ?? null,
        assignedTechnicianId: techId,
        plannedAt: plannedDate,
        customAddress: addr,
      });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['installations', 'tasks', serviceId] });
      setModalVisible(false);
    },
  });

  const openActionModal = (task: InstallationTaskDto) => {
    setSelectedTask(task);
    setSelectedStatus(task.status ?? 'Planned');
    setReasonNote(task.notes ?? '');
    setCustomAddress(task.customAddress ?? '');
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
      customAddress: customAddress.trim() || undefined,
    });
  };

  const getStatusInfo = (statusVal: string | number) => {
    let statusStr = String(statusVal ?? 'Planned');
    if (statusStr === '0') statusStr = 'Planned';
    else if (statusStr === '1') statusStr = 'InProgress';
    else if (statusStr === '2') statusStr = 'Completed';
    else if (statusStr === '3') statusStr = 'Cancelled';
    else if (statusStr === '4') statusStr = 'Deferred';
    return STATUS_OPTIONS.find(s => s.value === statusStr) || STATUS_OPTIONS[0];
  };

  const renderTask = ({ item, index }: { item: InstallationTaskDto; index: number }) => {
    const isDone = item.status === 'Completed' || item.status === 'Done';
    const statusInfo = getStatusInfo(item.status ?? 'Planned');

    return (
      <TouchableOpacity onPress={() => openActionModal(item)}>
        <Card style={[styles.taskCard, isDone && styles.taskCardDone]}>
          <View style={styles.taskHeader}>
            <View style={styles.taskTitleRow}>
              {statusInfo.icon}
              <Text style={[styles.taskTitle, isDone && styles.taskTitleDone]}>
                Kalem #{index + 1} - {item.title || 'İsimsiz Kalem'}
              </Text>
            </View>
            <Badge label={statusInfo.label} type={statusInfo.badgeType} />
          </View>

          {!!item.description && (
            <Text style={styles.taskDesc}>{item.description}</Text>
          )}
          
          {!!item.customAddress && (
            <View style={[styles.noteBox, { borderLeftColor: '#10B981' }]}>
              <Text style={styles.noteText}>📍 Atama Adresi: {item.customAddress}</Text>
            </View>
          )}
          
          {!!item.notes && (
            <View style={styles.noteBox}>
              <Text style={styles.noteText}>📝 Not: {item.notes}</Text>
            </View>
          )}

          {/* Item-by-item Photo Section */}
          <View style={{ marginLeft: 28, marginTop: 8, marginBottom: 12 }}>
            {(() => {
              const urls = item.photoUrl ? item.photoUrl.split(',').filter(Boolean) : [];
              if (uploadingTaskId === item.id) {
                return (
                  <View style={{ paddingVertical: 12, alignItems: 'center', justifyContent: 'center' }}>
                    <Spinner size="small" />
                    <Text style={{ fontSize: 11, color: colors.textSub, marginTop: 6 }}>Yükleniyor...</Text>
                  </View>
                );
              }
 
              if (urls.length > 0) {
                return (
                  <View style={{ gap: 8 }}>
                    <Text style={{ fontSize: 11, fontWeight: '700', color: colors.textSub }}>Kalem Fotoğrafları:</Text>
                    <ImageSlider urls={urls} imageStyle={{ height: 140 }} />
                    <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                      <TouchableOpacity
                        style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(239, 68, 68, 0.1)', paddingVertical: 8, borderRadius: 8, gap: 4 }}
                        onPress={() => handleTakePhotoForTask(item.id)}
                      >
                        <Camera color="#EF4444" size={14} />
                        <Text style={{ color: '#EF4444', fontSize: 11, fontWeight: '700' }}>Yeni Çek</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.inputBorder, paddingVertical: 8, borderRadius: 8, gap: 4 }}
                        onPress={() => handleSelectPhotoForTask(item.id)}
                      >
                        <FileText color={colors.text} size={14} />
                        <Text style={{ color: colors.text, fontSize: 11, fontWeight: '700' }}>Galeriden Seç</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              }
 
              return (
                <View style={{ gap: 6 }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: colors.textSub }}>Belge / Fotoğraf Ekle:</Text>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TouchableOpacity
                      style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.inputBorder, paddingVertical: 10, borderRadius: 8, gap: 4 }}
                      onPress={() => handleTakePhotoForTask(item.id)}
                    >
                      <Camera color={colors.text} size={14} />
                      <Text style={{ color: colors.text, fontSize: 11, fontWeight: '700' }}>Fotoğraf Çek</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.inputBorder, paddingVertical: 10, borderRadius: 8, gap: 4 }}
                      onPress={() => handleSelectPhotoForTask(item.id)}
                    >
                      <FileText color={colors.text} size={14} />
                      <Text style={{ color: colors.text, fontSize: 11, fontWeight: '700' }}>Galeriden Seç</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })()}
          </View>

          <View style={styles.taskFooter}>
            <View>
              <Text style={styles.dateText}>
                {item.plannedAt ? `Planlanan: ${new Date(item.plannedAt).toLocaleDateString('tr-TR')}` : 'Planlanmamış'}
              </Text>
              {!!item.technicianName && (
                <Text style={[styles.dateText, { marginTop: 4, color: 'rgb(147, 197, 253)', fontWeight: '700' }]}>
                  Atanan: {item.technicianName}
                </Text>
              )}
            </View>
            <Text style={styles.quantityText}>
               Miktar: {item.quantity ?? 1}
            </Text>
          </View>
        </Card>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      {/* Decorative Orbs */}
      <View style={[styles.orb, styles.orb1]} />
      <View style={[styles.orb, styles.orb2]} />

      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <ArrowLeft color="#fff" size={24} />
        </TouchableOpacity>
        <View style={styles.headerTitleRow}>
          <Text style={styles.title}>Montaj Kalemleri</Text>
          <Text style={styles.subtitle}>Montaj yapılacak ürünlerin kontrol listesi</Text>
        </View>
      </View>

      <View style={styles.container}>
        <Card style={styles.infoBox}>
          <TouchableOpacity 
            style={styles.detailLink}
            onPress={() => navigation.navigate('ServiceRecordDetail', { serviceId })}
          >
            <Text style={styles.detailLinkText}>Tüm Servis Detayını Gör</Text>
          </TouchableOpacity>
        </Card>

        {tasksQuery.isLoading ? (
          <Spinner style={styles.loader} />
        ) : tasksQuery.isError ? (
          <Text style={styles.error}>
            {tasksQuery.error instanceof Error ? tasksQuery.error.message : 'Bilinmeyen hata'}
          </Text>
        ) : (
          <FlatList
            data={tasksQuery.data ?? []}
            keyExtractor={t => t.id}
            renderItem={({ item, index }) => renderTask({ item, index })}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.list}
            ListEmptyComponent={() => (
              <Text style={styles.emptyText}>Bu montaja ait kalem bulunmuyor.</Text>
            )}
          />
        )}
      </View>

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
              {STATUS_OPTIONS.map(opt => (
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

            <Text style={styles.inputLabel}>Atama Adresi (Opsiyonel)</Text>
            <TextInput
              style={styles.textArea}
              value={customAddress}
              onChangeText={setCustomAddress}
              placeholder="Atama adresi girin..."
              placeholderTextColor={colors.placeholder}
              multiline
              textAlignVertical="top"
            />

            <Text style={styles.inputLabel}>Not (Opsiyonel)</Text>
            <TextInput
              style={styles.textArea}
              value={reasonNote}
              onChangeText={setReasonNote}
              placeholder="Not girin..."
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

            {isAdmin && (
              <TouchableOpacity 
                style={[
                  styles.submitBtn, 
                  { 
                    backgroundColor: 'rgba(239, 68, 68, 0.08)', 
                    borderWidth: 1, 
                    borderColor: 'rgba(239, 68, 68, 0.2)',
                    marginTop: 10
                  }
                ]}
                onPress={() => {
                  Alert.alert(
                    'Kayıt Sil',
                    `Bu montaj kaydını silmek istediğinize emin misiniz?`,
                    [
                      { text: 'Vazgeç', style: 'cancel' },
                      {
                        text: 'Sil',
                        style: 'destructive',
                        onPress: async () => {
                          try {
                            await deleteServiceRecord(serviceId);
                            Alert.alert('Başarılı', 'Montaj kaydı başarıyla silindi.');
                            setModalVisible(false);
                            navigation.goBack();
                          } catch (err: any) {
                            Alert.alert('Hata', err.message || 'Kayıt silinemedi.');
                          }
                        }
                      }
                    ]
                  );
                }}
                disabled={updateMutation.isPending}
              >
                <Text style={[styles.submitBtnText, { color: '#ef4444' }]}>Kayıt Sil</Text>
              </TouchableOpacity>
            )}

          </Pressable>
        </Pressable>
      </Modal>

      <DatePickerModal
        visible={datePickerVisible}
        value={plannedAt ?? undefined}
        onSelect={(dateIso) => setPlannedAt(dateIso)}
        onClose={() => setDatePickerVisible(false)}
      />

    </SafeAreaView>
  );
}

const createStyles = (colors: ThemeColors, isDark: boolean) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  orb: { position: 'absolute', borderRadius: 9999 },
  orb1: { top: '-10%', left: '-10%', width: '60%', height: '40%', backgroundColor: colors.orb1 },
  orb2: { bottom: '0%', right: '-20%', width: '70%', height: '50%', backgroundColor: colors.orb2 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.inputBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  headerTitleRow: { flex: 1 },
  title: { fontSize: 22, fontWeight: '900', color: colors.text, letterSpacing: -0.5 },
  subtitle: { fontSize: 13, color: colors.textSub, marginTop: 2 },

  container: { flex: 1, padding: 16, maxWidth: 650, width: '100%', alignSelf: 'center' },
  
  infoBox: {
    marginBottom: 20,
  },
  infoLabel: { fontSize: 12, color: colors.textSub, textTransform: 'uppercase', fontWeight: '700' },
  infoValue: { fontSize: 15, color: colors.text, fontWeight: '700', marginTop: 4, marginBottom: 12, letterSpacing: 0.5 },
  detailLink: { alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 12, backgroundColor: 'rgba(59, 130, 246, 0.1)', borderRadius: 6 },
  detailLinkText: { color: 'rgb(96, 165, 250)', fontSize: 12, fontWeight: '700' },

  loader: { marginTop: 40 },
  error: { color: '#ef4444', textAlign: 'center', marginTop: 40 },
  list: { paddingBottom: 40, gap: 12 },
  emptyText: { color: colors.textSub, textAlign: 'center', marginTop: 40 },

  taskCard: {
    marginBottom: 12,
  },
  taskCardDone: {
    backgroundColor: 'rgba(16, 185, 129, 0.03)',
    borderColor: 'rgba(16, 185, 129, 0.2)',
  },
  taskHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  taskTitleRow: { flexDirection: 'row', alignItems: 'center', flex: 1, paddingRight: 8 },
  taskTitle: { fontSize: 16, fontWeight: '700', color: colors.text, flexShrink: 1, marginLeft: 8 },
  taskTitleDone: { color: colors.textMuted, textDecorationLine: 'line-through' },

  taskDesc: { fontSize: 13, color: colors.textSub, marginLeft: 28, marginBottom: 12 },
  
  noteBox: {
    backgroundColor: colors.surface,
    padding: 8,
    borderRadius: 8,
    marginLeft: 28,
    marginBottom: 12,
    borderLeftWidth: 2,
    borderLeftColor: colors.textMuted
  },
  noteText: { fontSize: 12, color: colors.textSub, fontStyle: 'italic' },

  taskFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginLeft: 28,
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    paddingTop: 12,
  },
  dateText: { fontSize: 12, color: colors.textSub, fontWeight: '600' },
  quantityText: { fontSize: 12, color: colors.text, fontWeight: '700' },

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
  btnSpinner: { padding: 0 },

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
  datePickerBtnText: { color: colors.text, fontSize: 14, fontWeight: '600', marginLeft: 8 },

  card: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: isDark ? 0.3 : 0.05,
    shadowRadius: 8,
    elevation: 2,
    marginTop: 16,
    marginBottom: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.inputBorder,
    paddingBottom: 10,
    marginBottom: 4,
  },
  cardTitleText: { fontSize: 16, fontWeight: '800', color: colors.text },
});
