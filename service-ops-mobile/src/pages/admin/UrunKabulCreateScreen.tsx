import React, { useMemo, useState, useRef, useEffect } from 'react';
import {
  FlatList,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  KeyboardAvoidingView,
  Platform,
  Animated,
  Alert,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchErpCustomerDealers, fetchErpProducts, fetchRegions } from './urunKabulApi';
import { createServiceRecord, uploadServiceRecordPhoto } from '../technician/serviceRecordsApi';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import type { UrunKabulStackParamList } from '../../app/UrunKabulStack';
import { ArrowLeft, ChevronDown, X, Calendar, AlertTriangle, Scan, Camera, FileText } from 'lucide-react-native';
import Card from '../../components/ui/Card';
import Spinner from '../../components/ui/Spinner';
import { useThemeColors, useThemeStore, ThemeColors } from '../../shared/theme/store';
import DatePickerModal from '../../components/ui/DatePickerModal';

function toIsoDateOnly(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const PRIORITY_OPTIONS = [
  { value: 'Low', label: 'Düşük' },
  { value: 'Normal', label: 'Normal' },
  { value: 'High', label: 'Yüksek' },
  { value: 'Urgent', label: 'Acil' },
];

type SelectItem = { key: string; title: string; subtitle?: string; onPress: () => void };

export default function UrunKabulCreateScreen() {
  const colors = useThemeColors();
  const theme = useThemeStore((s) => s.theme);
  const isDark = theme === 'dark';
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);

  const navigation = useNavigation<NativeStackNavigationProp<UrunKabulStackParamList>>();
  const qc = useQueryClient();

  const [plannedDate, setPlannedDate] = useState(toIsoDateOnly(new Date()));
  const [priority, setPriority] = useState('Normal');
  const [isUnderWarranty, setIsUnderWarranty] = useState<'Evet' | 'Hayır'>('Hayır');
  const [productName, setProductName] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [regionId, setRegionId] = useState('');
  const [receivingNote, setReceivingNote] = useState('');
  const [problemDescription, setProblemDescription] = useState('');
  const [dealerName, setDealerName] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');

  // Added new fields
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [warrantyStartDate, setWarrantyStartDate] = useState('');
  const [serviceDescription, setServiceDescription] = useState('');
  const [customerType, setCustomerType] = useState<'Bireysel' | 'Kurumsal'>('Bireysel');

  // Photo uploads
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoName, setPhotoName] = useState<string>('');
  const [photoType, setPhotoType] = useState<string>('');

  // Modals and simulated scanner states
  const [plannedDatePickerOpen, setPlannedDatePickerOpen] = useState(false);
  const [warrantyDatePickerOpen, setWarrantyDatePickerOpen] = useState(false);
  const [barcodeModalVisible, setBarcodeModalVisible] = useState(false);
  const [manualBarcode, setManualBarcode] = useState('');
  const laserAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (barcodeModalVisible) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(laserAnim, {
            toValue: 1,
            duration: 2000,
            useNativeDriver: true,
          }),
          Animated.timing(laserAnim, {
            toValue: 0,
            duration: 2000,
            useNativeDriver: true,
          }),
        ])
      ).start();

      const timer = setTimeout(() => {
        const mockSerials = ['ST-88234-A', 'ST-10943-B', 'ST-45218-X', 'STL-90342-M', 'STL-2026-88392'];
        const randomSerial = mockSerials[Math.floor(Math.random() * mockSerials.length)];
        setSerialNumber(randomSerial);
        setBarcodeModalVisible(false);
        Alert.alert('Başarılı', `Barkod başarıyla okundu: ${randomSerial}`);
      }, 2500);

      return () => {
        clearTimeout(timer);
        laserAnim.stopAnimation();
      };
    }
  }, [barcodeModalVisible]);

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

  const [selectMode, setSelectMode] = useState<null | 'product' | 'dealer' | 'region'>(null);
  const [selectSearch, setSelectSearch] = useState('');

  const regionsQuery = useQuery({
    queryKey: ['urun-kabul', 'regions'],
    queryFn: ({ signal }) => fetchRegions(signal),
  });

  const productsQuery = useQuery({
    queryKey: ['urun-kabul', 'erp-products'],
    queryFn: ({ signal }) => fetchErpProducts(signal),
  });

  const dealersQuery = useQuery({
    queryKey: ['urun-kabul', 'erp-dealers'],
    queryFn: ({ signal }) => fetchErpCustomerDealers(signal),
  });

  const productOptions = productsQuery.data ?? [];
  const regionOptions = regionsQuery.data ?? [];
  const dealerOptions = dealersQuery.data ?? [];

  const selectedRegionName = useMemo(() => {
    return regionOptions.find((r) => r.id === regionId)?.name ?? '';
  }, [regionOptions, regionId]);

  const filteredSelectItems = useMemo(() => {
    const q = selectSearch.trim().toLowerCase();

    if (!selectMode) return [] as SelectItem[];

    if (selectMode === 'region') {
      return regionOptions
        .filter((r) => (!q ? true : r.name.toLowerCase().includes(q)))
        .slice(0, 200)
        .map((r): SelectItem => ({
          key: r.id,
          title: r.name,
          subtitle: undefined,
          onPress: () => {
            setRegionId(r.id);
            setSelectMode(null);
            setSelectSearch('');
          },
        }));
    }

    if (selectMode === 'product') {
      return productOptions
        .filter((p) => (!q ? true : p.name.toLowerCase().includes(q)))
        .slice(0, 200)
        .map((p): SelectItem => ({
          key: p.id,
          title: p.name,
          subtitle: p.stockCode ? `Kod: ${p.stockCode}` : undefined,
          onPress: () => {
            setProductName(p.name);
            setSelectMode(null);
            setSelectSearch('');
          },
        }));
    }

    return dealerOptions
      .filter((d) => (!q ? true : d.name.toLowerCase().includes(q)))
      .slice(0, 200)
      .map((d): SelectItem => ({
        key: d.customerCode,
        title: d.name,
        subtitle: undefined,
        onPress: () => {
          setDealerName(d.name);
          setSelectMode(null);
          setSelectSearch('');
        },
      }));
  }, [dealerOptions, productOptions, regionOptions, selectMode, selectSearch]);

  const canSubmit = useMemo(() => {
    return Boolean(productName.trim() && serialNumber.trim() && regionId && problemDescription.trim());
  }, [productName, serialNumber, regionId, problemDescription]);

  const mutation = useMutation({
    mutationFn: async () => {
      const concatenated = [
        problemDescription.trim() ? `Arıza: ${problemDescription.trim()}` : '',
        invoiceNumber.trim() ? `Fatura No: ${invoiceNumber.trim()}` : '',
        warrantyStartDate.trim() ? `Garanti Başlangıç: ${warrantyStartDate.trim()}` : '',
        serviceDescription.trim() ? `Servis Açıklaması: ${serviceDescription.trim()}` : '',
        `Müşteri Tipi: ${customerType}`,
      ].filter(Boolean).join('\n');

      return await createServiceRecord({
        type: 'Repair',
        productName: productName.trim(),
        serialNumber: serialNumber.trim(),
        isUnderWarranty: isUnderWarranty === 'Evet',
        regionId: regionId || undefined,
        plannedDate: plannedDate ? new Date(plannedDate).toISOString() : undefined,
        priority,
        receivingNote: receivingNote.trim() || undefined,
        problemDescription: concatenated || undefined,
        dealerName: dealerName.trim() || undefined,
        customerName: customerName.trim() || undefined,
        customerPhone: customerPhone.trim() || undefined,
        customerAddress: customerAddress.trim() || undefined,
      });
    },
    onSuccess: async (createdRecord) => {
      if (photoUri && createdRecord?.id) {
        try {
          await uploadServiceRecordPhoto(createdRecord.id, photoUri, photoName, photoType);
        } catch (uploadError) {
          console.warn('Görsel yüklenemedi:', uploadError);
          Alert.alert('Uyarı', 'Servis kaydı oluşturuldu fakat görsel yüklenirken bir hata oldu.');
        }
      }
      await qc.invalidateQueries({ queryKey: ['urun-kabul', 'paged'] });
      navigation.goBack();
    },
  });

  const isLoadingLookups = regionsQuery.isLoading || productsQuery.isLoading || dealersQuery.isLoading;

  return (
    <SafeAreaView style={styles.safe}>
      {/* Decorative Orbs */}
      <View style={[styles.orb, styles.orb1]} />
      <View style={[styles.orb, styles.orb2]} />

      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <ArrowLeft color={colors.text} size={24} />
        </TouchableOpacity>
        <View style={styles.headerTitleRow}>
          <Text style={styles.title}>Yeni Servis Kaydı</Text>
          <Text style={styles.subtitle}>Ürün kabul formunu doldurun.</Text>
        </View>
      </View>

      <KeyboardAvoidingView style={styles.flex1} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          
          {isLoadingLookups ? (
            <View style={styles.loaderWrap}>
              <Spinner size="small" style={styles.loaderSpinner} />
              <Text style={styles.loaderText}>Listeler yükleniyor...</Text>
            </View>
          ) : null}

          {regionsQuery.isError || productsQuery.isError || dealersQuery.isError ? (
            <View style={styles.errorBox}>
              <AlertTriangle color="#ef4444" size={16} style={{ marginRight: 6 }} />
              <Text style={styles.errorText}>Veritabanı listeleri yüklenemedi. Lütfen internetinizi kontrol edin.</Text>
            </View>
          ) : null}

          {/* Zorunlu Alanlar Kartı */}
          <Card style={styles.card}>
            <Text style={styles.cardTitle}>ZORUNLU BİLGİLER</Text>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>PLANLANAN TARİH</Text>
              <TouchableOpacity 
                style={styles.pickerTrigger} 
                onPress={() => setPlannedDatePickerOpen(true)}
                activeOpacity={0.7}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                  <Calendar color={colors.textSub} size={18} style={styles.inputIcon} />
                  <Text style={[styles.pickerTriggerText, !plannedDate && styles.pickerTriggerPlaceholder]}>
                    {plannedDate || 'Tarih seçin...'}
                  </Text>
                </View>
                <ChevronDown color={colors.textSub} size={20} />
              </TouchableOpacity>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>ÖNCELİK DURUMU</Text>
              <View style={styles.priorityRow}>
                {PRIORITY_OPTIONS.map((opt) => {
                  const isSelected = priority === opt.value;
                  return (
                    <TouchableOpacity
                      key={opt.value}
                      style={[styles.priorityBtn, isSelected && styles.priorityBtnActive]}
                      onPress={() => setPriority(opt.value)}
                    >
                      <Text style={[styles.priorityBtnText, isSelected && styles.priorityBtnTextActive]}>
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>CİHAZ GARANTİ KAPSAMINDA MI?</Text>
              <View style={styles.warrantyRow}>
                {(['Evet', 'Hayır'] as const).map((w) => {
                  const isSelected = isUnderWarranty === w;
                  return (
                    <TouchableOpacity
                      key={w}
                      style={[
                        styles.warrantyBtn,
                        isSelected && (w === 'Evet' ? styles.warrantyBtnYesActive : styles.warrantyBtnNoActive)
                      ]}
                      onPress={() => setIsUnderWarranty(w)}
                    >
                      <Text style={[
                        styles.warrantyBtnText, 
                        isSelected && { color: w === 'Evet' ? '#10b981' : '#ef4444' }
                      ]}>
                        {w}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>KABUL EDİLEN ÜRÜN</Text>
              <TouchableOpacity style={styles.pickerTrigger} onPress={() => setSelectMode('product')}>
                <Text style={[styles.pickerTriggerText, !productName && styles.pickerTriggerPlaceholder]}>
                  {productName || 'Cihaz seçin...'}
                </Text>
                <ChevronDown color={colors.textSub} size={20} />
              </TouchableOpacity>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>SERİ NUMARASI</Text>
              <View style={styles.barcodeRow}>
                <TextInput 
                  style={[styles.inputBare, { flex: 1 }]} 
                  value={serialNumber} 
                  onChangeText={setSerialNumber} 
                  placeholder="Seri numarasını girin"
                  placeholderTextColor={colors.placeholder}
                  autoCapitalize="none"
                />
                <TouchableOpacity 
                  style={styles.barcodeBtn} 
                  onPress={() => setBarcodeModalVisible(true)}
                  activeOpacity={0.7}
                >
                  <Scan color="#fff" size={16} style={{ marginRight: 4 }} />
                  <Text style={styles.barcodeBtnText}>Barkod</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>SERVİS BÖLGESİ</Text>
              <TouchableOpacity style={styles.pickerTrigger} onPress={() => setSelectMode('region')}>
                <Text style={[styles.pickerTriggerText, !selectedRegionName && styles.pickerTriggerPlaceholder]}>
                  {selectedRegionName || 'Bölge seçin...'}
                </Text>
                <ChevronDown color={colors.textSub} size={20} />
              </TouchableOpacity>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>MÜŞTERİ ŞİKAYETİ / ARIZA TANIMI</Text>
              <TextInput 
                style={[styles.inputBare, styles.multilineInput]} 
                value={problemDescription} 
                onChangeText={setProblemDescription} 
                placeholder="Müşterinin belirttiği arızayı kısaca açıklayın"
                placeholderTextColor={colors.placeholder}
                multiline={true}
                numberOfLines={3}
              />
            </View>

          </Card>

          {/* Opsiyonel Alanlar Kartı */}
          <Card style={styles.card}>
            <Text style={styles.cardTitle}>OPSİYONEL BİLGİLER</Text>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>TESLİM ALMA NOTU</Text>
              <TextInput 
                style={styles.inputBare} 
                value={receivingNote} 
                onChangeText={setReceivingNote} 
                placeholder="Cihazın genel kozmetik durumu, aksesuarları vb."
                placeholderTextColor={colors.placeholder}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>BAYİ / ARACI FİRMA</Text>
              <TouchableOpacity style={styles.pickerTrigger} onPress={() => setSelectMode('dealer')}>
                <Text style={[styles.pickerTriggerText, !dealerName && styles.pickerTriggerPlaceholder]}>
                  {dealerName || 'Bayi seçin...'}
                </Text>
                <ChevronDown color={colors.textSub} size={20} />
              </TouchableOpacity>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>MÜŞTERİ TİPİ</Text>
              <View style={styles.priorityRow}>
                {(['Bireysel', 'Kurumsal'] as const).map((type) => {
                  const isSelected = customerType === type;
                  return (
                    <TouchableOpacity
                      key={type}
                      style={[styles.priorityBtn, isSelected && styles.priorityBtnActive]}
                      onPress={() => setCustomerType(type)}
                    >
                      <Text style={[styles.priorityBtnText, isSelected && styles.priorityBtnTextActive]}>
                        {type}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>FATURA NO</Text>
              <TextInput
                style={styles.inputBare}
                value={invoiceNumber}
                onChangeText={setInvoiceNumber}
                placeholder="Fatura numarasını girin"
                placeholderTextColor={colors.placeholder}
                autoCapitalize="none"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>GARANTİ BAŞLANGIÇ TARİHİ</Text>
              <TouchableOpacity 
                style={styles.pickerTrigger} 
                onPress={() => setWarrantyDatePickerOpen(true)}
                activeOpacity={0.7}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                  <Calendar color={colors.textSub} size={18} style={styles.inputIcon} />
                  <Text style={[styles.pickerTriggerText, !warrantyStartDate && styles.pickerTriggerPlaceholder]}>
                    {warrantyStartDate || 'Tarih seçin...'}
                  </Text>
                </View>
                <ChevronDown color={colors.textSub} size={20} />
              </TouchableOpacity>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>SERVİS AÇIKLAMASI</Text>
              <TextInput
                style={[styles.inputBare, styles.multilineInput]}
                value={serviceDescription}
                onChangeText={setServiceDescription}
                placeholder="Servis notunu veya açıklamasını girin"
                placeholderTextColor={colors.placeholder}
                multiline={true}
                numberOfLines={3}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>MÜŞTERİ ADI SOYADI</Text>
              <TextInput 
                style={styles.inputBare} 
                value={customerName} 
                onChangeText={setCustomerName} 
                placeholder="Nihai müşterinin adını girin"
                placeholderTextColor={colors.placeholder}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>MÜŞTERİ TELEFON NUMARASI</Text>
              <TextInput 
                style={styles.inputBare} 
                value={customerPhone} 
                onChangeText={setCustomerPhone} 
                placeholder="0555 XXXXXXX"
                placeholderTextColor={colors.placeholder}
                keyboardType="phone-pad"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>MÜŞTERİ ADRESİ</Text>
              <TextInput 
                style={[styles.inputBare, styles.multilineInput]} 
                value={customerAddress} 
                onChangeText={setCustomerAddress} 
                placeholder="Nihai müşteri adresini girin"
                placeholderTextColor={colors.placeholder}
                multiline={true}
                numberOfLines={2}
              />
            </View>
          </Card>

          {/* Photo Picker Card */}
          <Card style={styles.card}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Text style={styles.cardTitle}>ÜRÜN GÖRSELİ (OPSİYONEL)</Text>
              <Camera color={colors.textSub} size={18} />
            </View>

            <Text style={{ fontSize: 12, color: colors.textSub, lineHeight: 18, marginBottom: 8 }}>
              Kabul işlemi yapılan ürünün durumunu belirtmek için fotoğraf çekebilir veya galeriden görsel seçebilirsiniz.
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
                
                <TouchableOpacity
                  style={{
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
                  <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>Görseli Kaldır</Text>
                </TouchableOpacity>
              </View>
            )}
          </Card>

          {mutation.isError ? (
            <View style={styles.errorBox}>
              <AlertTriangle color="#ef4444" size={16} style={{ marginRight: 6 }} />
              <Text style={styles.errorText}>Hata: {mutation.error instanceof Error ? mutation.error.message : 'Kayıt oluşturulamadı'}</Text>
            </View>
          ) : null}

          <TouchableOpacity
            style={[styles.submitBtn, (!canSubmit || mutation.isPending) && styles.submitBtnDisabled]}
            disabled={!canSubmit || mutation.isPending}
            onPress={() => mutation.mutate()}
            activeOpacity={0.7}
          >
            {mutation.isPending ? (
              <Spinner size="small" color="#fff" style={styles.btnSpinner} />
            ) : (
              <Text style={styles.submitBtnText}>Servis Kaydını Oluştur</Text>
            )}
          </TouchableOpacity>

        </ScrollView>
      </KeyboardAvoidingView>

      {/* Simulated Barcode Scanner Modal */}
      <Modal visible={barcodeModalVisible} animationType="slide" onRequestClose={() => setBarcodeModalVisible(false)}>
        <SafeAreaView style={[styles.modalSafe, { backgroundColor: '#000' }]}>
          {/* Scanner Header */}
          <View style={[styles.modalHeader, { borderBottomColor: 'rgba(255,255,255,0.1)' }]}>
            <Text style={[styles.modalTitle, { color: '#fff' }]}>Seri Numarası Tara</Text>
            <TouchableOpacity onPress={() => setBarcodeModalVisible(false)} style={[styles.modalCloseBtn, { backgroundColor: 'rgba(255,255,255,0.1)' }]}>
              <X color="#fff" size={20} />
            </TouchableOpacity>
          </View>

          <View style={[styles.modalBody, { backgroundColor: '#050505', alignItems: 'center', justifyContent: 'center' }]}>
            <Text style={{ color: '#aaa', fontSize: 13, textAlign: 'center', marginBottom: 20, paddingHorizontal: 20 }}>
              Cihazın arkasındaki veya kutusundaki barkodu tarama alanına hizalayın.
            </Text>

            {/* Viewfinder Frame */}
            <View style={styles.scannerFrame}>
              {/* Glowing corners */}
              <View style={[styles.scannerCorner, styles.cornerTL]} />
              <View style={[styles.scannerCorner, styles.cornerTR]} />
              <View style={[styles.scannerCorner, styles.cornerBL]} />
              <View style={[styles.scannerCorner, styles.cornerBR]} />

              {/* Animated Laser Line */}
              <Animated.View
                style={[
                  styles.scannerLaser,
                  {
                    transform: [
                      {
                        translateY: laserAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0, 160], // Viewfinder height is 160
                        }),
                      },
                    ],
                  },
                ]}
              />
            </View>

            <Text style={{ color: '#ef4444', fontSize: 12, fontWeight: '700', marginTop: 24, letterSpacing: 1.5 }}>
              BARKOD ARANIYOR...
            </Text>

            {/* Manual entry / Override */}
            <View style={styles.scannerManualBox}>
              <TextInput
                style={styles.scannerManualInput}
                value={manualBarcode}
                onChangeText={setManualBarcode}
                placeholder="Manuel seri no girin..."
                placeholderTextColor="rgba(255,255,255,0.4)"
                autoCapitalize="none"
              />
              <TouchableOpacity
                style={styles.scannerManualBtn}
                onPress={() => {
                  if (manualBarcode.trim()) {
                    setSerialNumber(manualBarcode.trim());
                    setBarcodeModalVisible(false);
                    setManualBarcode('');
                  }
                }}
              >
                <Text style={styles.scannerManualBtnText}>Giriş</Text>
              </TouchableOpacity>
            </View>
          </View>
        </SafeAreaView>
      </Modal>

      {/* Date Pickers */}
      <DatePickerModal
        visible={plannedDatePickerOpen}
        value={plannedDate}
        onSelect={(iso) => setPlannedDate(iso)}
        onClose={() => setPlannedDatePickerOpen(false)}
      />

      <DatePickerModal
        visible={warrantyDatePickerOpen}
        value={warrantyStartDate}
        onSelect={(iso) => setWarrantyStartDate(iso)}
        onClose={() => setWarrantyDatePickerOpen(false)}
      />

      {/* Select Modals */}
      <Modal visible={selectMode !== null} animationType="slide" onRequestClose={() => setSelectMode(null)}>
        <SafeAreaView style={styles.modalSafe}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>
              {selectMode === 'product' ? 'Ürün Seç' : selectMode === 'dealer' ? 'Bayi Seç' : 'Bölge Seç'}
            </Text>
            <TouchableOpacity onPress={() => setSelectMode(null)} style={styles.modalCloseBtn}>
              <X color={colors.text} size={20} />
            </TouchableOpacity>
          </View>

          <View style={styles.modalBody}>
            <TextInput
              style={styles.modalSearchInput}
              placeholder="Ara..."
              placeholderTextColor={colors.placeholder}
              value={selectSearch}
              onChangeText={setSelectSearch}
              autoCapitalize="none"
              autoFocus={true}
            />

            <FlatList
              data={filteredSelectItems}
              keyExtractor={(x) => x.key}
              contentContainerStyle={styles.modalList}
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.modalRow} onPress={item.onPress} activeOpacity={0.6}>
                  <View style={styles.modalRowContent}>
                    <Text style={styles.modalRowTitle} numberOfLines={2}>
                      {item.title}
                    </Text>
                    {item.subtitle ? <Text style={styles.modalRowSubtitle} numberOfLines={1}>{item.subtitle}</Text> : null}
                  </View>
                  <ChevronDown color={colors.textMuted} size={16} style={{ transform: [{ rotate: '-90deg' }] }} />
                </TouchableOpacity>
              )}
              ListEmptyComponent={() => (
                <Text style={styles.modalEmptyText}>Eşleşen sonuç bulunamadı.</Text>
              )}
            />
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const createStyles = (colors: ThemeColors, isDark: boolean) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex1: { flex: 1 },
  orb: { position: 'absolute', borderRadius: 9999 },
  orb1: { top: '-10%', left: '-10%', width: '60%', height: '45%', backgroundColor: isDark ? 'rgba(183, 58, 11, 0.08)' : 'rgba(185, 28, 28, 0.06)' },
  orb2: { bottom: '-5%', right: '-20%', width: '70%', height: '50%', backgroundColor: isDark ? 'rgba(122, 12, 12, 0.08)' : 'rgba(185, 28, 28, 0.04)' },

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
  headerTitleRow: {
    flex: 1,
  },
  title: { fontSize: 22, fontWeight: '900', color: colors.text, letterSpacing: -0.5 },
  subtitle: { fontSize: 13, color: colors.textSub, marginTop: 2 },

  container: { padding: 16, gap: 16, paddingBottom: 60, maxWidth: 650, width: '100%', alignSelf: 'center' },
  loaderWrap: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.inputBg, padding: 12, borderRadius: 12, gap: 8 },
  loaderSpinner: { padding: 0 },
  loaderText: { color: colors.textSub, fontSize: 13, fontWeight: '600' },

  card: {
    gap: 16,
  },
  cardTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#B91C1C',
    letterSpacing: 1.5,
    marginBottom: 4,
  },

  inputGroup: {
    gap: 6,
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.65)',
    letterSpacing: 0.8,
    marginLeft: 2,
  },
  textInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: isDark ? 'rgba(255,255,255,0.07)' : '#ffffff',
    borderColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.18)',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
  },
  inputIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    height: 46,
    color: isDark ? '#ffffff' : '#111111',
    fontSize: 14,
    fontWeight: '500',
  },
  inputBare: {
    backgroundColor: isDark ? 'rgba(255,255,255,0.07)' : '#ffffff',
    borderColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.18)',
    borderWidth: 1,
    borderRadius: 12,
    height: 46,
    paddingHorizontal: 12,
    color: isDark ? '#ffffff' : '#111111',
    fontSize: 14,
    fontWeight: '500',
  },
  multilineInput: {
    height: 80,
    paddingTop: 12,
    textAlignVertical: 'top',
  },

  priorityRow: {
    flexDirection: 'row',
    gap: 8,
  },
  priorityBtn: {
    flex: 1,
    height: 40,
    backgroundColor: colors.inputBg,
    borderColor: colors.inputBorder,
    borderWidth: 1,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  priorityBtnActive: {
    backgroundColor: colors.accentLight,
    borderColor: '#B91C1C',
  },
  priorityBtnText: {
    color: isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)',
    fontSize: 13,
    fontWeight: '700',
  },
  priorityBtnTextActive: {
    color: '#B91C1C',
  },

  warrantyRow: {
    flexDirection: 'row',
    gap: 8,
  },
  warrantyBtn: {
    flex: 1,
    height: 40,
    backgroundColor: colors.inputBg,
    borderColor: colors.inputBorder,
    borderWidth: 1,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  warrantyBtnActive: {
    backgroundColor: colors.inputBg,
    borderColor: colors.inputBorder,
  },
  warrantyBtnYesActive: {
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    borderColor: '#10b981',
  },
  warrantyBtnNoActive: {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderColor: '#ef4444',
  },
  warrantyBtnText: {
    color: isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)',
    fontSize: 13,
    fontWeight: '700',
  },
  warrantyBtnTextActive: {
    color: '#ffffff',
  },

  pickerTrigger: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: isDark ? 'rgba(255,255,255,0.07)' : '#ffffff',
    borderColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.18)',
    borderWidth: 1,
    borderRadius: 12,
    height: 46,
    paddingHorizontal: 12,
  },
  pickerTriggerText: {
    color: isDark ? '#ffffff' : '#111111',
    fontSize: 14,
    fontWeight: '600',
  },
  pickerTriggerPlaceholder: {
    color: isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)',
    fontWeight: '400',
  },

  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
    borderColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  errorText: {
    flex: 1,
    color: 'rgb(252, 165, 165)',
    fontSize: 12,
    fontWeight: '600',
  },

  submitBtn: {
    backgroundColor: '#B91C1C',
    borderRadius: 14,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  submitBtnDisabled: {
    backgroundColor: colors.inputBg,
    opacity: 0.5,
  },
  submitBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
  },
  btnSpinner: {
    padding: 0,
  },

  // Modal styling (dark)
  modalSafe: { flex: 1, backgroundColor: colors.bg },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  modalTitle: { fontSize: 18, fontWeight: '800', color: colors.text },
  modalCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.inputBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBody: { flex: 1, padding: 16, gap: 12 },
  modalSearchInput: {
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: 12,
    color: colors.text,
    padding: 12,
    fontSize: 14,
  },
  modalList: { paddingBottom: 30, gap: 10 },
  modalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    borderRadius: 14,
    padding: 14,
  },
  modalRowContent: {
    flex: 1,
    marginRight: 12,
  },
  modalRowTitle: { color: colors.text, fontSize: 14, fontWeight: '700' },
  modalRowSubtitle: { color: colors.textSub, fontSize: 11, marginTop: 2 },
  modalEmptyText: { color: colors.textSub, textAlign: 'center', marginTop: 40 },
  barcodeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  barcodeBtn: {
    backgroundColor: '#B91C1C',
    borderRadius: 12,
    paddingHorizontal: 16,
    height: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  barcodeBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  scannerFrame: {
    width: 260,
    height: 180,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    position: 'relative',
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 16,
  },
  scannerCorner: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderColor: '#B91C1C',
  },
  cornerTL: {
    top: 0,
    left: 0,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderTopLeftRadius: 12,
  },
  cornerTR: {
    top: 0,
    right: 0,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderTopRightRadius: 12,
  },
  cornerBL: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderBottomLeftRadius: 12,
  },
  cornerBR: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderBottomRightRadius: 12,
  },
  scannerLaser: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: '#ef4444',
  },
  scannerManualBox: {
    flexDirection: 'row',
    width: '85%',
    gap: 8,
    marginTop: 40,
    alignItems: 'center',
  },
  scannerManualInput: {
    flex: 1,
    height: 44,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderColor: 'rgba(255, 255, 255, 0.15)',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    color: '#fff',
    fontSize: 13,
  },
  scannerManualBtn: {
    height: 44,
    backgroundColor: '#B91C1C',
    borderRadius: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scannerManualBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
});
