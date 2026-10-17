import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { useSessionStore } from '../../shared/session/store';
import { fetchRoutes } from './routesApi';
import { fetchServiceRecords } from './serviceRecordsApi';
import type { CalendarStackParamList } from '../../app/CalendarStack';
import { Map, Settings2, ArrowRight, Calendar, MapPin, User, Clock, ChevronRight } from 'lucide-react-native';
import Card from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';
import Spinner from '../../components/ui/Spinner';
import { useThemeColors, useThemeStore, type ThemeColors } from '../../shared/theme/store';

function toDateOnlyIso(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function startOfWeekMonday(d: Date) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfWeekSunday(d: Date) {
  const start = startOfWeekMonday(d);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
}

export default function CalendarScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<CalendarStackParamList>>();
  const colors = useThemeColors();
  const theme = useThemeStore((s) => s.theme);
  const isDark = theme === 'dark';
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);

  const technicianId = useSessionStore((s) => s.technicianId);
  const [selectedDateStr, setSelectedDateStr] = useState(toDateOnlyIso(new Date()));

  // We fetch a 30-day window around today for smooth scrolling
  const { dateFrom, dateTo } = useMemo(() => {
    const now = new Date();
    const from = new Date(now);
    from.setDate(now.getDate() - 7);
    const to = new Date(now);
    to.setDate(now.getDate() + 21);
    return { dateFrom: toDateOnlyIso(from), dateTo: toDateOnlyIso(to) };
  }, []);

  const plannedServicesQuery = useQuery({
    queryKey: ['servicerecords', 'planned-range-cal', dateFrom, dateTo, technicianId],
    queryFn: ({ signal }) =>
      fetchServiceRecords({ plannedFrom: dateFrom, plannedTo: dateTo, technicianId: technicianId ?? undefined }, signal),
  });

  const isLoading = plannedServicesQuery.isLoading;
  const planned = plannedServicesQuery.data ?? [];

  const daysList = useMemo(() => {
    const start = new Date(dateFrom);
    const end = new Date(dateTo);
    const list: { dateStr: string; label: string; dateObj: Date }[] = [];
    
    const dayNames = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
    const monthNames = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = toDateOnlyIso(d);
      const dayName = dayNames[d.getDay()];
      const dayNum = d.getDate();
      const monthName = monthNames[d.getMonth()];
      list.push({
        dateStr,
        label: `${dayNum} ${monthName} ${dayName}`,
        dateObj: new Date(d),
      });
    }
    return list;
  }, [dateFrom, dateTo]);

  const dayStats = useMemo(() => {
    const map: Record<string, number> = {};
    for (const item of planned) {
      if (item.plannedAt) {
        const d = item.plannedAt.substring(0, 10);
        map[d] = (map[d] || 0) + 1;
      } else if (item.routeDate) {
        const d = item.routeDate;
        map[d] = (map[d] || 0) + 1;
      }
    }
    return map;
  }, [planned]);

  const selectedDateStops = useMemo(() => {
    return planned.filter(s => 
      s.plannedAt?.substring(0, 10) === selectedDateStr ||
      s.routeDate === selectedDateStr
    );
  }, [planned, selectedDateStr]);

  const selectedDateFormatted = useMemo(() => {
    const found = daysList.find(d => d.dateStr === selectedDateStr);
    return found ? found.label : selectedDateStr.split('-').reverse().join('.');
  }, [selectedDateStr, daysList]);

  return (
    <SafeAreaView style={styles.safe}>
      {/* Ambient Orbs */}
      <View style={[styles.orb, styles.orb1]} />
      <View style={[styles.orb, styles.orb2]} />

      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Planlama Takvimi</Text>
          <Text style={styles.subtitle}>Günlük görevlerinizi ve iş yükünüzü takip edin</Text>
        </View>

        {/* Horizontal Days Strip */}
        <View style={styles.stripWrapper}>
          <ScrollView 
            horizontal 
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.horizontalScroll}
          >
            {daysList.map((d) => {
              const isSelected = d.dateStr === selectedDateStr;
              const hasTasks = (dayStats[d.dateStr] || 0) > 0;
              const dayNum = d.dateObj.getDate();
              // Abbreviated day name (Pzt, Sal...)
              const dayNamesShort = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
              const dayNameAbbr = dayNamesShort[d.dateObj.getDay()];

              return (
                <TouchableOpacity
                  key={d.dateStr}
                  onPress={() => setSelectedDateStr(d.dateStr)}
                  activeOpacity={0.7}
                  style={[
                    styles.dayCard,
                    isSelected && styles.dayCardActive,
                  ]}
                >
                  <Text style={[styles.dayAbbr, isSelected && styles.dayTextActive]}>{dayNameAbbr}</Text>
                  <Text style={[styles.dayNum, isSelected && styles.dayTextActive]}>{dayNum}</Text>
                  {hasTasks && (
                    <View style={[styles.dotIndicator, isSelected && styles.dotIndicatorActive]} />
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {isLoading ? (
          <Spinner style={styles.loader} />
        ) : (
          <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
            
            {/* Selected Date Header */}
            <View style={styles.sectionHeader}>
              <Calendar color={colors.accent} size={18} style={{ marginRight: 8 }} />
              <Text style={styles.sectionTitle}>{selectedDateFormatted}</Text>
            </View>

            {/* Daily Tasks List */}
            {selectedDateStops.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Clock color={colors.textMuted} size={28} style={{ marginBottom: 8 }} />
                <Text style={styles.emptyText}>Bu güne planlanmış bir görev bulunmuyor.</Text>
                <TouchableOpacity 
                  style={styles.routeBtn}
                  onPress={() => navigation.navigate('RouteDetail', { date: selectedDateStr } as any)}
                >
                  <Text style={styles.routeBtnText}>Rotayı İncele</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={{ gap: 12 }}>
                <View style={styles.actionsRow}>
                  <Text style={styles.countText}>{selectedDateStops.length} Görev Planlandı</Text>
                  <TouchableOpacity 
                    onPress={() => navigation.navigate('RouteDetail', { date: selectedDateStr } as any)}
                    style={styles.viewRouteLink}
                  >
                    <Text style={styles.viewRouteLinkText}>Sıralamayı Düzenle</Text>
                    <ChevronRight size={14} color={colors.accent} />
                  </TouchableOpacity>
                </View>

                {selectedDateStops.map((stop) => {
                  const plannedTime = stop.userRouteHour || (stop.plannedAt ? new Date(stop.plannedAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : '--:--');
                  const isDone = stop.userRouteTick ?? false;

                  return (
                    <TouchableOpacity
                      key={stop.id}
                      activeOpacity={0.8}
                      onPress={() => navigation.navigate('ServiceRecordDetail', { serviceId: stop.id } as any)}
                    >
                      <Card style={[styles.card, isDone && styles.cardDone]}>
                        <View style={styles.cardHeader}>
                          <View style={styles.timeTag}>
                            <Clock size={11} color={colors.accent} style={{ marginRight: 4 }} />
                            <Text style={styles.timeText}>{plannedTime}</Text>
                          </View>
                          <Badge 
                            label={stop.statusLabel ?? stop.status} 
                            type={
                              stop.status === 'Completed' || stop.status === 'Delivered' ? 'success' :
                              stop.status === 'InProgress' || stop.status === 'InRepair' ? 'warning' :
                              'neutral'
                            } 
                          />
                        </View>
                        <Text style={styles.cardMainText} numberOfLines={1}>{stop.customerName ?? 'İsimsiz Müşteri'}</Text>
                        <Text style={styles.cardSubText} numberOfLines={1}>{stop.productName ?? 'Ürün Belirtilmemiş'}</Text>
                        
                        <View style={styles.cardFooter}>
                          <MapPin size={12} color={colors.textMuted} style={{ marginRight: 4 }} />
                          <Text style={styles.cardFooterText} numberOfLines={1}>{stop.customerAddress || stop.regionName || '-'}</Text>
                        </View>
                        
                        <ArrowRight color="rgba(255,255,255,0.15)" size={16} style={styles.cardArrow} />
                      </Card>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
            
          </ScrollView>
        )}
      </View>
    </SafeAreaView>
  );
}

const createStyles = (colors: ThemeColors, isDark: boolean) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },
    orb: { position: 'absolute', borderRadius: 9999 },
    orb1: { top: '-10%', left: '-10%', width: '60%', height: '40%', backgroundColor: isDark ? 'rgba(183, 58, 11, 0.05)' : 'rgba(183, 58, 11, 0.02)' },
    orb2: { bottom: '0%', right: '-20%', width: '70%', height: '50%', backgroundColor: isDark ? 'rgba(122, 12, 12, 0.05)' : 'rgba(122, 12, 12, 0.02)' },

    container: { flex: 1, paddingHorizontal: 16, maxWidth: 650, width: '100%', alignSelf: 'center' },
    header: { marginTop: 12, marginBottom: 16 },
    title: { fontSize: 24, fontWeight: '800', color: colors.text },
    subtitle: { fontSize: 13, color: colors.textMuted, marginTop: 4, fontWeight: '500' },

    stripWrapper: {
      marginBottom: 20,
      backgroundColor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)',
      borderRadius: 16,
      paddingVertical: 10,
      borderWidth: 1,
      borderColor: colors.inputBorder,
    },
    horizontalScroll: {
      paddingHorizontal: 12,
      gap: 10,
    },
    dayCard: {
      width: 50,
      height: 65,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
      borderWidth: 1,
      borderColor: colors.inputBorder,
    },
    dayCardActive: {
      backgroundColor: colors.accent,
      borderColor: colors.accent,
      shadowColor: colors.accent,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.25,
      shadowRadius: 8,
      elevation: 4,
    },
    dayAbbr: {
      fontSize: 10,
      fontWeight: 'bold',
      color: colors.textMuted,
      textTransform: 'uppercase',
    },
    dayNum: {
      fontSize: 18,
      fontWeight: '800',
      color: colors.text,
      marginTop: 2,
    },
    dayTextActive: {
      color: '#fff',
    },
    dotIndicator: {
      width: 4,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.accent,
      position: 'absolute',
      bottom: 8,
    },
    dotIndicatorActive: {
      backgroundColor: '#fff',
    },

    loader: { marginTop: 40 },
    scrollContent: { paddingBottom: 40 },

    sectionHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, marginTop: 4 },
    sectionTitle: { fontSize: 16, fontWeight: '800', color: colors.text },
    emptyContainer: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 48,
      backgroundColor: isDark ? 'rgba(255,255,255,0.01)' : 'rgba(0,0,0,0.01)',
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.inputBorder,
      borderStyle: 'dashed',
    },
    emptyText: { color: colors.textMuted, fontSize: 13, textAlign: 'center', paddingHorizontal: 20 },
    routeBtn: {
      marginTop: 16,
      paddingHorizontal: 20,
      paddingVertical: 8,
      backgroundColor: colors.accent,
      borderRadius: 10,
    },
    routeBtnText: { color: '#fff', fontSize: 12, fontWeight: 'bold' },

    actionsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
    countText: { fontSize: 12, fontWeight: 'bold', color: colors.textMuted },
    viewRouteLink: { flexDirection: 'row', alignItems: 'center', gap: 2 },
    viewRouteLinkText: { fontSize: 12, fontWeight: 'bold', color: colors.accent },

    card: {
      paddingRight: 40,
      position: 'relative',
    },
    cardDone: {
      opacity: 0.65,
    },
    cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
    timeTag: { 
      flexDirection: 'row', 
      alignItems: 'center', 
      backgroundColor: colors.bg,
      paddingHorizontal: 8, 
      paddingVertical: 3, 
      borderRadius: 6,
      borderWidth: 1,
      borderColor: colors.inputBorder,
    },
    timeText: { fontSize: 11, fontWeight: '800', color: colors.text, fontFamily: 'monospace' },
    
    cardMainText: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 4 },
    cardSubText: { fontSize: 13, color: colors.textSub, marginBottom: 8 },
    cardFooter: { flexDirection: 'row', alignItems: 'center' },
    cardFooterText: { fontSize: 11, color: colors.textMuted, flex: 1 },
    cardArrow: { position: 'absolute', right: 16, top: '50%', marginTop: -8 },
  });
