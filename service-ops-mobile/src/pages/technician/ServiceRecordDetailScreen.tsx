import React, { useMemo, useState } from 'react';
import {
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Image,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { WebView } from 'react-native-webview';
import { fetchServiceRecordById, fetchServiceTimeline, uploadServiceRecordPhoto, groupMobileTimelineEvents } from './serviceRecordsApi';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import {
  ArrowLeft,
  Wrench,
  Shield,
  ShieldAlert,
  Clock,
  User,
  Phone,
  MapPin,
  Box,
  Cpu,
  Layers,
  Activity,
  FileText,
  Camera,
} from 'lucide-react-native';
import Card from '../../components/ui/Card';
import Badge, { BadgeType } from '../../components/ui/Badge';
import Spinner from '../../components/ui/Spinner';
import ImageSlider from '../../components/ui/ImageSlider';
import { useThemeColors, useThemeStore, type ThemeColors } from '../../shared/theme/store';
import { getStatusLabel, getStatusBadgeType } from '../../shared/utils/statusTranslator';
import { API_BASE_URL } from '../../shared/config';

export type ServiceRecordDetailRouteParams = {
  ServiceRecordDetail: { serviceId: string };
};

const STATUS_MAPPING: Record<string, { label: string; type: BadgeType }> = {
  New: { label: 'Yeni', type: 'neutral' },
  Planned: { label: 'Planlandı', type: 'info' },
  Workshop: { label: 'Aktif / Sahada', type: 'warning' },
  InRepair: { label: 'Arıza Tamirinde', type: 'warning' },
  WaitingForParts: { label: 'Parça Bekliyor', type: 'error' },
  Ready: { label: 'Hazır', type: 'success' },
  Delivered: { label: 'Teslim Edildi', type: 'success' },
  Completed: { label: 'Gerçekleşti', type: 'success' },
  Cancelled: { label: 'İptal', type: 'error' },
  Deferred: { label: 'Ertelendi', type: 'neutral' },
};

const PRIORITY_MAPPING: Record<string, { label: string; type: BadgeType }> = {
  Low: { label: 'Düşük', type: 'info' },
  Medium: { label: 'Orta', type: 'warning' },
  High: { label: 'Yüksek', type: 'warning' },
  Urgent: { label: 'ACİL', type: 'error' },
};

export default function ServiceRecordDetailScreen() {
  const colors = useThemeColors();
  const theme = useThemeStore((s) => s.theme);
  const isDark = theme === 'dark';
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);

  const navigation = useNavigation();
  const route = useRoute<RouteProp<ServiceRecordDetailRouteParams, 'ServiceRecordDetail'>>();
  const { serviceId } = route.params;

  const detailQuery = useQuery({
    queryKey: ['servicerecords', 'detail', serviceId],
    queryFn: ({ signal }) => fetchServiceRecordById(serviceId, signal),
  });

  const timelineQuery = useQuery({
    queryKey: ['servicerecords', 'timeline', serviceId],
    queryFn: ({ signal }) => fetchServiceTimeline(serviceId, signal),
  });

  const data = detailQuery.data;
  const rawTimeline = timelineQuery.data ?? [];
  const timeline = useMemo(() => groupMobileTimelineEvents(rawTimeline), [rawTimeline]);

  const [photos, setPhotos] = useState<{ uri: string; name: string; type: string }[]>([]);
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

  const handleUploadPhoto = async () => {
    if (photos.length === 0) return;
    setUploading(true);
    try {
      for (const p of photos) {
        await uploadServiceRecordPhoto(serviceId, p.uri, p.name, p.type);
      }
      Alert.alert('Başarılı', `${photos.length} fotoğraf başarıyla yüklendi.`);
      setPhotos([]);
      await timelineQuery.refetch();
    } catch (error: any) {
      Alert.alert('Hata', error?.message || 'Fotoğraflar yüklenirken bir hata oluştu.');
    } finally {
      setUploading(false);
    }
  };

  const handleCall = (phone?: string) => {
    if (phone) {
      Linking.openURL(`tel:${phone.replace(/\s+/g, '')}`);
    }
  };

  const handleNavigate = (address?: string) => {
    if (address) {
      Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`);
    }
  };

  const lookupKey = data ? Object.keys(STATUS_MAPPING).find(
    (k) => k.toLowerCase() === (data.status ?? '').toLowerCase()
  ) : null;
  const statusInfo = data ? (
    lookupKey ? STATUS_MAPPING[lookupKey] : { label: getStatusLabel(data.status, data.statusLabel), type: getStatusBadgeType(data.status) }
  ) : null;
  const priorityInfo = data?.priority ? (PRIORITY_MAPPING[data.priority] || { label: data.priorityLabel ?? data.priority, type: 'neutral' as BadgeType }) : null;

  // Leaflet.js HTML with Dark Matter CartoDB tiles for single coordinate
  const mapHtml = data?.latitude && data?.longitude ? `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
      <style>
        body, html, #map { margin: 0; padding: 0; height: 100%; width: 100%; background: #0c0c0c; }
        .custom-marker {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          border: 2px solid #fff;
          color: white;
          font-weight: bold;
          font-size: 11px;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 2px 5px rgba(0,0,0,0.5);
          background: #dc2626;
        }
      </style>
    </head>
    <body>
      <div id="map"></div>
      <script>
        var map = L.map('map', { zoomControl: false }).setView([${data.latitude}, ${data.longitude}], 14);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', {
          attribution: 'CartoDB'
        }).addTo(map);

        var icon = L.divIcon({
          className: '',
          html: '<div class="custom-marker">SRV</div>',
          iconSize: [28, 28],
          iconAnchor: [14, 14]
        });
        L.marker([${data.latitude}, ${data.longitude}], { icon: icon })
          .addTo(map)
          .bindPopup('<b>${data.serviceNumber}</b><br>Müşteri: ${data.customerName || ''}');
      </script>
    </body>
    </html>
  ` : null;

  return (
    <SafeAreaView style={styles.safe}>
      {/* Decorative Orbs */}
      <View style={[styles.orb, styles.orb1]} />
      <View style={[styles.orb, styles.orb2]} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <ArrowLeft color={colors.text} size={24} />
        </TouchableOpacity>
        <View style={styles.headerTitleRow}>
          <Text style={styles.title}>Servis Detayı</Text>
          <Text style={styles.subtitle}>{data?.serviceNumber ?? 'Yükleniyor...'}</Text>
        </View>
      </View>

      {detailQuery.isLoading ? (
        <Spinner fullScreen />
      ) : detailQuery.isError ? (
        <View style={styles.centerContainer}>
          <ShieldAlert color="#ef4444" size={48} />
          <Text style={styles.errorText}>
            Hata: {detailQuery.error instanceof Error ? detailQuery.error.message : 'Bilinmeyen hata'}
          </Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => detailQuery.refetch()}>
            <Text style={styles.retryBtnText}>Tekrar Dene</Text>
          </TouchableOpacity>
        </View>
      ) : data ? (
        <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
          
          {/* Main Info Card */}
          <Card style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>{data.serviceNumber}</Text>
              <View style={styles.badgeRow}>
                {statusInfo && (
                  <Badge label={statusInfo.label} type={statusInfo.type} />
                )}
                {priorityInfo && (
                  <Badge label={priorityInfo.label} type={priorityInfo.type} />
                )}
              </View>
            </View>

            <View style={styles.row}>
              <Layers color={colors.textMuted} size={16} style={{ marginTop: 2 }} />
              <View>
                <Text style={styles.rowLabel}>Kayıt Tipi</Text>
                <Text style={styles.rowValue}>
                  {data.type === 'Installation' ? 'Montaj Operasyonu' : 'Saha Arıza Destek'}
                </Text>
              </View>
            </View>

            <View style={styles.row}>
              <Shield color={colors.textMuted} size={16} style={{ marginTop: 2 }} />
              <View>
                <Text style={styles.rowLabel}>Garanti Durumu</Text>
                <Text style={[styles.rowValue, { color: data.isUnderWarranty ? '#10b981' : colors.textSub }]}>
                  {data.isUnderWarranty ? 'Garanti Kapsamında' : 'Garanti Dışı / Ücretli'}
                </Text>
              </View>
            </View>

            <View style={styles.row}>
              <Clock color={colors.textMuted} size={16} style={{ marginTop: 2 }} />
              <View>
                <Text style={styles.rowLabel}>Oluşturulma & Planlanan</Text>
                <Text style={styles.rowValue}>
                  Açılış: {new Date(data.createdAt).toLocaleDateString('tr-TR')}
                </Text>
                {data.plannedAt && (
                  <Text style={[styles.rowValue, { color: '#60A5FA', marginTop: 4 }]}>
                    Planlanan: {new Date(data.plannedAt).toLocaleDateString('tr-TR')}
                  </Text>
                )}
              </View>
            </View>
          </Card>

          {/* Customer Info Card */}
          <Card style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitleText}>Müşteri Bilgileri</Text>
            </View>

            <View style={styles.row}>
              <User color={colors.textMuted} size={16} style={{ marginTop: 2 }} />
              <View>
                <Text style={styles.rowLabel}>Müşteri Adı</Text>
                <Text style={styles.rowValue}>{data.customerName || 'İsimsiz Müşteri'}</Text>
              </View>
            </View>

            {data.customerPhone ? (
              <TouchableOpacity style={styles.row} onPress={() => handleCall(data.customerPhone)}>
                <Phone color="#60A5FA" size={16} style={{ marginTop: 2 }} />
                <View>
                  <Text style={[styles.rowLabel, { color: '#60A5FA' }]}>Telefon (Ara)</Text>
                  <Text style={[styles.rowValue, styles.rowValueLink]}>{data.customerPhone}</Text>
                </View>
              </TouchableOpacity>
            ) : null}

            {data.customerAddress ? (
              <TouchableOpacity style={styles.row} onPress={() => handleNavigate(data.customerAddress)}>
                <MapPin color="#60A5FA" size={16} style={{ marginTop: 2 }} />
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text style={[styles.rowLabel, { color: '#60A5FA' }]}>Adres (Harita)</Text>
                  <Text style={[styles.rowValue, styles.rowValueLink]} numberOfLines={3}>
                    {data.customerAddress}
                  </Text>
                </View>
              </TouchableOpacity>
            ) : null}
          </Card>

          {/* Product & Dealer Card */}
          <Card style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitleText}>Cihaz & Bayi Detayları</Text>
            </View>

            <View style={styles.row}>
              <Box color={colors.textMuted} size={16} style={{ marginTop: 2 }} />
              <View>
                <Text style={styles.rowLabel}>Ürün Adı</Text>
                <Text style={styles.rowValue}>{data.productName || 'Ürün Belirtilmemiş'}</Text>
              </View>
            </View>

            <View style={styles.row}>
              <Cpu color={colors.textMuted} size={16} style={{ marginTop: 2 }} />
              <View>
                <Text style={styles.rowLabel}>Seri Numarası</Text>
                <Text style={styles.rowValue}>{data.serialNumber || 'SN Yok / Belirtilmemiş'}</Text>
              </View>
            </View>

            {data.dealerName ? (
              <View style={styles.row}>
                <FileText color={colors.textMuted} size={16} style={{ marginTop: 2 }} />
                <View>
                  <Text style={styles.rowLabel}>Yetkili Bayi</Text>
                  <Text style={styles.rowValue}>{data.dealerName}</Text>
                </View>
              </View>
            ) : null}
          </Card>

          {/* Assignment Details Card */}
          <Card style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitleText}>Atama & Bölge Bilgisi</Text>
            </View>

            <View style={styles.row}>
              <View style={styles.techAvatar}>
                <Text style={styles.techAvatarText}>
                  {data.assignedTechnicianName
                    ? data.assignedTechnicianName.split(' ').filter(Boolean).slice(0, 2).map((n) => n[0]).join('')
                    : '?'}
                </Text>
              </View>
              <View>
                <Text style={styles.rowLabel}>Sorumlu Teknisyen</Text>
                <Text style={styles.rowValue}>{data.assignedTechnicianName || 'Henüz Atanmadı'}</Text>
              </View>
            </View>

            <View style={styles.row}>
              <MapPin color={colors.textMuted} size={16} style={{ marginTop: 2 }} />
              <View>
                <Text style={styles.rowLabel}>Hizmet Bölgesi</Text>
                <Text style={styles.rowValue}>{data.regionName || 'Bölge Atanmamış'}</Text>
              </View>
            </View>
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

            {photos.length === 0 ? (
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
                <ImageSlider
                  urls={photos.map(p => p.uri)}
                  imageStyle={{ height: 200 }}
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
                      onPress={() => setPhotos([])}
                    >
                      <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>Vazgeç</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            )}
          </Card>

          {/* Location Map WebView if coords exist */}
          {mapHtml && (
            <Card style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitleText}>Konum Bilgisi</Text>
              </View>
              <View style={styles.mapContainer}>
                <WebView
                  originWhitelist={['*']}
                  source={{ html: mapHtml }}
                  style={styles.webView}
                  javaScriptEnabled={true}
                  domStorageEnabled={true}
                />
              </View>
            </Card>
          )}

          {/* Timeline / History Card */}
          <Card style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitleText}>İşlem Geçmişi & Zaman Akışı</Text>
              <Activity color={colors.textMuted} size={18} />
            </View>

            {timelineQuery.isLoading ? (
              <Spinner style={styles.timelineLoader} />
            ) : timeline.length === 0 ? (
              <Text style={styles.emptyTimelineText}>Bu kayda ait işlem geçmişi bulunamadı.</Text>
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
                      {item.type === 'FaultUpdate' ? (
                        <View style={{ gap: 4 }}>
                          {/* 1. Görsel(ler) */}
                          {item.photoUrls && item.photoUrls.length > 0 ? (
                            <ImageSlider urls={item.photoUrls} imageStyle={{ height: 160 }} />
                          ) : item.photoUrl ? (
                            <ImageSlider urls={[item.photoUrl]} imageStyle={{ height: 160 }} />
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
                          {item.photoUrls && item.photoUrls.length > 0 ? (
                            <ImageSlider urls={item.photoUrls} imageStyle={{ height: 160 }} />
                          ) : item.photoUrl ? (
                            <ImageSlider urls={[item.photoUrl]} imageStyle={{ height: 160 }} />
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
        </ScrollView>
      ) : null}
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
  cardTitle: { fontSize: 16, fontWeight: '800', color: '#B91C1C', letterSpacing: 0.5 },
  cardTitleText: { fontSize: 16, fontWeight: '800', color: colors.text },
  
  badgeRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },

  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  rowLabel: { fontSize: 11, color: colors.textMuted, fontWeight: '700', textTransform: 'uppercase' },
  rowValue: { fontSize: 14, color: colors.text, fontWeight: '600', marginTop: 2, lineHeight: 18 },
  rowValueLink: { color: '#60A5FA', textDecorationLine: 'underline' },

  techAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.inputBg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.inputBorder,
  },
  techAvatarText: { fontSize: 12, fontWeight: '800', color: colors.textSub },

  mapContainer: {
    height: 180,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.inputBorder,
    backgroundColor: colors.bg,
    marginTop: 4,
  },
  webView: { flex: 1, backgroundColor: 'transparent' },

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
});
