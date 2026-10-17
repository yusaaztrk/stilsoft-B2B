import React, { useState, useMemo } from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Image,
  Alert,
  PermissionsAndroid,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RepairStackParamList } from '../../app/RepairStack';
import {
  fetchServiceRecordById,
  fetchServiceTimeline,
  updateServiceRecordStatus,
  uploadServiceRecordPhoto,
  groupMobileTimelineEvents,
} from './serviceRecordsApi';
import { useSessionStore } from '../../shared/session/store';
import { API_BASE_URL } from '../../shared/config';
import {
  ArrowLeft,
  Clock,
  User,
  MapPin,
  Box,
  Activity,
  AlertTriangle,
  X,
  Check,
  CheckCircle,
  XCircle,
  AlertCircle,
  Layers,
  Camera,
  FileText,
} from 'lucide-react-native';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import Card from '../../components/ui/Card';
import Badge, { BadgeType } from '../../components/ui/Badge';
import Spinner from '../../components/ui/Spinner';
import { useThemeColors, useThemeStore, type ThemeColors } from '../../shared/theme/store';
import { getStatusLabel, getStatusBadgeType } from '../../shared/utils/statusTranslator';

type StatusOpt = {
  value: string;
  label: string;
  icon: React.ReactNode;
  badgeType: BadgeType;
  color: string;
  bg: string;
};

const STATUS_OPTIONS: StatusOpt[] = [
  { value: 'Planned', label: 'Planlandı', icon: <Clock color="#60A5FA" size={18} />, badgeType: 'info', color: '#60A5FA', bg: 'rgba(96, 165, 250, 0.1)' },
  { value: 'Workshop', label: 'Atölyede', icon: <Layers color="#8B5CF6" size={18} />, badgeType: 'neutral', color: '#8B5CF6', bg: 'rgba(139, 92, 246, 0.1)' },
  { value: 'InRepair', label: 'Tamirde', icon: <Activity color="#F59E0B" size={18} />, badgeType: 'warning', color: '#F59E0B', bg: 'rgba(245, 158, 11, 0.1)' },
  { value: 'WaitingForParts', label: 'Parça Bekliyor', icon: <AlertTriangle color="#EF4444" size={18} />, badgeType: 'error', color: '#EF4444', bg: 'rgba(239, 68, 68, 0.1)' },
  { value: 'Ready', label: 'Hazır', icon: <CheckCircle color="#10B981" size={18} />, badgeType: 'success', color: '#10B981', bg: 'rgba(16, 185, 129, 0.1)' },
  { value: 'Delivered', label: 'Teslim Edildi', icon: <CheckCircle color="#10B981" size={18} />, badgeType: 'success', color: '#10B981', bg: 'rgba(16, 185, 129, 0.1)' },
  { value: 'Cancelled', label: 'İptal', icon: <XCircle color="#EF4444" size={18} />, badgeType: 'error', color: '#EF4444', bg: 'rgba(239, 68, 68, 0.1)' },
];

