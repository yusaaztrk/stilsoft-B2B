import React, { useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Modal,
  TextInput,
  Image,
  ScrollView,
  Platform,
  Dimensions
} from 'react-native';
import { apiJson } from '../../shared/api/client';
import { useSessionStore } from '../../shared/session/store';
import { getAccessToken, getStoredSession } from '../../shared/session/storage';
import { API_BASE_URL } from '../../shared/config';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import Geolocation from 'react-native-geolocation-service';
import {
  Package,
  MapPin,
  Truck,
  User,
  Calendar,
  Camera,
  Image as ImageIcon,
  CheckCircle2,
  Trash2,
  X,
  Clock,
  Compass
} from 'lucide-react-native';
import { useThemeColors, useThemeStore, type ThemeColors } from '../../shared/theme/store';

const { width } = Dimensions.get('window');

interface CargoTask {
  id: string;
  orderNumber: string;
  productDetails: string;
  customerName: string;
  deliveryAddress: string;
  orderDate: string;
  assignedTechnicianId: string | null;
  status: number;
  receiverName?: string;
  deliveryProofPhotoUrl?: string;
  latitude?: number;
  longitude?: number;
}

const statusLabels: Record<number, string> = {
  0: 'Siparişiniz Alındı',
  1: 'Planlandı',
  2: 'Hazırlanıyor',
  3: 'Dağıtımda',
  4: 'Teslim Edildi'
};

const statusColors: Record<number, { bg: string; text: string }> = {
  0: { bg: '#E0F2FE', text: '#0369A1' }, // Blue
  1: { bg: '#F5F3FF', text: '#6D28D9' }, // Purple
  2: { bg: '#FEF3C7', text: '#D97706' }, // Amber
  3: { bg: '#FFEDD5', text: '#EA580C' }, // Orange
  4: { bg: '#D1FAE5', text: '#047857' }  // Green
};

