import React, { useMemo } from 'react';
import { StyleSheet, Text, View, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { fetchTechnicians } from './techniciansApi';
import { Map, RotateCw } from 'lucide-react-native';
import MapViewer, { MapTechnician } from '../../components/ui/MapViewer';
import Spinner from '../../components/ui/Spinner';

export default function LocationTrackingScreen() {
  const query = useQuery({
    queryKey: ['admin', 'technicians', 'tracking'],
    queryFn: ({ signal }) => fetchTechnicians(undefined, signal),
    refetchInterval: 30_000, // Auto refresh every 30 seconds
  });

  const technicians = query.data ?? [];

  const isWithinCyprus = (la: number, ln: number) => {
    return la >= 34.0 && la <= 36.0 && ln >= 32.0 && ln <= 35.0;
  };

  const mapData: MapTechnician[] = useMemo(() => {
    return technicians.map((t, idx) => {
      let lat = t.currentLatitude != null ? Number(t.currentLatitude) : null;
      let lng = t.currentLongitude != null ? Number(t.currentLongitude) : null;
      let hasValidCoords = lat != null && lng != null && !isNaN(lat) && !isNaN(lng) && isWithinCyprus(lat, lng);

      if (!hasValidCoords) {
        // Fallback to Nicosia with index offset to prevent overlapping
        lat = 35.1856 + (idx * 0.006 - 0.003);
        lng = 33.3823 + (idx * 0.006 - 0.003);
      }

      return {
        id: t.id,
        fullName: t.fullName,
        phone: t.phone,
        status: t.status,
        statusText: (t.statusLabel || t.status) + (hasValidCoords ? '' : ' (Konum Yok)'),
        latitude: lat!,
        longitude: lng!,
        isOnline: t.isOnline ?? false,
      };
    });
  }, [technicians]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={[styles.orb, styles.orb1]} />
      <View style={[styles.orb, styles.orb2]} />

      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.titleCol}>
            <View style={styles.titleRow}>
              <Map color="#B91C1C" size={24} style={{ marginRight: 8 }} />
              <Text style={styles.title}>Teknisyen Takip</Text>
            </View>
            <Text style={styles.subtitle}>Saha teknisyenlerinin anlık coğrafi konumları</Text>
          </View>
          <TouchableOpacity 
            style={styles.refreshBtn} 
            onPress={() => query.refetch()}
            disabled={query.isFetching}
          >
            <RotateCw color="#fff" size={18} style={query.isFetching ? styles.spinning : undefined} />
          </TouchableOpacity>
        </View>

        {query.isLoading && !query.data ? (
          <Spinner style={styles.loader} />
        ) : query.isError ? (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>
              Konum verileri alınamadı: {query.error instanceof Error ? query.error.message : 'Bilinmeyen hata'}
            </Text>
          </View>
        ) : (
          <View style={styles.mapContainer}>
            {mapData.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>Şu anda konumu aktif olan teknisyen bulunamadı.</Text>
              </View>
            ) : (
              <MapViewer technicians={mapData} style={styles.map} />
            )}
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0a0a' },
  orb: { position: 'absolute', borderRadius: 9999 },
  orb1: { top: '-10%', left: '-10%', width: '60%', height: '40%', backgroundColor: 'rgba(183, 58, 11, 0.12)' },
  orb2: { bottom: '0%', right: '-20%', width: '70%', height: '50%', backgroundColor: 'rgba(122, 12, 12, 0.08)' },

  container: { flex: 1, padding: 16, maxWidth: 800, width: '100%', alignSelf: 'center' },
  header: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    marginBottom: 16 
  },
  titleCol: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  title: { fontSize: 22, fontWeight: '800', color: '#fff', letterSpacing: -0.5 },
  subtitle: { fontSize: 12, color: 'rgba(255,255,255,0.45)', marginTop: 4, fontWeight: '500' },
  
  refreshBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  spinning: {
    opacity: 0.5,
  },
  loader: { flex: 1, justifyContent: 'center' },
  errorContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorText: { color: '#ef4444', fontSize: 14, fontWeight: '600', textAlign: 'center' },
  
  mapContainer: { flex: 1, marginTop: 8 },
  map: { flex: 1 },
  
  emptyContainer: { 
    flex: 1, 
    justifyContent: 'center', 
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    backgroundColor: 'rgba(255,255,255,0.02)',
    padding: 24
  },
  emptyText: { color: 'rgba(255,255,255,0.4)', textAlign: 'center', fontSize: 14, fontStyle: 'italic' }
});