export default function RepairDetailScreen() {
  const colors = useThemeColors();
  const theme = useThemeStore((s) => s.theme);
  const isDark = theme === 'dark';
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);

  const navigation = useNavigation<NativeStackNavigationProp<RepairStackParamList>>();
  const route = useRoute<RouteProp<RepairStackParamList, 'RepairDetail'>>();
  const { serviceId } = route.params;

  const technicianId = useSessionStore((s) => s.technicianId);
  const qc = useQueryClient();

  const [modalVisible, setModalVisible] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState('InRepair');
  const [notes, setNotes] = useState('');

  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoName, setPhotoName] = useState<string>('');
  const [photoType, setPhotoType] = useState<string>('');
  const [uploading, setUploading] = useState(false);

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
        setPhotoUri(asset.uri);
        setPhotoName(asset.fileName || 'photo.jpg');
        setPhotoType(asset.type || 'image/jpeg');
      }
    });
  };

  const handleSelectPhoto = () => {
    launchImageLibrary({
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
        setPhotoUri(asset.uri);
        setPhotoName(asset.fileName || 'photo.jpg');
        setPhotoType(asset.type || 'image/jpeg');
      }
    });
  };

  const handleUploadPhoto = async () => {
    if (!photoUri) return;
    setUploading(true);
    try {
      await uploadServiceRecordPhoto(serviceId, photoUri, photoName, photoType);
      setPhotoUri(null);
      await qc.invalidateQueries({ queryKey: ['servicerecords', 'detail', serviceId] });
      await qc.invalidateQueries({ queryKey: ['servicerecords', 'timeline', serviceId] });
    } catch (err: any) {
      Alert.alert('Hata', err.message || 'Yükleme başarısız');
    } finally {
      setUploading(false);
    }
  };

  const detailQuery = useQuery({
    queryKey: ['servicerecords', 'detail', serviceId],
    queryFn: ({ signal }) => fetchServiceRecordById(serviceId, signal),
  });

  const timelineQuery = useQuery({
    queryKey: ['servicerecords', 'timeline', serviceId],
    queryFn: ({ signal }) => fetchServiceTimeline(serviceId, signal),
  });

  const updateMutation = useMutation({
    mutationFn: async () =>
      updateServiceRecordStatus(serviceId, {
        status: selectedStatus,
        notes: notes.trim() || null,
        performedByTechnicianId: technicianId ?? null,
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['servicerecords', 'detail', serviceId] });
      await qc.invalidateQueries({ queryKey: ['servicerecords', 'timeline', serviceId] });
      await qc.invalidateQueries({ queryKey: ['servicerecords', 'paged', 'repair'] });
      setModalVisible(false);
      setNotes('');
    },
  });

  const data = detailQuery.data;
  const rawTimeline = timelineQuery.data ?? [];
  const timeline = useMemo(() => groupMobileTimelineEvents(rawTimeline), [rawTimeline]);

  const getStatusInfo = (statusStr: string): { label: string; badgeType: BadgeType; color?: string; bg?: string } => {
    const opt = STATUS_OPTIONS.find((s) => s.value.toLowerCase() === (statusStr ?? '').toLowerCase());
    if (opt) {
      return { label: opt.label, badgeType: opt.badgeType, color: opt.color, bg: opt.bg };
    }
    return {
      label: getStatusLabel(statusStr, data?.statusLabel),
      badgeType: getStatusBadgeType(statusStr),
    };
  };

  const handleOpenModal = () => {
    if (data) {
      setSelectedStatus(data.status);
      setModalVisible(true);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={[styles.orb, styles.orb1]} />
      <View style={[styles.orb, styles.orb2]} />

      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <ArrowLeft color={colors.text} size={24} />
        </TouchableOpacity>
        <View style={styles.headerTitleRow}>
          <Text style={styles.title}>Arıza Detay</Text>
          <Text style={styles.subtitle}>{data?.serviceNumber ?? 'Yükleniyor...'}</Text>
        </View>
      </View>

      {detailQuery.isLoading ? (
        <Spinner fullScreen />
      ) : detailQuery.isError ? (
        <View style={styles.centerContainer}>
          <AlertCircle color="#ef4444" size={48} />
          <Text style={styles.errorText}>
            Hata: {detailQuery.error instanceof Error ? detailQuery.error.message : 'Bilinmeyen hata'}
          </Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => detailQuery.refetch()}>
            <Text style={styles.retryBtnText}>Tekrar Dene</Text>
          </TouchableOpacity>
        </View>
      ) : data ? (
        <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
          
          <Card style={styles.infoBox}>
            <Text style={styles.infoLabel}>Kayıt Durumu</Text>
            <View style={styles.statusBadgeRow}>
              <Badge label={getStatusInfo(data.status).label} type={getStatusInfo(data.status).badgeType} />
            </View>

            <View style={styles.actionBtnRow}>
              <TouchableOpacity
                style={styles.detailLink}
                onPress={() => navigation.navigate('ServiceRecordDetail', { serviceId })}
              >
                <Text style={styles.detailLinkText}>Tüm Servis Detayını Gör</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.updateStatusBtn} onPress={handleOpenModal}>
                <Text style={styles.updateStatusBtnText}>Durumu Güncelle</Text>
              </TouchableOpacity>
            </View>
          </Card>

          <Card style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitleText}>Arıza Detayları</Text>
            </View>

            <View style={styles.row}>
              <User color={colors.textMuted} size={16} style={{ marginTop: 2 }} />
              <View>
                <Text style={styles.rowLabel}>Müşteri</Text>
                <Text style={styles.rowValue}>{data.customerName || 'Müşteri Belirtilmemiş'}</Text>
              </View>
            </View>

            <View style={styles.row}>
              <Box color={colors.textMuted} size={16} style={{ marginTop: 2 }} />
              <View>
                <Text style={styles.rowLabel}>Cihaz / Ürün</Text>
                <Text style={styles.rowValue}>{data.productName || 'Ürün Belirtilmemiş'}</Text>
              </View>
            </View>

            {data.customerAddress ? (
              <View style={styles.row}>
                <MapPin color={colors.textMuted} size={16} style={{ marginTop: 2 }} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowLabel}>Adres</Text>
                  <Text style={styles.rowValue} numberOfLines={2}>{data.customerAddress}</Text>
                </View>
              </View>
            ) : null}
          </Card>

          <Card style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitleText}>Durum Geçmişi</Text>
              <Activity color={colors.textMuted} size={18} />
            </View>

            {timelineQuery.isLoading ? (
              <Spinner style={styles.timelineLoader} />
            ) : timeline.length === 0 ? (
              <Text style={styles.emptyTimelineText}>Geçmiş kaydı bulunmuyor.</Text>
            ) : (
              <View style={styles.timelineContainer}>
                {timeline.map((item, idx) => (
                  <View key={item.id || idx} style={styles.timelineItem}>
                    <View style={styles.timelineDotContainer}>
                      <View style={styles.timelineDot} />
                      {idx < timeline.length - 1 && <View style={styles.timelineLine} />}
                    </View>
                    <View style={styles.timelineContent}>
                      <View style={styles.timelineHeader}>
                        <Text style={styles.timelineAction}>{item.action}</Text>
                        <Text style={styles.timelineDate}>
                          {item.createdAt ? new Date(item.createdAt).toLocaleString('tr-TR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : ''}
                        </Text>
                      </View>
                      <Text style={{ fontSize: 9, color: '#ff6b6b', marginVertical: 2 }}>
                        Debug URL: {item.photoUrl ? (item.photoUrl.startsWith('http') ? item.photoUrl : `${API_BASE_URL}${item.photoUrl}`) : 'NULL/EMPTY'}
                      </Text>
                      {item.type === 'FaultUpdate' ? (
                        <View style={{ gap: 4 }}>
                          {/* 1. Görsel */}
                          {item.photoUrl ? (
                            <Image
                              source={{ uri: item.photoUrl.startsWith('http') ? item.photoUrl : `${API_BASE_URL}${item.photoUrl}` }}
                              style={{ width: '100%', height: 160, borderRadius: 8, marginVertical: 4 }}
                              resizeMode="cover"
                            />
                          ) : null}
                          {/* 2. Durum Değişikliği */}
                          {item.statusText ? (
                            <Text style={{ fontSize: 12, color: colors.text, fontWeight: '600' }}>{item.statusText}</Text>
                          ) : null}
                          {/* 3. İşlem Notu */}
                          {item.note ? (
                            <Text style={{ fontSize: 12, color: colors.textSub, fontStyle: 'italic', marginTop: 2 }}>Not: "{item.note}"</Text>
                          ) : null}
                        </View>
                      ) : (
                        <View style={{ gap: 4 }}>
                          {item.photoUrl ? (
                            <Image
                              source={{ uri: item.photoUrl.startsWith('http') ? item.photoUrl : `${API_BASE_URL}${item.photoUrl}` }}
                              style={{ width: '100%', height: 160, borderRadius: 8, marginVertical: 4 }}
                              resizeMode="cover"
                            />
                          ) : null}
                          {item.notes ? (
                            <Text style={styles.timelineNotes}>{item.notes}</Text>
                          ) : null}
                        </View>
                      )}
                      {item.performedBy ? (
                        <Text style={styles.timelinePerformer}>Kullanıcı: {item.performedBy}</Text>
                      ) : null}
                    </View>
                  </View>
                ))}
              </View>
            )}
          </Card>

          {/* Photo Upload Card */}
          <Card style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitleText}>Saha Belgesi / Fotoğraf Yükle</Text>
              <Camera color={colors.textMuted} size={18} />
            </View>

            <Text style={{ fontSize: 12, color: colors.textSub, lineHeight: 18, marginBottom: 8 }}>
              Köy/saha ziyaretlerinde internet çekmiyorsa, fotoğrafı telefon kameranızla çekip daha sonra buradan galeriyi kullanarak yükleyebilirsiniz.
            </Text>

            {!photoUri ? (
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
                <TouchableOpacity
                  style={{
                    flex: 1,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: colors.inputBg,
                    borderWidth: 1,
                    borderColor: colors.inputBorder,
                    paddingVertical: 12,
                    borderRadius: 12,
                    gap: 6
                  }}
                  onPress={handleTakePhoto}
                >
                  <Camera color={colors.text} size={16} />
                  <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>Fotoğraf Çek</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={{
                    flex: 1,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: colors.inputBg,
                    borderWidth: 1,
                    borderColor: colors.inputBorder,
                    paddingVertical: 12,
                    borderRadius: 12,
                    gap: 6
                  }}
                  onPress={handleSelectPhoto}
                >
                  <FileText color={colors.text} size={16} />
                  <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>Galeriden Seç</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={{ gap: 10, marginTop: 4 }}>
                <Image
                  source={{ uri: photoUri }}
                  style={{ width: '100%', height: 200, borderRadius: 12, backgroundColor: colors.inputBg }}
                  resizeMode="cover"
                />
                
                {uploading ? (
                  <Spinner size="small" />
                ) : (
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <TouchableOpacity
                      style={{
                        flex: 1,
                        backgroundColor: '#10b981',
                        paddingVertical: 12,
                        borderRadius: 12,
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                      onPress={handleUploadPhoto}
                    >
                      <Text style={{ color: '#fff', fontSize: 13, fontWeight: '800' }}>Gönder / Yükle</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={{
                        flex: 1,
                        backgroundColor: colors.inputBg,
                        borderWidth: 1,
                        borderColor: colors.inputBorder,
                        paddingVertical: 12,
                        borderRadius: 12,
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                      onPress={() => setPhotoUri(null)}
                    >
                      <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>Vazgeç</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            )}
          </Card>

        </ScrollView>
      ) : null}

      <Modal visible={modalVisible} transparent={true} animationType="fade" onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Cihaz Durumunu Güncelle</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <X color={colors.text} size={24} />
              </TouchableOpacity>
            </View>

            <Text style={styles.taskNamePreview}>{data?.serviceNumber} - {data?.customerName}</Text>

            <Text style={styles.inputLabel}>Yeni Durum Seçin</Text>
            <View style={styles.statusGrid}>
              {STATUS_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt.value}
                  style={[
                    styles.statusBtn,
                    selectedStatus === opt.value && { backgroundColor: opt.bg, borderColor: opt.color },
                  ]}
                  onPress={() => setSelectedStatus(opt.value)}
                >
                  {selectedStatus === opt.value && <Check color={opt.color} size={16} style={{ marginRight: 4 }} />}
                  <Text style={[styles.statusBtnText, selectedStatus === opt.value && { color: opt.color }]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.inputLabel}>İşlem Notları / Açıklama</Text>
            <TextInput
              style={styles.textArea}
              value={notes}
              onChangeText={setNotes}
              placeholder="Yapılan işlemler, takılan parçalar veya arıza sebebi..."
              placeholderTextColor={colors.textMuted}
              multiline
              textAlignVertical="top"
            />

            {updateMutation.isError && (
              <Text style={styles.modalError}>Güncelleme işlemi başarısız oldu.</Text>
            )}

            <TouchableOpacity
              style={styles.submitBtn}
              onPress={() => updateMutation.mutate()}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? (
                <Spinner size="small" color="#fff" style={styles.btnSpinner} />
              ) : (
                <Text style={styles.submitBtnText}>Değişiklikleri Kaydet</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const createStyles = (colors: ThemeColors, isDark: boolean) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  orb: { position: 'absolute', borderRadius: 9999 },
  orb1: { top: '-10%', left: '-10%', width: '60%', height: '40%', backgroundColor: isDark ? 'rgba(183, 58, 11, 0.08)' : 'rgba(183, 58, 11, 0.02)' },
  orb2: { bottom: '0%', right: '-20%', width: '70%', height: '50%', backgroundColor: isDark ? 'rgba(122, 12, 12, 0.08)' : 'rgba(122, 12, 12, 0.02)' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.inputBorder,
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
  headerTitleRow: {
    flex: 1,
  },
  title: { fontSize: 22, fontWeight: '900', color: colors.text, letterSpacing: -0.5 },
  subtitle: { fontSize: 13, color: colors.textSub, marginTop: 2 },

  container: { paddingBottom: 40, maxWidth: 650, width: '100%', alignSelf: 'center' },
  centerContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, minHeight: 300 },
  errorText: { color: 'rgb(252, 165, 165)', fontSize: 14, fontWeight: '600', marginTop: 12, textAlign: 'center' },
  retryBtn: { marginTop: 16, backgroundColor: colors.inputBg, borderColor: colors.inputBorder, borderWidth: 1, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 20 },
  retryBtnText: { color: colors.text, fontSize: 13, fontWeight: '800' },

  infoBox: {
    marginHorizontal: 16,
    marginTop: 16,
  },
  infoLabel: { fontSize: 11, color: colors.textMuted, textTransform: 'uppercase', fontWeight: '700' },
  statusBadgeRow: { marginVertical: 8 },
  
  actionBtnRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  detailLink: { flex: 1, height: 42, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.inputBg, borderRadius: 10, borderWidth: 1, borderColor: colors.inputBorder },
  detailLinkText: { color: colors.text, fontSize: 12, fontWeight: '700' },
  updateStatusBtn: { flex: 1, height: 42, justifyContent: 'center', alignItems: 'center', backgroundColor: '#B91C1C', borderRadius: 10 },
  updateStatusBtnText: { color: '#fff', fontSize: 12, fontWeight: '800' },

  card: {
    marginHorizontal: 16,
    marginTop: 16,
    gap: 12,
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

  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  rowLabel: { fontSize: 11, color: colors.textMuted, fontWeight: '700', textTransform: 'uppercase' },
  rowValue: { fontSize: 14, color: colors.text, fontWeight: '600', marginTop: 2, lineHeight: 18 },

  timelineLoader: { marginVertical: 12 },
  timelineContainer: { marginTop: 4, gap: 16 },
  timelineItem: { flexDirection: 'row', gap: 12 },
  timelineDotContainer: { alignItems: 'center' },
  timelineDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#B91C1C', marginTop: 6 },
  timelineLine: { flex: 1, width: 2, backgroundColor: colors.inputBorder, marginTop: 4 },
  timelineContent: { flex: 1, backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.inputBorder, borderRadius: 12, padding: 12, gap: 4 },
  timelineHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  timelineAction: { fontSize: 13, fontWeight: '800', color: colors.text, flex: 1 },
  timelineDate: { fontSize: 11, color: colors.textMuted },
  timelineNotes: { fontSize: 12, color: colors.textSub, fontStyle: 'italic', marginTop: 4 },
  timelinePerformer: { fontSize: 11, color: colors.textMuted, fontWeight: '600', marginTop: 2 },
  emptyTimelineText: { color: colors.textMuted, fontSize: 13, fontStyle: 'italic', paddingVertical: 12, textAlign: 'center' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, borderWidth: 1, borderColor: colors.inputBorder },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { color: colors.text, fontSize: 20, fontWeight: '800' },
  taskNamePreview: { color: colors.textSub, fontSize: 14, marginBottom: 24 },

  inputLabel: { color: colors.textSub, fontSize: 13, fontWeight: '700', marginBottom: 8, textTransform: 'uppercase' },
  statusGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 24 },
  statusBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.inputBorder, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  statusBtnText: { color: colors.textSub, fontSize: 13, fontWeight: '700' },

  textArea: { backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.inputBorder, borderRadius: 12, color: colors.text, padding: 12, minHeight: 100, marginBottom: 24, fontSize: 14 },
  modalError: { color: '#ef4444', marginBottom: 12, textAlign: 'center', fontWeight: '600' },
  submitBtn: { backgroundColor: '#B91C1C', paddingVertical: 16, borderRadius: 12, alignItems: 'center', height: 52, justifyContent: 'center' },
  submitBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  btnSpinner: { padding: 0 }
});