async function uploadCargoProofPhoto(
  taskId: string,
  fileUri: string,
  fileName: string,
  fileType: string
): Promise<{ success: boolean; url?: string }> {
  const token = await getAccessToken();
  const session = await getStoredSession();

  const formData = new FormData();
  formData.append('file', {
    uri: Platform.OS === 'ios' ? fileUri.replace('file://', '') : fileUri,
    name: fileName || 'proof.jpg',
    type: fileType || 'image/jpeg',
  } as any);

  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (session?.tenantCode) headers['X-Tenant-Code'] = session.tenantCode;

  const res = await fetch(`${API_BASE_URL}/api/cargotracking/${encodeURIComponent(taskId)}/proof`, {
    method: 'POST',
    headers,
    body: formData,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Yükleme başarısız (${res.status})`);
  }

  return await res.json().catch(() => ({}));
}

export default function KargoTakipScreen() {
  const colors = useThemeColors();
  const theme = useThemeStore((s) => s.theme);
  const isDark = theme === 'dark';
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);

  const technicianId = useSessionStore((s) => s.technicianId);
  const username = useSessionStore((s) => s.username);
  const [tasks, setTasks] = useState<CargoTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'bekleyen' | 'aktif'>('aktif');

  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (activeTab === 'bekleyen') {
        // Show unassigned received orders (status 0)
        return t.status === 0;
      }
      if (activeTab === 'aktif') {
        // Show orders assigned to this technician (status 1, 2, 3, 4)
        return t.assignedTechnicianId === technicianId && t.status !== 0;
      }
      return false;
    });
  }, [tasks, activeTab, technicianId]);

  // Modal State
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedTask, setSelectedTask] = useState<CargoTask | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<number>(3); // Default to Dağıtımda

  // Delivery Form State
  const [receiverName, setReceiverName] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoName, setPhotoName] = useState('');
  const [photoType, setPhotoType] = useState('');

  // Location State
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationError, setLocationError] = useState(false);

  const [submitting, setSubmitting] = useState(false);

  const fetchTasks = async () => {
    setLoading(true);
    try {
      const data = await apiJson<CargoTask[]>('/api/cargotracking');
      setTasks(data || []);
    } catch (err) {
      console.error('Error fetching cargo tasks', err);
      Alert.alert('Hata', 'Kargo görevleri yüklenemedi.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
  }, []);

  const handleAssignToMe = async (task: CargoTask) => {
    if (!technicianId) {
      Alert.alert('Hata', 'Teknisyen bilgileri bulunamadı.');
      return;
    }
    setLoading(true);
    try {
      // 1. Assign to current technician
      await apiJson(`/api/cargotracking/${task.id}/assign`, {
        method: 'PUT',
        body: JSON.stringify({
          technicianId: technicianId,
          technicianName: username || 'Teknisyen',
          plannedDate: new Date().toISOString()
        }),
        headers: { 'Content-Type': 'application/json' }
      });

      // 2. Immediately transition to status 1 (Planlandı) so it goes to active list
      await apiJson(`/api/cargotracking/${task.id}/status`, {
        method: 'PUT',
        body: JSON.stringify({
          status: 1,
          actor: 'Teknisyen',
          detail: 'Kurye kendisini atadı ve sevkiyat planlandı.'
        }),
        headers: { 'Content-Type': 'application/json' }
      });

      Alert.alert('Başarılı', 'Sevkiyat teslimatı üzerinize atandı.');
      fetchTasks();
    } catch (err: any) {
      console.error('Error self-assigning cargo task:', err);
      Alert.alert('Hata', err.message || 'Atama işlemi başarısız.');
    } finally {
      setLoading(false);
    }
  };

  const fetchLocation = async () => {
    setLocationLoading(true);
    setLocationError(false);

    try {
      let hasPermission = false;
      if (Platform.OS === 'ios') {
        const auth = await Geolocation.requestAuthorization('always');
        hasPermission = auth === 'granted';
      } else {
        const { PermissionsAndroid } = require('react-native');
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
        );
        hasPermission = granted === PermissionsAndroid.RESULTS.GRANTED;
      }

      if (!hasPermission) {
        setLocationError(true);
        setLocationLoading(false);
        return;
      }

      Geolocation.getCurrentPosition(
        (position) => {
          setLatitude(position.coords.latitude);
          setLongitude(position.coords.longitude);
          setLocationLoading(false);
        },
        (error) => {
          console.warn('Geolocation error:', error);
          setLocationError(true);
          setLocationLoading(false);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
      );
    } catch (err) {
      console.warn('Location fetching exception:', err);
      setLocationError(true);
      setLocationLoading(false);
    }
  };

  const openUpdateModal = (task: CargoTask) => {
    setSelectedTask(task);
    setSelectedStatus(task.status === 2 ? 3 : task.status); // set default option to next status logical flow
    setReceiverName('');
    setPhotoUri(null);
    setPhotoName('');
    setPhotoType('');
    setLatitude(null);
    setLongitude(null);
    setLocationError(false);
    setLocationLoading(false);
    setModalVisible(true);
  };

  // Trigger location check immediately when status is set to Delivered
  useEffect(() => {
    if (selectedStatus === 4 && modalVisible) {
      fetchLocation();
    }
  }, [selectedStatus, modalVisible]);

  const handleTakePhoto = () => {
    launchCamera({ mediaType: 'photo', quality: 0.7, saveToPhotos: false }, (response) => {
      if (response.didCancel) return;
      if (response.errorMessage) {
        Alert.alert('Hata', response.errorMessage);
        return;
      }
      const asset = response.assets?.[0];
      if (asset && asset.uri) {
        setPhotoUri(asset.uri);
        setPhotoName(asset.fileName || `proof-${Date.now()}.jpg`);
        setPhotoType(asset.type || 'image/jpeg');
      }
    });
  };

  const handleChooseFromGallery = () => {
    launchImageLibrary({ mediaType: 'photo', quality: 0.7 }, (response) => {
      if (response.didCancel) return;
      if (response.errorMessage) {
        Alert.alert('Hata', response.errorMessage);
        return;
      }
      const asset = response.assets?.[0];
      if (asset && asset.uri) {
        setPhotoUri(asset.uri);
        setPhotoName(asset.fileName || `proof-${Date.now()}.jpg`);
        setPhotoType(asset.type || 'image/jpeg');
      }
    });
  };

  const submitStatusUpdate = async () => {
    if (!selectedTask) return;

    // Validate Delivered requirements
    if (selectedStatus === 4) {
      if (!receiverName.trim()) {
        Alert.alert('Eksik Bilgi', 'Teslim alan kişi adını girmelisiniz.');
        return;
      }
      if (!photoUri) {
        Alert.alert('Eksik Bilgi', 'Teslimat kanıt fotoğrafı yüklemelisiniz.');
        return;
      }
    }

    setSubmitting(true);
    try {
      let uploadedUrl: string | undefined = undefined;

      // 1. Upload proof photo if delivered
      if (selectedStatus === 4 && photoUri) {
        const uploadResult = await uploadCargoProofPhoto(selectedTask.id, photoUri, photoName, photoType);
        if (uploadResult.success && uploadResult.url) {
          uploadedUrl = uploadResult.url;
        } else {
          throw new Error('Kanıt fotoğrafı yüklenemedi.');
        }
      }

      // 2. Submit status update
      await apiJson(`/api/cargotracking/${selectedTask.id}/status`, {
        method: 'PUT',
        body: JSON.stringify({
          status: selectedStatus,
          actor: 'Teknisyen',
          detail: selectedStatus === 4 
            ? `Kargo alıcıya teslim edildi: ${receiverName}`
            : `Kargo durumu teknisyen tarafından güncellendi: ${statusLabels[selectedStatus]}`,
          receiverName: selectedStatus === 4 ? receiverName : undefined,
          deliveryProofPhotoUrl: uploadedUrl,
          latitude: latitude || undefined,
          longitude: longitude || undefined
        }),
        headers: { 'Content-Type': 'application/json' }
      });

      setModalVisible(false);
      fetchTasks();
      Alert.alert('Başarılı', 'Kargo durumu başarıyla güncellendi.');
    } catch (err: any) {
      console.error('Error submitting status update:', err);
      Alert.alert('Hata', err.message || 'Durum güncellenemedi.');
    } finally {
      setSubmitting(false);
    }
  };

  const renderStepper = (currentStatus: number) => {
    const steps = [0, 1, 2, 3, 4]; // Alındı, Planlandı, Hazırlanıyor, Dağıtımda, Teslim
    return (
      <View style={styles.stepperContainer}>
        {steps.map((step, index) => {
          const isActive = currentStatus >= step;
          const isLast = index === steps.length - 1;
          const label = step === 0 ? 'Alındı' : step === 1 ? 'Planlandı' : step === 2 ? 'Hazır' : step === 3 ? 'Dağıtımda' : 'Teslim';
          
          return (
            <React.Fragment key={step}>
              <View style={styles.stepNodeContainer}>
                <View style={[styles.stepNode, isActive && styles.stepNodeActive]}>
                  {isActive ? (
                    <CheckCircle2 size={12} color="#FFF" />
                  ) : (
                    <View style={styles.stepNodeInner} />
                  )}
                </View>
                <Text style={[styles.stepLabel, isActive && styles.stepLabelActive]}>{label}</Text>
              </View>
              {!isLast && (
                <View style={[styles.stepConnector, currentStatus > step && styles.stepConnectorActive]} />
              )}
            </React.Fragment>
          );
        })}
      </View>
    );
  };

  const renderItem = ({ item }: { item: CargoTask }) => {
    const badgeStyle = statusColors[item.status] || { bg: '#F3F4F6', text: '#374151' };
    return (
      <View style={styles.card}>
        {/* Top order row */}
        <View style={styles.cardHeader}>
          <View style={styles.orderLabelContainer}>
            <Package size={16} color="#B91C1C" style={styles.headerIcon} />
            <Text style={styles.orderNumber}>{item.orderNumber}</Text>
          </View>
          <View style={[styles.badge, { backgroundColor: badgeStyle.bg }]}>
            <Text style={[styles.badgeText, { color: badgeStyle.text }]}>{statusLabels[item.status]}</Text>
          </View>
        </View>

        {/* Content details */}
        <View style={styles.cardBody}>
          <View style={styles.infoRow}>
            <User size={14} color="#6B7280" style={styles.infoIcon} />
            <Text style={styles.customerName}>{item.customerName}</Text>
          </View>

          <View style={styles.infoRow}>
            <MapPin size={14} color="#6B7280" style={styles.infoIcon} />
            <Text style={styles.address}>{item.deliveryAddress}</Text>
          </View>

          <View style={styles.infoRow}>
            <Clock size={14} color="#6B7280" style={styles.infoIcon} />
            <Text style={styles.products} numberOfLines={1}>{item.productDetails || 'Ürün detayı bulunmuyor'}</Text>
          </View>
        </View>

        {/* Stepper tracking */}
        {renderStepper(item.status)}

        {/* Button */}
        {activeTab === 'bekleyen' ? (
          <TouchableOpacity
            style={[styles.cardButton, { backgroundColor: '#2563EB' }]}
            onPress={() => handleAssignToMe(item)}
          >
            <User size={16} color="#FFF" style={styles.buttonIcon} />
            <Text style={styles.cardButtonText}>Teslimatı Üstlen</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.cardButton}
            onPress={() => openUpdateModal(item)}
          >
            <Truck size={16} color="#FFF" style={styles.buttonIcon} />
            <Text style={styles.cardButtonText}>Durumu Güncelle</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Header top banner */}
      <View style={styles.headerBanner}>
        <View>
          <Text style={styles.headerTitle}>Sevkiyat Takibi</Text>
          <Text style={styles.headerSubtitle}>
            {filteredTasks.length > 0 ? `${filteredTasks.length} kargo teslimatı` : 'Kargo teslimatı bulunmuyor'}
          </Text>
        </View>
        <Compass size={24} color="#FFF" opacity={0.8} />
      </View>

      {/* Status Tab Bar */}
      <View style={{ flexDirection: 'row', paddingHorizontal: 16, paddingTop: 16, gap: 8 }}>
        <TouchableOpacity
          style={{
            flex: 1,
            paddingVertical: 10,
            borderRadius: 10,
            backgroundColor: activeTab === 'bekleyen' ? '#B91C1C' : colors.inputBg,
            borderWidth: 1,
            borderColor: activeTab === 'bekleyen' ? '#B91C1C' : colors.inputBorder,
            alignItems: 'center'
          }}
          onPress={() => setActiveTab('bekleyen')}
        >
          <Text style={{ color: activeTab === 'bekleyen' ? '#FFF' : colors.textSub, fontWeight: '700', fontSize: 11 }}>
            KARGO BEKLEYEN
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={{
            flex: 1,
            paddingVertical: 10,
            borderRadius: 10,
            backgroundColor: activeTab === 'aktif' ? '#B91C1C' : colors.inputBg,
            borderWidth: 1,
            borderColor: activeTab === 'aktif' ? '#B91C1C' : colors.inputBorder,
            alignItems: 'center'
          }}
          onPress={() => setActiveTab('aktif')}
        >
          <Text style={{ color: activeTab === 'aktif' ? '#FFF' : colors.textSub, fontWeight: '700', fontSize: 11 }}>
            KARGO AKTİF
          </Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#B91C1C" />
          <Text style={styles.loadingText}>Yükleniyor...</Text>
        </View>
      ) : (
        <FlatList
          data={filteredTasks}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshing={loading}
          onRefresh={fetchTasks}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Package size={48} color={colors.textMuted} />
              <Text style={styles.emptyText}>Bu sekmeye ait kargo görevi bulunmamaktadır.</Text>
              <Text style={styles.emptySubtext}>Daha sonra tekrar kontrol edin.</Text>
            </View>
          }
        />
      )}

      {/* Slide-Up Bottom Update Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity 
            style={styles.modalDismiss} 
            activeOpacity={1} 
            onPress={() => !submitting && setModalVisible(false)} 
          />
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>Kargo Durumu Güncelle</Text>
                <Text style={styles.modalSubtitle}>Sipariş No: {selectedTask?.orderNumber}</Text>
              </View>
              <TouchableOpacity
                onPress={() => setModalVisible(false)}
                disabled={submitting}
                style={styles.closeBtn}
              >
                <X size={20} color="#4B5563" />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.modalForm} showsVerticalScrollIndicator={false}>
              {/* Option Selector */}
              <Text style={styles.formSectionTitle}>Kargo Durumu</Text>
              <View style={styles.optionsContainer}>
                {[2, 3, 4].map((statusKey) => {
                  const isSelected = selectedStatus === statusKey;
                  const label = statusKey === 2 ? 'Hazırlanıyor' : statusKey === 3 ? 'Dağıtımda' : 'Teslim Edildi';
                  return (
                    <TouchableOpacity
                      key={statusKey}
                      style={[
                        styles.optionCard,
                        isSelected && styles.optionCardActive,
                        statusKey === 4 && isSelected && styles.optionCardDelivered
                      ]}
                      onPress={() => setSelectedStatus(statusKey)}
                    >
                      <View style={[styles.optionRadio, isSelected && styles.optionRadioActive]}>
                        {isSelected && <View style={styles.optionRadioInner} />}
                      </View>
                      <Text style={[styles.optionText, isSelected && styles.optionTextActive]}>{label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Delivery Proof Details Section (Only if status is Delivered) */}
              {selectedStatus === 4 && (
                <View style={styles.proofFormContainer}>
                  <Text style={styles.formSectionTitle}>Teslimat Detayları</Text>
                  
                  {/* Receiver Name */}
                  <View style={styles.inputContainer}>
                    <Text style={styles.inputLabel}>Teslim Alan Kişi *</Text>
                    <TextInput
                      style={styles.textInput}
                      placeholder="Ad Soyad giriniz"
                      value={receiverName}
                      onChangeText={setReceiverName}
                      placeholderTextColor="#9CA3AF"
                    />
                  </View>

                  {/* Geolocation fetch state */}
                  <View style={styles.locationContainer}>
                    <Text style={styles.inputLabel}>GPS Konum Doğrulaması *</Text>
                    <View style={styles.locationBox}>
                      {locationLoading ? (
                        <View style={styles.locationInline}>
                          <ActivityIndicator size="small" color="#B91C1C" style={{ marginRight: 8 }} />
                          <Text style={styles.locationLoadingText}>Konum doğrulanıyor...</Text>
                        </View>
                      ) : locationError ? (
                        <View style={styles.locationBetween}>
                          <Text style={styles.locationErrorText}>Konum doğrulanamadı.</Text>
                          <TouchableOpacity onPress={fetchLocation} style={styles.locationRetryBtn}>
                            <Text style={styles.locationRetryText}>Yeniden Dene</Text>
                          </TouchableOpacity>
                        </View>
                      ) : latitude && longitude ? (
                        <View style={styles.locationInline}>
                          <CheckCircle2 size={16} color="#059669" style={{ marginRight: 8 }} />
                          <Text style={styles.locationSuccessText}>
                            Konum Doğrulandı: {latitude.toFixed(5)}, {longitude.toFixed(5)}
                          </Text>
                        </View>
                      ) : (
                        <TouchableOpacity onPress={fetchLocation} style={styles.locationRetryBtn}>
                          <Text style={styles.locationRetryText}>Konum Al</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>

                  {/* Photo picker */}
                  <View style={styles.photoPickerContainer}>
                    <Text style={styles.inputLabel}>Teslimat Kanıt Fotoğrafı *</Text>
                    
                    {photoUri ? (
                      <View style={styles.photoPreviewWrapper}>
                        <Image source={{ uri: photoUri }} style={styles.photoPreview} />
                        <TouchableOpacity
                          style={styles.photoDeleteBtn}
                          onPress={() => setPhotoUri(null)}
                        >
                          <Trash2 size={16} color="#FFF" />
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <View style={styles.photoPickerDashedBox}>
                        <Text style={styles.dashedBoxText}>Fotoğraf Çek veya Galeriden Seç</Text>
                        <View style={styles.photoActionRow}>
                          <TouchableOpacity style={styles.photoMiniBtn} onPress={handleTakePhoto}>
                            <Camera size={18} color="#B91C1C" style={{ marginRight: 6 }} />
                            <Text style={styles.photoMiniBtnText}>Kamera</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={styles.photoMiniBtn} onPress={handleChooseFromGallery}>
                            <ImageIcon size={18} color="#B91C1C" style={{ marginRight: 6 }} />
                            <Text style={styles.photoMiniBtnText}>Galeri</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    )}
                  </View>
                </View>
              )}

              {/* Complete Actions */}
              <TouchableOpacity
                style={[
                  styles.submitBtn,
                  selectedStatus === 4 && (!receiverName.trim() || !photoUri) && styles.submitBtnDisabled
                ]}
                onPress={submitStatusUpdate}
                disabled={submitting || (selectedStatus === 4 && (!receiverName.trim() || !photoUri))}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Text style={styles.submitBtnText}>
                    {selectedStatus === 4 ? 'Teslimatı Tamamla ve Onayla' : 'Kargo Durumunu Güncelle'}
                  </Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const createStyles = (colors: ThemeColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 8, color: colors.textSub, fontWeight: '500' },
  list: { padding: 16 },
  
  // Header banner
  headerBanner: {
    backgroundColor: '#B91C1C',
    paddingHorizontal: 20,
    paddingVertical: 24,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    shadowColor: '#B91C1C',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  headerTitle: { fontSize: 20, fontWeight: '800', color: '#FFF' },
  headerSubtitle: { fontSize: 13, color: '#FECACA', marginTop: 2, fontWeight: '500' },

  // Card layouts
  card: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.divider,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 6,
    elevation: 2
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    paddingBottom: 12,
    marginBottom: 12
  },
  orderLabelContainer: { flexDirection: 'row', alignItems: 'center' },
  headerIcon: { marginRight: 6 },
  orderNumber: { fontWeight: '700', fontSize: 15, color: colors.text },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  badgeText: { fontSize: 11, fontWeight: '700' },

  cardBody: { marginBottom: 16 },
  infoRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  infoIcon: { marginRight: 8, marginTop: 1 },
  customerName: { fontSize: 14, fontWeight: '600', color: colors.text },
  address: { fontSize: 13, color: colors.textSub, flex: 1, lineHeight: 18 },
  products: { fontSize: 12, color: colors.textSub, flex: 1 },

  cardButton: {
    backgroundColor: '#B91C1C',
    paddingVertical: 12,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#B91C1C',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3
  },
  buttonIcon: { marginRight: 8 },
  cardButtonText: { color: '#FFF', fontWeight: '700', fontSize: 14 },

  // Stepper Tracking
  stepperContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    marginBottom: 18,
    marginTop: 4
  },
  stepNodeContainer: { alignItems: 'center', width: 50 },
  stepNode: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.inputBg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.inputBorder,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1
  },
  stepNodeActive: { backgroundColor: '#059669', borderColor: '#D1FAE5' },
  stepNodeInner: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.textMuted },
  stepLabel: { fontSize: 9, color: colors.textMuted, marginTop: 4, fontWeight: '600', textAlign: 'center' },
  stepLabelActive: { color: '#059669', fontWeight: '700' },
  stepConnector: { flex: 1, height: 2, backgroundColor: colors.inputBorder, marginTop: -14 },
  stepConnectorActive: { backgroundColor: '#059669' },

  // Empty list
  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60 },
  emptyText: { marginTop: 12, fontSize: 15, fontWeight: '600', color: colors.textSub },
  emptySubtext: { fontSize: 13, color: colors.textMuted, marginTop: 4 },

  // Modal styling
  modalOverlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.6)', justifyContent: 'flex-end' },
  modalDismiss: { flex: 1 },
  modalContent: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '85%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 10
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 18,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider
  },
  modalTitle: { fontSize: 17, fontWeight: '800', color: colors.text },
  modalSubtitle: { fontSize: 12, color: colors.textSub, marginTop: 2, fontWeight: '500' },
  closeBtn: { padding: 4, backgroundColor: colors.inputBg, borderRadius: 8 },

  modalForm: { padding: 20, paddingBottom: Platform.OS === 'ios' ? 40 : 20 },
  formSectionTitle: { fontSize: 14, fontWeight: '800', color: colors.text, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  
  optionsContainer: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 },
  optionCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.inputBorder,
    marginRight: 6,
    justifyContent: 'center'
  },
  optionCardActive: { borderColor: '#B91C1C', backgroundColor: 'rgba(185, 28, 28, 0.1)' },
  optionCardDelivered: { borderColor: '#059669', backgroundColor: 'rgba(5, 150, 105, 0.1)' },
  optionRadio: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: colors.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6
  },
  optionRadioActive: { borderColor: '#B91C1C' },
  optionRadioInner: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#B91C1C' },
  optionText: { fontSize: 11, fontWeight: '700', color: colors.textSub },
  optionTextActive: { color: '#B91C1C' },

  // Proof subform
  proofFormContainer: {
    backgroundColor: colors.inputBg,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    marginBottom: 20
  },
  inputContainer: { marginBottom: 16 },
  inputLabel: { fontSize: 12, fontWeight: '700', color: colors.textSub, marginBottom: 6 },
  textInput: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 12 : 8,
    fontSize: 14,
    color: colors.text,
    fontWeight: '500'
  },

  // Geolocation Box
  locationContainer: { marginBottom: 16 },
  locationBox: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: 10,
    padding: 12,
    justifyContent: 'center'
  },
  locationInline: { flexDirection: 'row', alignItems: 'center' },
  locationBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  locationLoadingText: { fontSize: 13, color: colors.textSub, fontWeight: '500' },
  locationErrorText: { fontSize: 13, color: '#DC2626', fontWeight: '600' },
  locationSuccessText: { fontSize: 13, color: '#059669', fontWeight: '600', flex: 1 },
  locationRetryBtn: { backgroundColor: colors.inputBg, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 },
  locationRetryText: { fontSize: 12, fontWeight: '700', color: colors.text },

  // Photo Box
  photoPickerContainer: {},
  photoPreviewWrapper: { position: 'relative', height: 160, borderRadius: 12, overflow: 'hidden' },
  photoPreview: { width: '100%', height: '100%', resizeMode: 'cover' },
  photoDeleteBtn: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: 'rgba(239, 68, 68, 0.9)',
    padding: 8,
    borderRadius: 8
  },
  photoPickerDashedBox: {
    height: 120,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.inputBorder,
    borderRadius: 12,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12
  },
  dashedBoxText: { fontSize: 12, color: colors.textSub, fontWeight: '500', marginBottom: 12 },
  photoActionRow: { flexDirection: 'row' },
  photoMiniBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(185, 28, 28, 0.1)',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    marginHorizontal: 6
  },
  photoMiniBtnText: { color: '#B91C1C', fontWeight: '700', fontSize: 12 },

  submitBtn: {
    backgroundColor: '#059669',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#059669',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3
  },
  submitBtnDisabled: { backgroundColor: colors.textMuted, shadowOpacity: 0 },
  submitBtnText: { color: '#FFF', fontSize: 14, fontWeight: '800' }
});
