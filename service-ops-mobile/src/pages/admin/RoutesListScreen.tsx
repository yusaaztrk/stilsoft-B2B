import React, { useMemo, useState, useEffect, useRef } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Alert,
  TextInput,
  Modal,
  Platform,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { 
  fetchServiceRecords, 
  updateUserRoutePlan, 
  bulkUpdateUserRoutePlan, 
  updateServiceRecordStatus, 
  assignTechnician, 
  bulkAssignTechnician, 
  type ServiceRecord 
} from '../technician/serviceRecordsApi';
import { fetchRouteById } from '../technician/routesApi';
import { fetchTechnicians } from './techniciansApi';
import { fetchRegions, type RegionOption } from './planningApi';
import { useSessionStore } from '../../shared/session/store';
import type { RoutesStackParamList } from '../../app/RoutesStack';
import { 
  ArrowLeft, 
  Navigation, 
  MapPin, 
  AlertCircle, 
  ChevronRight, 
  GripVertical, 
  CheckSquare, 
  Square, 
  Clock, 
  Map as MapIcon, 
  X, 
  ChevronLeft, 
  ChevronRight as ChevronRightIcon, 
  Plus, 
  Maximize2,
  Filter,
  Wrench,
  CheckCircle,
  User,
  Sliders,
  Calendar,
  Info,
  RefreshCw,
  Layers,
  ArrowUp,
  ArrowDown,
  Check
} from 'lucide-react-native';
import DatePickerModal from '../../components/ui/DatePickerModal';
import { WebView } from 'react-native-webview';
import Card from '../../components/ui/Card';
import Badge, { BadgeType } from '../../components/ui/Badge';
import Spinner from '../../components/ui/Spinner';
import ProgressBar from '../../components/ui/ProgressBar';
import { useThemeColors, useThemeStore, type ThemeColors } from '../../shared/theme/store';
import { getStatusLabel } from '../../shared/utils/statusTranslator';

const STOP_STATUS_MAPPING: Record<string, { type: BadgeType; label: string }> = {
  Pending: { type: 'neutral', label: 'Bekliyor' },
  Planned: { type: 'neutral', label: 'Planlandı' },
  InProgress: { type: 'warning', label: 'Devam Ediyor' },
  Completed: { type: 'success', label: 'Tamamlandı' },
  Delayed: { type: 'error', label: 'Gecikti' },
  Cancelled: { type: 'neutral', label: 'İptal' },
};

const SERVICE_TYPES = [
  { value: 'all', label: 'Tümü' },
  { value: 'Repair', label: 'Arıza' },
  { value: 'Installation', label: 'Montaj' },
  { value: 'Maintenance', label: 'Bakım' },
  { value: 'Warranty', label: 'Garanti' }
];

const STATUS_FILTER_OPTIONS = [
  { value: 'all', label: 'Tümü' },
  { value: 'Pending', label: 'Bekliyor' },
  { value: 'Planned', label: 'Planlandı' },
  { value: 'InProgress', label: 'Devam Ediyor' },
  { value: 'Completed', label: 'Tamamlandı' },
  { value: 'Cancelled', label: 'İptal' }
];

const HOUR_PRESETS = [
  { label: 'Sabah', sub: '09-12', start: '09:00', end: '12:00', color: '#f59e0b' },
  { label: 'Öğle', sub: '12-15', start: '12:00', end: '15:00', color: '#3b82f6' },
  { label: 'Akşam', sub: '15-18', start: '15:00', end: '18:00', color: '#a855f7' }
];

function getRecordCoords(record: any): [number, number] {
  let lat = record.latitude != null ? Number(record.latitude) : null;
  let lng = record.longitude != null ? Number(record.longitude) : null;

  const isWithinCyprusCoords = (la: number, ln: number) => la >= 34.0 && la <= 36.5 && ln >= 32.0 && ln <= 35.0;

  if (lat != null && lng != null && !isNaN(lat) && !isNaN(lng) && isWithinCyprusCoords(lat, lng) && lat !== 0 && lng !== 0) {
    return [lat, lng];
  }

  const addr = String(record.customerAddress || '').toLowerCase();
  const region = String(record.regionName || '').toLowerCase();

  const combinedText = `${addr} ${region}`;
  let baseCoords: [number, number] = [35.1856, 33.3823];

  if (combinedText.includes('mağusa') || combinedText.includes('magusa') || combinedText.includes('famagusta') || combinedText.includes('iskele') || combinedText.includes('trikomo')) {
    if (combinedText.includes('iskele') || combinedText.includes('trikomo')) {
      baseCoords = [35.2902, 33.8911];
    } else {
      baseCoords = [35.1250, 33.9380];
    }
  } else if (combinedText.includes('girne') || combinedText.includes('kyrenia')) {
    baseCoords = [35.3381, 33.3186];
  } else if (combinedText.includes('güzelyurt') || combinedText.includes('guzelyurt') || combinedText.includes('morphou')) {
    baseCoords = [35.1997, 32.9984];
  } else if (combinedText.includes('lefke') || combinedText.includes('lefka')) {
    baseCoords = [35.1130, 32.8500];
  } else if (combinedText.includes('lefkoşa') || combinedText.includes('lefkosa') || combinedText.includes('nicosia')) {
    baseCoords = [35.1856, 33.3823];
  }

  let hash = 0;
  const idStr = String(record.id || '');
  for (let i = 0; i < idStr.length; i++) {
    hash = idStr.charCodeAt(i) + ((hash << 5) - hash);
  }
  const angle = (Math.abs(hash) % 360) * (Math.PI / 180);
  const radius = 0.001 + ((Math.abs(hash >> 3) % 100) / 100) * 0.004;
  const offsetLat = Math.sin(angle) * radius;
  const offsetLng = Math.cos(angle) * radius;

  return [baseCoords[0] + offsetLat, baseCoords[1] + offsetLng];
}

export default function RoutesListScreen() {
  const colors = useThemeColors();
  const theme = useThemeStore((s) => s.theme);
  const isDark = theme === 'dark';
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);

  const navigation = useNavigation<NativeStackNavigationProp<RoutesStackParamList>>();
  const route = useRoute<RouteProp<RoutesStackParamList, 'RoutesHome'>>();
  
  const { routeId, date, technicianId: paramTechId } = (route.params ?? {}) as any;
  const initialDate = date ?? new Date().toISOString().substring(0, 10);
  const [currentDateStr, setCurrentDateStr] = useState(initialDate);

  const sessionTechnicianId = useSessionStore((s) => s.technicianId);
  const role = useSessionStore((s) => s.role);
  const isTechMode = role?.toLowerCase() === 'technician';
  const qc = useQueryClient();

  // Tab State: 'map' = Harita Görünümü, 'plan' = Rota Belirle
  const [activeTab, setActiveTab] = useState<'map' | 'plan'>('map');

  // Filters Collapsed State (Default to false on the main panel just like web!)
  const [isFilterCollapsed, setIsFilterCollapsed] = useState(false);

  // Filters State
  const [selectedRegionId, setSelectedRegionId] = useState<string>('all');
  const [selectedTechFilterId, setSelectedTechFilterId] = useState<string>('all');
  const [customerFilterText, setCustomerFilterText] = useState<string>('');
  const [productFilterText, setProductFilterText] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Modal open states
  const [regionModalOpen, setRegionModalOpen] = useState(false);
  const [techModalOpen, setTechModalOpen] = useState(false);
  const [serviceTypeModalOpen, setServiceTypeModalOpen] = useState(false);
  const [statusFilterModalOpen, setStatusFilterModalOpen] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  // Modal search variables
  const [regionSearch, setRegionSearch] = useState('');
  const [techSearch, setTechSearch] = useState('');

  // Overdue and Sorting States
  const [isOverdueModalOpen, setIsOverdueModalOpen] = useState(false);
  const [isSortModalOpen, setIsSortModalOpen] = useState(false);
  const [rescheduleDates, setRescheduleDates] = useState<Record<string, string>>({});
  const [rescheduleLoadingId, setRescheduleLoadingId] = useState<string | null>(null);
  const [datePickerForOverdueOpen, setDatePickerForOverdueOpen] = useState(false);
  const [overdueRescheduleActiveId, setOverdueRescheduleActiveId] = useState<string | null>(null);

  // Pool multi-select state
  const [selectedPoolStops, setSelectedPoolStops] = useState<string[]>([]);
  const [poolSearchQuery, setPoolSearchQuery] = useState('');

  // Load route details if routeId is supplied
  const routeQuery = useQuery({
    queryKey: ['admin-route-detail', routeId],
    queryFn: ({ signal }) => fetchRouteById(routeId!, signal),
    enabled: !!routeId,
  });

  // Sync date/technician from route detail if supplied
  useEffect(() => {
    if (routeQuery.data) {
      if (routeQuery.data.plannedDate) {
        setCurrentDateStr(routeQuery.data.plannedDate.substring(0, 10));
      }
      if (routeQuery.data.technicianId) {
        setSelectedTechFilterId(routeQuery.data.technicianId);
      }
    }
  }, [routeQuery.data]);

  // If technician param or session id is active and no filter is set yet, initialize it!
  useEffect(() => {
    if (isTechMode && sessionTechnicianId) {
      setSelectedTechFilterId(sessionTechnicianId);
    } else if (selectedTechFilterId === 'all') {
      if (paramTechId) {
        setSelectedTechFilterId(paramTechId);
      } else if (sessionTechnicianId) {
        setSelectedTechFilterId(sessionTechnicianId);
      }
    }
  }, [isTechMode, sessionTechnicianId, paramTechId]);

  // Derived selected technician ID for planning:
  const resolvedTechId = selectedTechFilterId !== 'all' ? selectedTechFilterId : null;

  // Load Regions & Technicians lists for filters
  const regionsQuery = useQuery({
    queryKey: ['admin', 'routes', 'regions'],
    queryFn: ({ signal }) => fetchRegions(signal),
  });
  const regions = regionsQuery.data ?? [];

  const techsQuery = useQuery({
    queryKey: ['admin', 'routes', 'technicians'],
    queryFn: ({ signal }) => fetchTechnicians(undefined, signal),
  });
  const technicians = techsQuery.data ?? [];

  // Filtered Technicians (for Admin Mode homepage grid)
  const selectedRegionName = useMemo(() => {
    if (selectedRegionId === 'all') return 'all';
    return regions.find(r => r.id === selectedRegionId)?.name || 'all';
  }, [selectedRegionId, regions]);

  const filteredTechnicians = useMemo(() => {
    return technicians.filter(tech => {
      if (selectedRegionId !== 'all' && tech.primaryRegionId !== selectedRegionId && tech.regionName !== selectedRegionName) return false;
      if (selectedTechFilterId !== 'all' && tech.id !== selectedTechFilterId) return false;
      return true;
    });
  }, [technicians, selectedRegionId, selectedRegionName, selectedTechFilterId]);

  // Load stops for selected date & technician (specifically for Rota Belirle sequence)
  const stopsQuery = useQuery({
    queryKey: ['servicerecords', 'planned-date', currentDateStr, resolvedTechId],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchServiceRecords({ 
        plannedFrom: `${currentDateStr}T00:00:00.000Z`, 
        plannedTo: `${currentDateStr}T23:59:59.999Z`, 
        technicianId: resolvedTechId ?? undefined 
      }, signal),
    enabled: !!currentDateStr && !!resolvedTechId,
  });

  const rawStops = stopsQuery.data ?? [];

  // Load ALL stops for selected date (for stats and pool)
  const allStopsQuery = useQuery({
    queryKey: ['servicerecords', 'all-stops-day', currentDateStr],
    queryFn: ({ signal }) =>
      fetchServiceRecords({ 
        plannedFrom: `${currentDateStr}T00:00:00.000Z`, 
        plannedTo: `${currentDateStr}T23:59:59.999Z`
      }, signal),
    enabled: !!currentDateStr,
  });

  const allStops = allStopsQuery.data ?? [];

  // Filtered Stops List (Client-side dynamic filtering)
  const filteredStopsList = useMemo(() => {
    return allStops.filter(s => {
      const matchRegion = selectedRegionName === 'all' || s.regionName === selectedRegionName;
      const matchTech = selectedTechFilterId === 'all' || s.assignedTechnicianId === selectedTechFilterId;
      const matchCustomer = !customerFilterText.trim() || (s.customerName || '').toLowerCase().includes(customerFilterText.toLowerCase());
      const matchProduct = !productFilterText.trim() || (s.productName || '').toLowerCase().includes(productFilterText.toLowerCase());
      const matchType = typeFilter === 'all' || s.type === typeFilter;
      const matchStatus = statusFilter === 'all' || s.status === statusFilter;
      return matchRegion && matchTech && matchCustomer && matchProduct && matchType && matchStatus;
    });
  }, [allStops, selectedRegionId, selectedTechFilterId, customerFilterText, productFilterText, typeFilter, statusFilter]);

  const unassignedPoolStops = useMemo(() => {
    return allStops.filter(r => {
      if (r.status === 'Delivered' || r.status === 'Ready' || r.status === 'Cancelled') return false;

      // Exclude overdue stops from pool list
      const todayStr = new Date().toISOString().substring(0, 10);
      const originalDate = r.routeDate || (r.plannedAt ? r.plannedAt.substring(0, 10) : null);
      if (originalDate) {
        const isPastDate = originalDate < todayStr;
        const isTodayTimePassed = (() => {
          if (originalDate === todayStr && r.userRouteHour) {
            const parts = r.userRouteHour.split(':');
            if (parts.length >= 2) {
              const stopTimeMins = parseInt(parts[0]) * 60 + parseInt(parts[1]);
              const now = new Date();
              const nowMins = now.getHours() * 60 + now.getMinutes();
              return nowMins > stopTimeMins;
            }
          }
          return false;
        })();
        if (isPastDate || isTodayTimePassed) return false;
      }

      if (isTechMode) {
        return r.assignedTechnicianId === sessionTechnicianId && originalDate !== currentDateStr;
      } else {
        if (resolvedTechId) {
          return !r.assignedTechnicianId || (r.assignedTechnicianId === resolvedTechId && originalDate !== currentDateStr);
        }
        return !r.assignedTechnicianId;
      }
    });
  }, [allStops, isTechMode, sessionTechnicianId, resolvedTechId, currentDateStr]);

  const filteredPoolStops = useMemo(() => {
    if (!poolSearchQuery.trim()) return unassignedPoolStops;
    const q = poolSearchQuery.toLowerCase();
    return unassignedPoolStops.filter(stop => 
      stop.serviceNumber?.toLowerCase().includes(q) ||
      stop.customerName?.toLowerCase().includes(q) ||
      stop.customerAddress?.toLowerCase().includes(q) ||
      stop.productName?.toLowerCase().includes(q)
    );
  }, [unassignedPoolStops, poolSearchQuery]);

  const overdueStops = useMemo(() => {
    if (!resolvedTechId) return [];
    const todayStr = new Date().toISOString().substring(0, 10);
    return allStops.filter(r => {
      if (r.assignedTechnicianId !== resolvedTechId) return false;
      if (r.status === 'Ready' || r.status === 'Delivered' || r.status === 'Cancelled') return false;
      const origDate = r.routeDate || (r.plannedAt ? r.plannedAt.substring(0, 10) : null);
      if (!origDate) return false;
      
      const isPastDate = origDate < todayStr;
      const isTodayTimePassed = (() => {
        if (origDate === todayStr && r.userRouteHour) {
          const parts = r.userRouteHour.split(':');
          if (parts.length >= 2) {
            const stopTimeMins = parseInt(parts[0]) * 60 + parseInt(parts[1]);
            const now = new Date();
            const nowMins = now.getHours() * 60 + now.getMinutes();
            return nowMins > stopTimeMins;
          }
        }
        return false;
      })();
      
      return isPastDate || isTodayTimePassed;
    });
  }, [allStops, resolvedTechId]);

  const statsSummary = useMemo(() => {
    const total = filteredStopsList.length;
    const unassigned = filteredStopsList.filter(s => !s.assignedTechnicianId || s.assignedTechnicianId === '00000000-0000-0000-0000-000000000000').length;
    const assigned = total - unassigned;
    const completed = filteredStopsList.filter(r => r.status === 'Ready' || r.status === 'Delivered').length;
    const inProgress = filteredStopsList.filter(r => r.status === 'InProgress' || r.status === 'Workshop' || r.status === 'InRepair').length;
    return { total, unassigned, assigned, completed, inProgress };
  }, [filteredStopsList]);

  // Local reorderable stops state
  const [localStops, setLocalStops] = useState<ServiceRecord[]>([]);
  const [activeDragIndex, setActiveDragIndex] = useState<number | null>(null);
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const [mapModalVisible, setMapModalVisible] = useState(false);
  const [poolModalVisible, setPoolModalVisible] = useState(false);

  // Sync query data into local state when it changes
  useEffect(() => {
    if (rawStops) {
      const filtered = rawStops.filter(r => 
        r.routeDate === currentDateStr || 
        (r.plannedAt && r.plannedAt.substring(0, 10) === currentDateStr)
      );
      const sorted = [...filtered].sort((a, b) => {
        if (isTechMode) {
          const orderA = a.userRouteSortOrder ?? 99999;
          const orderB = b.userRouteSortOrder ?? 99999;
          if (orderA !== orderB) return orderA - orderB;

          const hourA = a.userRouteHour ?? '99:99';
          const hourB = b.userRouteHour ?? '99:99';
          return hourA.localeCompare(hourB);
        } else {
          const orderA = a.routeOrder ?? 99999;
          const orderB = b.routeOrder ?? 99999;
          if (orderA !== orderB) return orderA - orderB;

          const hourA = a.plannedStartTime ?? '99:99';
          const hourB = b.plannedStartTime ?? '99:99';
          return hourA.localeCompare(hourB);
        }
      });
      setLocalStops(sorted);
    }
  }, [rawStops, currentDateStr, isTechMode]);

  function calculateHaversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  const estimatedRouteLength = useMemo(() => {
    let total = 0;
    if (localStops.length <= 1) return 0;
    for (let i = 0; i < localStops.length - 1; i++) {
      const p1 = getRecordCoords(localStops[i]);
      const p2 = getRecordCoords(localStops[i + 1]);
      total += calculateHaversineDistance(p1[0], p1[1], p2[0], p2[1]);
    }
    return Math.round(total * 10) / 10;
  }, [localStops]);

  // Touch Drag-and-drop state refs
  const startYRef = useRef<number>(0);
  const activeDragIndexRef = useRef<number | null>(null);
  const localStopsRef = useRef<ServiceRecord[]>([]);
  localStopsRef.current = localStops;

  const [arrivalInputs, setArrivalInputs] = useState<Record<string, string>>({});

  const changeDate = (direction: 'prev' | 'next') => {
    const d = new Date(currentDateStr);
    d.setDate(d.getDate() + (direction === 'prev' ? -1 : 1));
    setCurrentDateStr(d.toISOString().substring(0, 10));
  };

  // Touch gesture handlers for finger DND reordering
  const handleTouchStart = (index: number, pageY: number) => {
    startYRef.current = pageY;
    activeDragIndexRef.current = index;
    setActiveDragIndex(index);
    setScrollEnabled(false);
  };

  const handleTouchMove = (pageY: number) => {
    const activeIndex = activeDragIndexRef.current;
    if (activeIndex === null) return;

    const deltaY = pageY - startYRef.current;
    const cardHeight = 120; // assumed touch height limit

    if (deltaY > cardHeight && activeIndex < localStopsRef.current.length - 1) {
      const nextIndex = activeIndex + 1;
      const reordered = [...localStopsRef.current];
      const temp = reordered[activeIndex];
      reordered[activeIndex] = reordered[nextIndex];
      reordered[nextIndex] = temp;

      setLocalStops(reordered);
      startYRef.current = pageY;
      activeDragIndexRef.current = nextIndex;
      setActiveDragIndex(nextIndex);
    } else if (deltaY < -cardHeight && activeIndex > 0) {
      const prevIndex = activeIndex - 1;
      const reordered = [...localStopsRef.current];
      const temp = reordered[activeIndex];
      reordered[activeIndex] = reordered[prevIndex];
      reordered[prevIndex] = temp;

      setLocalStops(reordered);
      startYRef.current = pageY;
      activeDragIndexRef.current = prevIndex;
      setActiveDragIndex(prevIndex);
    }
  };

  const handleTouchEnd = async () => {
    const activeIndex = activeDragIndexRef.current;
    if (activeIndex === null) return;

    activeDragIndexRef.current = null;
    setActiveDragIndex(null);
    setScrollEnabled(true);

    try {
      if (isTechMode) {
        const items = localStopsRef.current.map((item, idx) => ({
          serviceRecordId: item.id,
          userRouteSortOrder: idx + 1,
        }));
        await bulkUpdateUserRoutePlan(items);
      } else {
        const items = localStopsRef.current.map((item, idx) => ({
          serviceRecordId: item.id,
          technicianId: resolvedTechId || '',
          routeDate: currentDateStr,
          routeOrder: idx + 1,
        }));
        await bulkAssignTechnician(items);
      }
      qc.invalidateQueries({ queryKey: ['servicerecords', 'planned-date', currentDateStr, resolvedTechId] });
      qc.invalidateQueries({ queryKey: ['servicerecords', 'all-stops-day', currentDateStr] });
    } catch (err) {
      console.warn('Failed to update stop sequence', err);
      Alert.alert('Hata', 'Rota sıralaması güncellenemedi.');
      stopsQuery.refetch();
    }
  };

  const handleReorderStopsOfficial = async (draggedIndex: number, targetIndex: number) => {
    if (draggedIndex === targetIndex || targetIndex < 0 || targetIndex >= localStops.length) return;
    const updatedStops = [...localStops];
    const [removed] = updatedStops.splice(draggedIndex, 1);
    updatedStops.splice(targetIndex, 0, removed);

    setLocalStops(updatedStops);

    try {
      if (isTechMode) {
        const bulkItems = updatedStops.map((stop, idx) => ({
          serviceRecordId: stop.id,
          userRouteSortOrder: idx + 1
        }));
        await bulkUpdateUserRoutePlan(bulkItems);
      } else {
        const bulkItems = updatedStops.map((stop, idx) => ({
          serviceRecordId: stop.id,
          technicianId: resolvedTechId || '',
          routeDate: currentDateStr,
          routeOrder: idx + 1
        }));
        await bulkAssignTechnician(bulkItems);
      }
      qc.invalidateQueries({ queryKey: ['servicerecords', 'planned-date', currentDateStr, resolvedTechId] });
      qc.invalidateQueries({ queryKey: ['servicerecords', 'all-stops-day', currentDateStr] });
    } catch (err: any) {
      console.error('Yeniden siralama hatasi:', err);
      Alert.alert('Hata', 'Sıralama güncellenemedi.');
      stopsQuery.refetch();
    }
  };

  const updateRouteHour = async (stopId: string, startTime: string, endTime: string | null = null) => {
    const regex = /^([0-9]|0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$/;
    if (startTime && !regex.test(startTime)) {
      Alert.alert('Geçersiz Saat', 'Saat formatı SS:DD (örn: 14:30) olmalıdır.');
      return;
    }
    if (endTime && !regex.test(endTime)) {
      Alert.alert('Geçersiz Saat', 'Saat formatı SS:DD (örn: 14:30) olmalıdır.');
      return;
    }

    try {
      if (isTechMode) {
        await updateUserRoutePlan(stopId, { userRouteHour: startTime || null });
      } else {
        await assignTechnician(stopId, {
          technicianId: resolvedTechId || '',
          routeDate: currentDateStr,
          plannedStartTime: startTime || null,
          plannedEndTime: endTime || null,
        });
      }
      await qc.invalidateQueries({ queryKey: ['servicerecords', 'planned-date', currentDateStr, resolvedTechId] });
      await qc.invalidateQueries({ queryKey: ['servicerecords', 'all-stops-day', currentDateStr] });
      setArrivalInputs(prev => {
        const copy = { ...prev };
        delete copy[stopId];
        return copy;
      });
    } catch (e) {
      console.warn('Failed to update plan time', e);
      Alert.alert('Hata', 'Plan saati güncellenemedi.');
    }
  };

  const toggleStopTick = async (stopId: string, currentTick: boolean) => {
    try {
      await updateUserRoutePlan(stopId, { userRouteTick: !currentTick });
      await qc.invalidateQueries({ queryKey: ['servicerecords', 'planned-date', currentDateStr, resolvedTechId] });
    } catch (e) {
      console.warn('Failed to toggle stop tick', e);
      Alert.alert('Hata', 'Plan durumu güncellenemedi.');
    }
  };

  const getDisplayArrival = (stop: ServiceRecord) => {
    if (arrivalInputs[stop.id] !== undefined) {
      return arrivalInputs[stop.id];
    }
    if (isTechMode) {
      return stop.userRouteHour ? stop.userRouteHour.substring(0, 5) : '';
    } else {
      return stop.plannedStartTime ? stop.plannedStartTime.substring(0, 5) : '';
    }
  };

  const progressPercentage = useMemo(() => {
    if (localStops.length === 0) return 0;
    const completed = localStops.filter((s) => s.status === 'Ready' || s.status === 'Delivered').length;
    return Math.round((completed / localStops.length) * 100);
  }, [localStops]);

  // Reschedule overdue stop logic
  const handleRescheduleOverdue = async (stopId: string) => {
    const newDate = rescheduleDates[stopId];
    if (!newDate) return;
    setRescheduleLoadingId(stopId);
    try {
      await assignTechnician(stopId, {
        technicianId: resolvedTechId || '',
        routeDate: newDate,
        routeOrder: null,
      });
      await qc.invalidateQueries({ queryKey: ['servicerecords'] });
      setRescheduleDates(prev => {
        const copy = { ...prev };
        delete copy[stopId];
        return copy;
      });
      Alert.alert('Başarılı', 'İş başarıyla ertelendi.');
    } catch (err: any) {
      Alert.alert('Hata', err.message || 'Ertelenirken hata oluştu.');
    } finally {
      setRescheduleLoadingId(null);
    }
  };

  const toggleSelectPoolStop = (id: string) => {
    setSelectedPoolStops(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  // Add multiple stops from pool
  const handleAssignPoolStops = async () => {
    if (selectedPoolStops.length === 0) return;
    if (!resolvedTechId) return;

    const currentMaxOrder = localStops.reduce((max, stop) => {
      const order = isTechMode ? stop.userRouteSortOrder : stop.routeOrder;
      return order && order > max ? order : max;
    }, 0);

    try {
      if (isTechMode) {
        const bulkItems = selectedPoolStops.map((id, index) => ({
          serviceRecordId: id,
          userRouteSortOrder: currentMaxOrder + index + 1
        }));
        await bulkUpdateUserRoutePlan(bulkItems);
      } else {
        const bulkItems = selectedPoolStops.map((id, index) => ({
          serviceRecordId: id,
          technicianId: resolvedTechId,
          routeDate: currentDateStr,
          routeOrder: currentMaxOrder + index + 1
        }));
        await bulkAssignTechnician(bulkItems);
      }
      qc.invalidateQueries({ queryKey: ['servicerecords', 'planned-date', currentDateStr, resolvedTechId] });
      qc.invalidateQueries({ queryKey: ['servicerecords', 'all-stops-day', currentDateStr] });
      setSelectedPoolStops([]);
      setPoolModalVisible(false);
      Alert.alert('Başarılı', 'Seçilen işler zaman çizelgesine eklendi.');
    } catch (err: any) {
      Alert.alert('Hata', err.message || 'Atama başarısız oldu.');
    }
  };

  // Leaflet map injection HTML
  const mapHtml = useMemo(() => {
    const filteredStops = allStops.filter(s => {
      const matchRegion = selectedRegionName === 'all' || s.regionName === selectedRegionName;
      const matchTech = selectedTechFilterId === 'all' || s.assignedTechnicianId === selectedTechFilterId;
      const matchCustomer = !customerFilterText.trim() || (s.customerName || '').toLowerCase().includes(customerFilterText.toLowerCase());
      const matchProduct = !productFilterText.trim() || (s.productName || '').toLowerCase().includes(productFilterText.toLowerCase());
      const matchType = typeFilter === 'all' || s.type === typeFilter;
      const matchStatus = statusFilter === 'all' || s.status === statusFilter;
      return matchRegion && matchTech && matchCustomer && matchProduct && matchType && matchStatus;
    });

    const filteredTechs = technicians.filter(t => {
      const matchTech = selectedTechFilterId === 'all' || t.id === selectedTechFilterId;
      return matchTech && t.currentLatitude != null && t.currentLongitude != null;
    });

    const stopsData = filteredStops.map((s, idx) => {
      const coords = getRecordCoords(s);
      return {
        id: s.id,
        seq: s.assignedTechnicianId ? (isTechMode ? (s.userRouteSortOrder || (idx + 1)) : (s.routeOrder || (idx + 1))) : '?',
        lat: coords[0],
        lng: coords[1],
        title: s.customerName || 'Müşteri',
        address: s.customerAddress || '',
        status: s.status || 'Planned',
        type: s.type === 'Installation' ? 'Montaj' : 'Arıza',
        isPool: !s.assignedTechnicianId || s.assignedTechnicianId === '00000000-0000-0000-0000-000000000000'
      };
    });

    const techsData = filteredTechs.map(t => ({
      name: t.fullName,
      initials: t.initials ?? `${t.firstName ? t.firstName[0] : ''}${t.lastName ? t.lastName[0] : ''}`.toUpperCase(),
      lat: t.currentLatitude,
      lng: t.currentLongitude,
      status: t.statusLabel ?? t.status
    }));

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
        <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
        <style>
          body, html, #map { margin: 0; padding: 0; width: 100%; height: 100%; background: #0b0f19; }
          .custom-marker {
            width: 28px;
            height: 28px;
            border-radius: 50%;
            background: #B91C1C;
            border: 2px solid white;
            color: white;
            font-weight: bold;
            font-size: 12px;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 2px 6px rgba(0,0,0,0.5);
          }
          .marker-blue { background: #3b82f6; }
          .marker-orange { background: #f97316; }
          .marker-yellow { background: #eab308; color: black; }
          .marker-green { background: #10b981; }
          .marker-red { background: #ef4444; }
          .marker-gray { background: #94a3b8; }
          .marker-pool { background: #475569; border: 2px dashed #f43f5e; color: #fff; }
          .marker-tech { background: #8b5cf6; border: 2.5px solid white; color: white; width: 32px; height: 32px; font-size: 11px; z-index: 9999 !important; }
          .leaflet-popup-content-wrapper {
            background: #1e293b;
            color: #f8fafc;
            border-radius: 8px;
            border: 1px solid #334155;
            font-family: sans-serif;
          }
          .leaflet-popup-tip {
            background: #1e293b;
          }
        </style>
      </head>
      <body>
        <div id="map"></div>
        <script>
          const stops = ${JSON.stringify(stopsData)};
          const techs = ${JSON.stringify(techsData)};
          const drawPolyline = ${selectedTechFilterId !== 'all' ? 'true' : 'false'};
          
          const map = L.map('map', { zoomControl: false }).setView([35.1856, 33.3823], 10);
          L.control.zoom({ position: 'bottomright' }).addTo(map);

          L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap'
          }).addTo(map);

          const getMarkerColorClass = (status) => {
            const s = String(status || '').toLowerCase();
            if (s === 'pool') return 'marker-pool';
            if (s === 'new' || s === 'delayed' || s === 'waitingforparts') return 'marker-gray';
            if (s === 'planned') return 'marker-blue';
            if (s === 'inrepair') return 'marker-orange';
            if (s === 'workshop') return 'marker-yellow';
            if (s === 'ready' || s === 'delivered') return 'marker-green';
            if (s === 'cancelled') return 'marker-red';
            return 'marker-gray';
          };

          // Draw active technicians
          techs.forEach(t => {
            const icon = L.divIcon({
              className: 'custom-icon',
              html: \`<div class="custom-marker marker-tech">\${t.initials}</div>\`,
              iconSize: [32, 32],
              iconAnchor: [16, 16]
            });
            L.marker([t.lat, t.lng], { icon: icon })
              .addTo(map)
              .bindPopup(\`<div style="padding:2px;"><b style="color:#fff;">\${t.name} (Teknisyen)</b><br/><span style="color:#94a3b8;font-size:11px;">Aktif Konum</span></div>\`);
          });

          // Draw stops
          const points = [];
          stops.forEach(s => {
            if (s.lat && s.lng) {
              const colorClass = getMarkerColorClass(s.isPool ? 'pool' : s.status);
              
              const customIcon = L.divIcon({
                className: 'custom-icon',
                html: \`<div class="custom-marker \${colorClass}">\${s.seq}</div>\`,
                iconSize: [28, 28],
                iconAnchor: [14, 14]
              });

              const marker = L.marker([s.lat, s.lng], { icon: customIcon }).addTo(map);
              marker.bindPopup(\`
                <div style="padding: 2px;">
                  <b style="font-size: 13px; color: #fff;">#\${s.seq} \${s.title}</b><br/>
                  <span style="color: #94a3b8; font-size: 11px;">📍 \${s.address}</span><br/>
                  <span style="color: #cbd5e1; font-weight: bold; font-size: 11px;">Tür: \${s.type}</span>
                </div>
              \`);

              if (!s.isPool) {
                points.push([s.lat, s.lng]);
              }
            }
          });

          if (drawPolyline && points.length > 1) {
            L.polyline(points, {
              color: '#f43f5e',
              weight: 4,
              opacity: 0.85,
              dashArray: '8, 12'
            }).addTo(map);
          }

          // fit bounds to combined points
          const allPoints = [];
          techs.forEach(t => allPoints.push([t.lat, t.lng]));
          stops.forEach(s => allPoints.push([s.lat, s.lng]));
          
          if (allPoints.length > 0) {
            map.fitBounds(allPoints, { padding: [40, 40] });
          }
        </script>
      </body>
      </html>
    `;
  }, [allStops, technicians, selectedRegionId, selectedTechFilterId, customerFilterText, productFilterText, typeFilter, statusFilter, isTechMode]);

  return (
    <SafeAreaView style={styles.safe}>
      {/* Decorative Orbs */}
      <View style={[styles.orb, styles.orb1]} />
      <View style={[styles.orb, styles.orb2]} />

      {/* Header exactly like web header */}
      <View style={styles.header}>
        <View style={styles.headerLeftIconBlock}>
          <View style={styles.headerWebIconCircle}>
            <MapIcon color="#fff" size={22} />
          </View>
        </View>

        <View style={styles.headerTitleRow}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={styles.title}>Rota Planlama Modülü</Text>
            <View style={styles.webRoleBadge}>
              <Text style={styles.webRoleBadgeText}>{isTechMode ? 'Teknisyen' : 'Yönetici'}</Text>
            </View>
          </View>
          <Text style={styles.subtitle}>
            Teknisyenlerin günlük görev atamalarını, sıralarını ve rotalarını harita üzerinden yönetin.
          </Text>
        </View>
      </View>

      {/* Tab Selector Bar */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tabItem, activeTab === 'map' && styles.tabItemActive]}
          onPress={() => setActiveTab('map')}
        >
          <MapIcon color={activeTab === 'map' ? '#fff' : colors.textMuted} size={16} style={{ marginRight: 6 }} />
          <Text style={[styles.tabItemText, activeTab === 'map' && styles.tabItemTextActive]}>
            Harita Görünümü
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabItem, activeTab === 'plan' && styles.tabItemActive]}
          onPress={() => setActiveTab('plan')}
        >
          <Sliders color={activeTab === 'plan' ? '#fff' : colors.textMuted} size={16} style={{ marginRight: 6 }} />
          <Text style={[styles.tabItemText, activeTab === 'plan' && styles.tabItemTextActive]}>
            Rota Belirle
          </Text>
        </TouchableOpacity>
      </View>

      {/* Web-like Filters Panel (Visible by default) */}
      <View style={styles.filtersWrapper}>
        <View style={styles.filtersHeader}>
          <Text style={styles.filtersTitle}>Arama ve Filtreleme</Text>
          <TouchableOpacity 
            style={styles.filtersToggleBtn}
            onPress={() => setIsFilterCollapsed(!isFilterCollapsed)}
          >
            <Filter color={isFilterCollapsed ? colors.textMuted : '#B91C1C'} size={14} style={{ marginRight: 4 }} />
            <Text style={[styles.filtersToggleText, !isFilterCollapsed && { color: '#B91C1C' }]}>
              {isFilterCollapsed ? 'Filtreleri Göster' : 'Filtreleri Gizle'}
            </Text>
          </TouchableOpacity>
        </View>

        {!isFilterCollapsed && (
          <View style={styles.filtersGrid}>
            {/* Row 1: Tarih & Bölge */}
            <View style={styles.filterRow}>
              <View style={styles.filterCol}>
                <Text style={styles.filterLabel}>Tarih</Text>
                <TouchableOpacity onPress={() => setDatePickerOpen(true)} style={styles.filterSelectBtn}>
                  <Calendar size={12} color={colors.textMuted} style={{ marginRight: 6 }} />
                  <Text style={styles.filterSelectBtnText} numberOfLines={1}>
                    {currentDateStr.split('-').reverse().join('.')}
                  </Text>
                </TouchableOpacity>
              </View>

              {!isTechMode && (
                <View style={styles.filterCol}>
                  <Text style={styles.filterLabel}>Bölge</Text>
                  <TouchableOpacity onPress={() => setRegionModalOpen(true)} style={styles.filterSelectBtn}>
                    <MapPin size={12} color={colors.textMuted} style={{ marginRight: 6 }} />
                    <Text style={styles.filterSelectBtnText} numberOfLines={1}>
                      {selectedRegionId === 'all' ? 'Tümü' : (regions.find((r: RegionOption) => r.id === selectedRegionId)?.name ?? 'Seçiniz')}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>

            {/* Row 2: Teknisyen Seçimi & Müşteri Ara */}
            <View style={styles.filterRow}>
              {!isTechMode && (
                <View style={styles.filterCol}>
                  <Text style={styles.filterLabel}>Teknisyen</Text>
                  <TouchableOpacity onPress={() => setTechModalOpen(true)} style={styles.filterSelectBtn}>
                    <User size={12} color={colors.textMuted} style={{ marginRight: 6 }} />
                    <Text style={styles.filterSelectBtnText} numberOfLines={1}>
                      {selectedTechFilterId === 'all' ? 'Tümü' : (technicians.find(t => t.id === selectedTechFilterId)?.fullName ?? 'Seçiniz')}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}

              <View style={styles.filterCol}>
                <Text style={styles.filterLabel}>Müşteri Ara</Text>
                <TextInput
                  style={styles.filterTextInput}
                  placeholder="Müşteri adı..."
                  placeholderTextColor={colors.textMuted}
                  value={customerFilterText}
                  onChangeText={setCustomerFilterText}
                />
              </View>
            </View>

            {/* Row 3: Ürün Ara & Servis Türü */}
            <View style={styles.filterRow}>
              <View style={styles.filterCol}>
                <Text style={styles.filterLabel}>Ürün Ara</Text>
                <TextInput
                  style={styles.filterTextInput}
                  placeholder="Ürün adı..."
                  placeholderTextColor={colors.textMuted}
                  value={productFilterText}
                  onChangeText={setProductFilterText}
                />
              </View>

              <View style={styles.filterCol}>
                <Text style={styles.filterLabel}>Servis Türü</Text>
                <TouchableOpacity onPress={() => setServiceTypeModalOpen(true)} style={styles.filterSelectBtn}>
                  <Wrench size={12} color={colors.textMuted} style={{ marginRight: 6 }} />
                  <Text style={styles.filterSelectBtnText} numberOfLines={1}>
                    {SERVICE_TYPES.find(t => t.value === typeFilter)?.label ?? 'Tümü'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Row 4: İş Durumu & Sıfırla/Refresh */}
            <View style={styles.filterRow}>
              <View style={styles.filterCol}>
                <Text style={styles.filterLabel}>İş Durumu</Text>
                <TouchableOpacity onPress={() => setStatusFilterModalOpen(true)} style={styles.filterSelectBtn}>
                  <CheckCircle size={12} color={colors.textMuted} style={{ marginRight: 6 }} />
                  <Text style={styles.filterSelectBtnText} numberOfLines={1}>
                    {STATUS_FILTER_OPTIONS.find(s => s.value === statusFilter)?.label ?? 'Tümü'}
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={[styles.filterCol, { flexDirection: 'row', gap: 6, alignItems: 'flex-end' }]}>
                <TouchableOpacity 
                  style={[styles.webResetFilterBtn, { flex: 2 }]}
                  onPress={() => {
                    setSelectedRegionId('all');
                    setSelectedTechFilterId(isTechMode ? (sessionTechnicianId || 'all') : 'all');
                    setCustomerFilterText('');
                    setProductFilterText('');
                    setTypeFilter('all');
                    setStatusFilter('all');
                  }}
                >
                  <X size={12} color="#fff" style={{ marginRight: 4 }} />
                  <Text style={styles.webResetFilterBtnText}>Sıfırla</Text>
                </TouchableOpacity>

                <TouchableOpacity 
                  style={[styles.webRefreshBtn, { flex: 1 }]}
                  onPress={() => {
                    stopsQuery.refetch();
                    allStopsQuery.refetch();
                  }}
                >
                  <RefreshCw size={12} color={colors.text} />
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}
      </View>

      {stopsQuery.isLoading || allStopsQuery.isLoading ? (
        <Spinner fullScreen />
      ) : stopsQuery.isError ? (
        <View style={styles.centerContainer}>
          <AlertCircle color="#ef4444" size={48} />
          <Text style={styles.errorText}>
            Hata: {stopsQuery.error instanceof Error ? stopsQuery.error.message : 'Bilinmeyen hata'}
          </Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => { stopsQuery.refetch(); allStopsQuery.refetch(); }}>
            <Text style={styles.retryBtnText}>Tekrar Dene</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView 
          contentContainerStyle={styles.container} 
          showsVerticalScrollIndicator={false}
          scrollEnabled={scrollEnabled}
        >
          {activeTab === 'map' ? (
            /* ============================================================
               MAP VIEW TAB
               ============================================================ */
            <View>
              {/* Inline Map */}
              <View style={styles.inlineMapContainer}>
                <WebView 
                  source={{ html: mapHtml }}
                  style={styles.inlineMapWebview}
                  javaScriptEnabled={true}
                  domStorageEnabled={true}
                  scrollEnabled={false}
                />
                <TouchableOpacity 
                  style={styles.inlineMapFullscreenBtn}
                  onPress={() => setMapModalVisible(true)}
                >
                  <Maximize2 color="#fff" size={16} />
                </TouchableOpacity>
              </View>

              {/* Stats Bar */}
              <View style={styles.statsScrollWrapper}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.statsBarContainer}>
                  <View style={[styles.statBox, { borderLeftColor: '#64748b' }]}>
                    <Text style={styles.statVal}>{statsSummary.total}</Text>
                    <Text style={styles.statLabel}>Toplam İş</Text>
                  </View>
                  <View style={[styles.statBox, { borderLeftColor: '#ef4444' }]}>
                    <Text style={[styles.statVal, { color: '#ef4444' }]}>{statsSummary.unassigned}</Text>
                    <Text style={styles.statLabel}>Atanmamış</Text>
                  </View>
                  <View style={[styles.statBox, { borderLeftColor: '#3b82f6' }]}>
                    <Text style={[styles.statVal, { color: '#3b82f6' }]}>{statsSummary.assigned}</Text>
                    <Text style={styles.statLabel}>Atanmış</Text>
                  </View>
                  <View style={[styles.statBox, { borderLeftColor: '#f97316' }]}>
                    <Text style={[styles.statVal, { color: '#f97316' }]}>{statsSummary.inProgress}</Text>
                    <Text style={styles.statLabel}>Yolda/İşlemde</Text>
                  </View>
                  <View style={[styles.statBox, { borderLeftColor: '#10b981' }]}>
                    <Text style={[styles.statVal, { color: '#10b981' }]}>{statsSummary.completed}</Text>
                    <Text style={styles.statLabel}>Tamamlanan</Text>
                  </View>
                </ScrollView>
              </View>

              <Text style={styles.sectionTitle}>GÜNLÜK GÖREV LİSTESİ ({filteredStopsList.length})</Text>
              
              <View style={styles.stopsList}>
                {filteredStopsList.length === 0 ? (
                  <Text style={styles.emptyText}>Filtrelere uygun görev bulunamadı.</Text>
                ) : (
                  filteredStopsList.map((stop, index) => {
                    const lookupKey = Object.keys(STOP_STATUS_MAPPING).find(
                      (k) => k.toLowerCase() === (stop.status ?? 'planned').toLowerCase()
                    ) || 'Planned';
                    const stopStatus = STOP_STATUS_MAPPING[lookupKey];
                    const isStopDone = stop.status === 'Ready' || stop.status === 'Delivered';
                    const isTimePassed = (() => {
                      if (isStopDone || stop.status === 'Cancelled') return false;
                      const now = new Date();
                      const offset = now.getTimezoneOffset();
                      const localNow = new Date(now.getTime() - (offset * 60 * 1000));
                      const todayStr = localNow.toISOString().split('T')[0];
                      const stopDate = stop.routeDate || (stop.plannedAt ? stop.plannedAt.substring(0, 10) : '');
                      if (!stopDate) return false;
                      if (stopDate < todayStr) return true;
                      
                      const hourStr = isTechMode ? stop.userRouteHour : stop.plannedStartTime;
                      if (stopDate === todayStr && hourStr) {
                        const parts = hourStr.split(':');
                        if (parts.length >= 2) {
                          const stopTimeMins = parseInt(parts[0]) * 60 + parseInt(parts[1]);
                          const nowMins = now.getHours() * 60 + now.getMinutes();
                          return nowMins > stopTimeMins;
                        }
                      }
                      return false;
                    })();
                    const isStruckThrough = isStopDone || isTimePassed;

                    return (
                      <Card key={stop.id} style={[styles.stopCard, isStopDone && styles.stopCardDone]}>
                        <View style={styles.stopCardMainRow}>
                          <View style={{ flex: 1 }}>
                            <View style={styles.stopHeader}>
                              <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
                                <View style={styles.stopSeqBadge}>
                                  <Text style={styles.stopSeqText}>{index + 1}</Text>
                                </View>
                                <View style={{ marginLeft: 6 }}>
                                  <Badge label={stopStatus.label} type={stopStatus.type} />
                                </View>
                                {isTimePassed && (
                                  <View style={styles.timePassedBadge}>
                                    <Text style={styles.timePassedBadgeText}>Zamanı Geçti</Text>
                                  </View>
                                )}
                              </View>
                            </View>

                            <Text style={[styles.stopCustomerName, isStruckThrough && styles.textStrikeThrough]} numberOfLines={1}>
                              {stop.customerName || 'Müşteri Belirtilmemiş'}
                            </Text>

                            {stop.type && (
                              <View style={styles.serviceTypeBadge}>
                                <Text style={styles.serviceTypeText}>
                                  {stop.type === 'Installation' ? 'Montaj' : stop.type === 'Repair' ? 'Arıza' : stop.type}
                                </Text>
                              </View>
                            )}

                            {stop.customerAddress && (
                              <View style={styles.stopAddressBlock}>
                                <MapPin color={colors.textMuted} size={14} style={{ marginRight: 6, marginTop: 2 }} />
                                <Text style={[styles.stopAddressText, isStruckThrough && styles.textStrikeThrough]} numberOfLines={2}>
                                  {stop.customerAddress}
                                </Text>
                              </View>
                            )}
                          </View>
                        </View>
                      </Card>
                    );
                  })
                )}
              </View>
            </View>
          ) : (
            /* ============================================================
               PLAN ROUTE TAB
               ============================================================ */
            <View>
              {!resolvedTechId ? (
                /* ============================================================
                   ADMIN MODE - ACTIVE TECHNICIANS GRID/LIST
                   ============================================================ */
                <View style={styles.techsListContainer}>
                  <View style={styles.techsListHeader}>
                    <Text style={styles.techsListTitle}>Aktif Teknisyenler ({filteredTechnicians.length})</Text>
                  </View>
                  {techsQuery.isLoading ? (
                    <Spinner style={{ marginTop: 20 }} />
                  ) : filteredTechnicians.length === 0 ? (
                    <Text style={styles.emptyText}>Aktif teknisyen bulunamadı.</Text>
                  ) : (
                    <View style={styles.techsGrid}>
                      {filteredTechnicians.map((tech) => {
                        const stopsCount = allStops.filter(r => r.assignedTechnicianId === tech.id).length;
                        const finishedCount = allStops.filter(r => r.assignedTechnicianId === tech.id && (r.status === 'Ready' || r.status === 'Delivered' || r.status === 'Completed')).length;
                        const inProgressCount = allStops.filter(r => r.assignedTechnicianId === tech.id && (r.status === 'InRepair' || r.status === 'Workshop' || r.status === 'InProgress')).length;
                        const initials = tech.initials ?? `${tech.firstName ? tech.firstName[0] : ''}${tech.lastName ? tech.lastName[0] : ''}`.toUpperCase();
                        
                        // Availability badge
                        let availabilityLabel = 'Müsait';
                        let availabilityType: BadgeType = 'success';
                        if (!tech.isOnline) {
                          availabilityLabel = 'Çevrimdışı';
                          availabilityType = 'neutral';
                        } else if (stopsCount >= 3) {
                          availabilityLabel = `Yoğun (${stopsCount})`;
                          availabilityType = 'warning';
                        }

                        return (
                          <TouchableOpacity
                            key={tech.id}
                            style={styles.techCard}
                            onPress={() => setSelectedTechFilterId(tech.id)}
                            activeOpacity={0.7}
                          >
                            <View style={styles.techCardRow}>
                              <View style={[
                                styles.techAvatar, 
                                { backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : '#f1f5f9', borderColor: tech.isOnline ? '#10b981' : colors.surfaceBorder }
                              ]}>
                                <Text style={styles.techAvatarText}>{initials}</Text>
                                {tech.isOnline && <View style={styles.onlineDot} />}
                              </View>

                              <View style={{ flex: 1, marginLeft: 12 }}>
                                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <Text style={styles.techNameText} numberOfLines={1}>{tech.fullName}</Text>
                                  <Text style={styles.techStatsText}>
                                    {finishedCount}/{stopsCount}
                                  </Text>
                                </View>

                                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                                  <Text style={styles.techRegionText} numberOfLines={1}>
                                    📍 {tech.regionName || 'Bölge Yok'}
                                  </Text>
                                  <Badge label={availabilityLabel} type={availabilityType} />
                                </View>
                                
                                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                                  <Text style={styles.techInProgressText}>{inProgressCount} Devam Eden</Text>
                                </View>
                              </View>
                            </View>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )}
                </View>
              ) : (
                /* ============================================================
                   TIMELINE / STOP SCHEDULING
                   ============================================================ */
                <View>
                  {/* Selected Tech Stats Summary */}
                  <Card style={styles.summaryCard}>
                    <View style={styles.summaryHeader}>
                      {isTechMode ? (
                        <Text style={styles.routeNumber}>KİŞİSEL PLANIM</Text>
                      ) : (
                        <TouchableOpacity 
                          style={styles.backToTechsBtn} 
                          onPress={() => { setSelectedTechFilterId('all'); setSelectedPoolStops([]); }}
                        >
                          <ChevronLeft size={16} color="#B91C1C" />
                          <Text style={styles.backToTechsBtnText}>Teknisyen Listesi</Text>
                        </TouchableOpacity>
                      )}
                      <Badge 
                        label={progressPercentage === 100 ? 'Tamamlandı' : 'Devam Ediyor'} 
                        type={progressPercentage === 100 ? 'success' : 'warning'} 
                      />
                    </View>

                    {/* Tech details header matching web */}
                    <View style={styles.webTechTimelineHeader}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text style={styles.webTechTimelineName}>
                          {technicians.find(t => t.id === resolvedTechId)?.fullName || 'Belirtilmemiş'}
                        </Text>
                        <Badge 
                          label={technicians.find(t => t.id === resolvedTechId)?.isOnline ? 'Çevrimiçi' : 'Çevrimdışı'}
                          type={technicians.find(t => t.id === resolvedTechId)?.isOnline ? 'success' : 'neutral'}
                        />
                      </View>
                      <Text style={styles.webTechTimelineRegion}>
                        📍 {technicians.find(t => t.id === resolvedTechId)?.regionName || 'Bölge Belirtilmemiş'}
                      </Text>
                    </View>

                    <View style={styles.progressSection}>
                      <View style={styles.progressLabelRow}>
                        <Text style={styles.progressLabel}>Tahmini Mesafe</Text>
                        <Text style={[styles.progressValue, { color: '#ef4444' }]}>{estimatedRouteLength} km</Text>
                      </View>
                      <View style={styles.progressLabelRow}>
                        <Text style={styles.progressLabel}>Tarih</Text>
                        <Text style={[styles.progressValue, { color: '#ef4444' }]}>{currentDateStr.split('-').reverse().join('.')}</Text>
                      </View>
                    </View>
                  </Card>

                  {/* Title Row with "Havuzdan Ata" Button */}
                  <View style={styles.actionRow}>
                    <Text style={styles.sectionTitle}>GÜNLÜK ZAMAN ÇİZELGESİ</Text>
                    <Text style={styles.webTimelineSortedHint}>Sürükleme ile sıralayın</Text>
                  </View>

                  <View style={styles.stopsList}>
                    {localStops.length === 0 ? (
                      /* Web-like Atanmis Gorev Yok visual card */
                      <View style={styles.webNoTasksContainer}>
                        <Info size={44} color={colors.textMuted} style={{ marginBottom: 12 }} />
                        <Text style={styles.webNoTasksTitle}>Atanmış Görev Yok</Text>
                        <Text style={styles.webNoTasksSub}>
                          Aşağıdaki "Havuzdan Ata" butonuna basarak havuzdaki işleri seçip buraya atayabilirsiniz.
                        </Text>
                      </View>
                    ) : (
                      localStops.map((stop, index) => {
                        const lookupKey = Object.keys(STOP_STATUS_MAPPING).find(
                          (k) => k.toLowerCase() === (stop.status ?? 'planned').toLowerCase()
                        ) || 'Planned';
                        const stopStatus = STOP_STATUS_MAPPING[lookupKey];
                        const isStopDone = stop.status === 'Ready' || stop.status === 'Delivered';
                        const isDragging = activeDragIndex === index;

                        const isTimePassed = (() => {
                          if (isStopDone || stop.status === 'Cancelled') return false;
                          const now = new Date();
                          const offset = now.getTimezoneOffset();
                          const localNow = new Date(now.getTime() - (offset * 60 * 1000));
                          const todayStr = localNow.toISOString().split('T')[0];
                          const stopDate = stop.routeDate || (stop.plannedAt ? stop.plannedAt.substring(0, 10) : '');
                          if (!stopDate) return false;
                          if (stopDate < todayStr) return true;
                          
                          const hourStr = isTechMode ? stop.userRouteHour : stop.plannedStartTime;
                          if (stopDate === todayStr && hourStr) {
                            const parts = hourStr.split(':');
                            if (parts.length >= 2) {
                              const stopTimeMins = parseInt(parts[0]) * 60 + parseInt(parts[1]);
                              const nowMins = now.getHours() * 60 + now.getMinutes();
                              return nowMins > stopTimeMins;
                            }
                          }
                          return false;
                        })();
                        const isStruckThrough = isStopDone || isTimePassed;

                        return (
                          <View key={stop.id}>
                            <Card style={[
                              styles.stopCard, 
                              isStopDone && styles.stopCardDone,
                              isDragging && styles.stopCardDragging
                            ]}>
                              <View style={styles.stopCardMainRow}>
                                <View 
                                  style={styles.dragHandle}
                                  onTouchStart={(e) => handleTouchStart(index, e.nativeEvent.pageY)}
                                  onTouchMove={(e) => handleTouchMove(e.nativeEvent.pageY)}
                                  onTouchEnd={handleTouchEnd}
                                >
                                  <GripVertical color={colors.textMuted} size={20} />
                                </View>

                                <TouchableOpacity
                                  style={styles.checkboxContainer}
                                  onPress={() => toggleStopTick(stop.id, stop.userRouteTick ?? false)}
                                >
                                  {stop.userRouteTick ? (
                                    <CheckSquare color="#10b981" size={24} />
                                  ) : (
                                    <Square color={colors.textMuted} size={24} />
                                  )}
                                </TouchableOpacity>

                                <View style={{ flex: 1 }}>
                                  <View style={styles.stopHeader}>
                                    <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
                                      <View style={styles.stopSeqBadge}>
                                        <Text style={styles.stopSeqText}>{index + 1}</Text>
                                      </View>
                                      <View style={{ marginLeft: 6 }}>
                                        <Badge label={stopStatus.label} type={stopStatus.type} />
                                      </View>
                                      {stop.status !== 'Ready' && stop.status !== 'Delivered' && stop.status !== 'Cancelled' && (
                                        <TouchableOpacity
                                          style={styles.doneBtn}
                                          onPress={async () => {
                                            try {
                                              await updateServiceRecordStatus(stop.id, { status: 'Ready' });
                                              qc.invalidateQueries({ queryKey: ['servicerecords', 'planned-date', currentDateStr, resolvedTechId] });
                                              qc.invalidateQueries({ queryKey: ['servicerecords', 'all-stops-day', currentDateStr] });
                                            } catch (err) {
                                              Alert.alert('Hata', 'Durum güncellenemedi.');
                                            }
                                          }}
                                        >
                                          <Text style={styles.doneBtnText}>Yapıldı</Text>
                                        </TouchableOpacity>
                                      )}
                                      {isTimePassed && (
                                        <View style={styles.timePassedBadge}>
                                          <Text style={styles.timePassedBadgeText}>Zamanı Geçti</Text>
                                        </View>
                                      )}
                                    </View>
                                  </View>

                                  <Text style={[styles.stopCustomerName, isStruckThrough && styles.textStrikeThrough]} numberOfLines={1}>
                                    {stop.customerName || 'Müşteri Belirtilmemiş'}
                                  </Text>

                                  {stop.type && (
                                    <View style={styles.serviceTypeBadge}>
                                      <Text style={styles.serviceTypeText}>
                                        {stop.type === 'Installation' ? 'Montaj' : stop.type === 'Repair' ? 'Arıza' : stop.type}
                                      </Text>
                                    </View>
                                  )}

                                  {stop.customerAddress && (
                                    <View style={styles.stopAddressBlock}>
                                      <MapPin color={colors.textMuted} size={14} style={{ marginRight: 6, marginTop: 2 }} />
                                      <Text style={[styles.stopAddressText, isStruckThrough && styles.textStrikeThrough]} numberOfLines={2}>
                                        {stop.customerAddress}
                                      </Text>
                                    </View>
                                  )}

                                  {/* ====== TIME PLANNING - BEAUTIFUL PRESETS & INPUTS ====== */}
                                  <View style={styles.timePlanningWrapper}>
                                    <View style={styles.timePlanningHeader}>
                                      <Clock color={colors.textMuted} size={12} style={{ marginRight: 4 }} />
                                      <Text style={styles.timePlanningTitle}>Saat Planı</Text>
                                    </View>

                                    {/* Presets Row */}
                                    <View style={styles.presetsContainer}>
                                      {HOUR_PRESETS.map(p => (
                                        <TouchableOpacity
                                          key={p.label}
                                          style={[styles.presetBtn, { backgroundColor: p.color }]}
                                          onPress={() => updateRouteHour(stop.id, p.start, p.end)}
                                        >
                                          <Text style={styles.presetBtnText}>{p.label}</Text>
                                          <Text style={styles.presetBtnSub}>{p.sub}</Text>
                                        </TouchableOpacity>
                                      ))}
                                    </View>

                                    {/* Manual Time Input Row */}
                                    <View style={styles.arrivalInputRow}>
                                      <TextInput
                                        style={styles.arrivalInput}
                                        value={getDisplayArrival(stop)}
                                        onChangeText={(text) => setArrivalInputs(prev => ({ ...prev, [stop.id]: text }))}
                                        placeholder="SS:DD"
                                        placeholderTextColor={colors.textMuted}
                                        maxLength={5}
                                      />
                                      {arrivalInputs[stop.id] !== undefined && arrivalInputs[stop.id] !== (stop.userRouteHour ? stop.userRouteHour.substring(0, 5) : '') && (
                                        <TouchableOpacity
                                          style={styles.saveArrivalBtn}
                                          onPress={() => updateRouteHour(stop.id, arrivalInputs[stop.id])}
                                        >
                                          <Text style={styles.saveArrivalBtnText}>Kaydet</Text>
                                        </TouchableOpacity>
                                      )}
                                    </View>
                                  </View>
                                </View>
                              </View>

                              <View style={styles.stopCardFooter}>
                                <TouchableOpacity
                                  style={styles.clickHintBlock}
                                  onPress={() => {
                                    navigation.navigate('ServiceRecordDetail', { serviceId: stop.id });
                                  }}
                                >
                                  <Navigation color="#B73A0B" size={14} style={{ marginRight: 4 }} />
                                  <Text style={styles.clickHintText}>Servis Detayını Aç</Text>
                                </TouchableOpacity>
                                <ChevronRight color={colors.textMuted} size={16} />
                              </View>
                            </Card>
                          </View>
                        );
                      })
                    )}
                  </View>

                  {/* Actions Footer inside Planning Timeline */}
                  <View style={styles.timelineFooter}>
                    <Text style={styles.footerPoolStats}>
                      Havuzda <Text style={{ color: '#f59e0b', fontWeight: '800' }}>{unassignedPoolStops.length}</Text> iş var.
                    </Text>
                    <View style={styles.footerActionsRow}>
                      <TouchableOpacity
                        style={styles.footerActionBtn}
                        onPress={() => setIsSortModalOpen(true)}
                      >
                        <GripVertical color={colors.text} size={14} style={{ marginRight: 4 }} />
                        <Text style={styles.footerActionBtnText}>Sırala</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.footerActionBtn, { backgroundColor: '#E11D48' }]}
                        onPress={() => { setSelectedPoolStops([]); setPoolSearchQuery(''); setPoolModalVisible(true); }}
                      >
                        <Layers color="#fff" size={14} style={{ marginRight: 4 }} />
                        <Text style={[styles.footerActionBtnText, { color: '#fff' }]}>Havuzdan Ata</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.footerActionBtn, { backgroundColor: '#FFFBEB', borderColor: '#FCD34D' }]}
                        onPress={() => setIsOverdueModalOpen(true)}
                      >
                        <Clock color="#B45309" size={14} style={{ marginRight: 4 }} />
                        <Text style={[styles.footerActionBtnText, { color: '#B45309' }]}>Zamanı Geçenler</Text>
                        {overdueStops.length > 0 && (
                          <View style={styles.overdueBadge}>
                            <Text style={styles.overdueBadgeText}>{overdueStops.length}</Text>
                          </View>
                        )}
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              )}
            </View>
          )}
        </ScrollView>
      )}

      {/* DatePickerModal */}
      <DatePickerModal
        visible={datePickerOpen}
        value={currentDateStr}
        onSelect={(iso) => setCurrentDateStr(iso)}
        onClose={() => setDatePickerOpen(false)}
      />

      {/* DatePickerModal for Overdue Rescheduling */}
      <DatePickerModal
        visible={datePickerForOverdueOpen}
        value={overdueRescheduleActiveId ? (rescheduleDates[overdueRescheduleActiveId] || currentDateStr) : currentDateStr}
        onSelect={(iso) => {
          if (overdueRescheduleActiveId) {
            setRescheduleDates(prev => ({ ...prev, [overdueRescheduleActiveId]: iso }));
          }
        }}
        onClose={() => {
          setDatePickerForOverdueOpen(false);
          setOverdueRescheduleActiveId(null);
        }}
      />

      {/* Region Selection Modal */}
      <Modal visible={regionModalOpen} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.choiceModalContent}>
            <View style={styles.poolModalHeader}>
              <Text style={styles.poolModalTitle}>Bölge Seç</Text>
              <TouchableOpacity onPress={() => setRegionModalOpen(false)}><X color={colors.text} size={20}/></TouchableOpacity>
            </View>
            <TextInput 
              style={styles.modalSearchInput} 
              value={regionSearch} 
              onChangeText={setRegionSearch} 
              placeholder="Bölge Ara..." 
              placeholderTextColor={colors.textMuted} 
            />
            <FlatList
              data={[{ id: 'all', name: 'Bölgeler (Tümü)' }, ...regions.filter((r: RegionOption) => r.name.toLowerCase().includes(regionSearch.toLowerCase()))]}
              keyExtractor={(r) => r.id}
              renderItem={({ item }) => (
                <TouchableOpacity 
                  style={styles.choiceRow} 
                  onPress={() => { setSelectedRegionId(item.id); setRegionModalOpen(false); }}
                >
                  <Text style={styles.choiceText}>{item.name}</Text>
                </TouchableOpacity>
              )}
              style={{ maxHeight: 300 }}
            />
          </View>
        </View>
      </Modal>

      {/* Technician Selection Modal */}
      <Modal visible={techModalOpen} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.choiceModalContent}>
            <View style={styles.poolModalHeader}>
              <Text style={styles.poolModalTitle}>Teknisyen Seç</Text>
              <TouchableOpacity onPress={() => setTechModalOpen(false)}><X color={colors.text} size={20}/></TouchableOpacity>
            </View>
            <TextInput 
              style={styles.modalSearchInput} 
              value={techSearch} 
              onChangeText={setTechSearch} 
              placeholder="Teknisyen Ara..." 
              placeholderTextColor={colors.textMuted} 
            />
            <FlatList
              data={[{ id: 'all', fullName: 'Teknisyenler (Tümü)', regionName: '' }, ...technicians.filter(t => t.fullName.toLowerCase().includes(techSearch.toLowerCase()))]}
              keyExtractor={(t) => t.id}
              renderItem={({ item }) => (
                <TouchableOpacity 
                  style={styles.choiceRow} 
                  onPress={() => { 
                    setSelectedTechFilterId(item.id); 
                    setTechModalOpen(false); 
                  }}
                >
                  <View>
                    <Text style={styles.choiceText}>{item.fullName}</Text>
                    {item.regionName ? <Text style={styles.choiceSubText}>{item.regionName}</Text> : null}
                  </View>
                </TouchableOpacity>
              )}
              style={{ maxHeight: 300 }}
            />
          </View>
        </View>
      </Modal>

      {/* Service Type Selection Modal */}
      <Modal visible={serviceTypeModalOpen} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.choiceModalContent}>
            <View style={styles.poolModalHeader}>
              <Text style={styles.poolModalTitle}>Servis Türü Seç</Text>
              <TouchableOpacity onPress={() => setServiceTypeModalOpen(false)}><X color={colors.text} size={20}/></TouchableOpacity>
            </View>
            <FlatList
              data={[
                { value: 'all', label: 'Tümü' },
                { value: 'Repair', label: 'Arıza' },
                { value: 'Installation', label: 'Montaj' },
                { value: 'Maintenance', label: 'Bakım' },
                { value: 'Warranty', label: 'Garanti' }
              ]}
              keyExtractor={(t) => t.value}
              renderItem={({ item }) => (
                <TouchableOpacity 
                  style={styles.choiceRow} 
                  onPress={() => { setTypeFilter(item.value); setServiceTypeModalOpen(false); }}
                >
                  <Text style={styles.choiceText}>{item.label}</Text>
                </TouchableOpacity>
              )}
              style={{ maxHeight: 300 }}
            />
          </View>
        </View>
      </Modal>

      {/* Work Status Selection Modal */}
      <Modal visible={statusFilterModalOpen} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.choiceModalContent}>
            <View style={styles.poolModalHeader}>
              <Text style={styles.poolModalTitle}>İş Durumu Seç</Text>
              <TouchableOpacity onPress={() => setStatusFilterModalOpen(false)}><X color={colors.text} size={20}/></TouchableOpacity>
            </View>
            <FlatList
              data={[
                { value: 'all', label: 'Tümü' },
                { value: 'Pending', label: 'Bekliyor' },
                { value: 'Planned', label: 'Planlandı' },
                { value: 'InProgress', label: 'Devam Ediyor' },
                { value: 'Completed', label: 'Tamamlandı' },
                { value: 'Cancelled', label: 'İptal' }
              ]}
              keyExtractor={(t) => t.value}
              renderItem={({ item }) => (
                <TouchableOpacity 
                  style={styles.choiceRow} 
                  onPress={() => { setStatusFilter(item.value); setStatusFilterModalOpen(false); }}
                >
                  <Text style={styles.choiceText}>{item.label}</Text>
                </TouchableOpacity>
              )}
              style={{ maxHeight: 300 }}
            />
          </View>
        </View>
      </Modal>

      {/* 4. FULLSCREEN LEAFLET MAP MODAL */}
      <Modal
        visible={mapModalVisible}
        animationType="slide"
        onRequestClose={() => setMapModalVisible(false)}
      >
        <SafeAreaView style={styles.mapModalContainer}>
          <View style={styles.mapModalHeader}>
            <Text style={styles.mapModalTitle}>Günlük Rota Haritam ({currentDateStr.split('-').reverse().join('.')})</Text>
            <TouchableOpacity 
              style={styles.closeMapBtn} 
              onPress={() => setMapModalVisible(false)}
            >
              <X color="#fff" size={24} />
            </TouchableOpacity>
          </View>
          <WebView 
            source={{ html: mapHtml }}
            style={styles.webview}
            javaScriptEnabled={true}
            domStorageEnabled={true}
          />
        </SafeAreaView>
      </Modal>

      {/* 5. HAVUZDAN ATA MODAL (MULTIPLE CHECKLIST) */}
      <Modal
        visible={poolModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setPoolModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.poolModalContent}>
            <View style={styles.poolModalHeader}>
              <View>
                <Text style={styles.poolModalTitle}>Havuzdaki İşleri Planla ({unassignedPoolStops.length})</Text>
                <Text style={styles.choiceSubText}>Günlük çizelgeye dahil etmek istediğiniz işleri seçin.</Text>
              </View>
              <TouchableOpacity 
                style={styles.closePoolBtn} 
                onPress={() => setPoolModalVisible(false)}
              >
                <X color={colors.text} size={20} />
              </TouchableOpacity>
            </View>

            {/* Modal Search Bar */}
            <View style={{ marginTop: 12 }}>
              <TextInput
                style={styles.modalSearchInput}
                placeholder="İş numarası, müşteri adı, ürün veya adres ara..."
                placeholderTextColor={colors.textMuted}
                value={poolSearchQuery}
                onChangeText={setPoolSearchQuery}
              />
            </View>

            <ScrollView style={styles.poolList} contentContainerStyle={{ paddingBottom: 24 }}>
              {filteredPoolStops.length === 0 ? (
                <Text style={styles.emptyPoolText}>Havuzda planlanmamış görev bulunmamaktadır.</Text>
              ) : (
                filteredPoolStops.map((stop) => {
                  const isChecked = selectedPoolStops.includes(stop.id);
                  const dateStr = stop.routeDate || (stop.plannedAt ? stop.plannedAt.substring(0, 10) : null);
                  const isBacklog = dateStr && dateStr !== currentDateStr;

                  return (
                    <TouchableOpacity
                      key={stop.id}
                      style={[styles.poolItemCard, isChecked && { borderColor: '#B91C1C', backgroundColor: isDark ? 'rgba(185, 28, 28, 0.05)' : 'rgba(185, 28, 28, 0.02)' }]}
                      onPress={() => toggleSelectPoolStop(stop.id)}
                      activeOpacity={0.8}
                    >
                      <View style={{ marginRight: 10 }}>
                        {isChecked ? (
                          <CheckSquare color="#B91C1C" size={20} />
                        ) : (
                          <Square color={colors.textMuted} size={20} />
                        )}
                      </View>

                      <View style={{ flex: 1 }}>
                        <View style={styles.poolItemHeader}>
                          <Text style={styles.poolItemNumber}>{stop.serviceNumber}</Text>
                          <Badge 
                            label={stop.type === 'Installation' ? 'Montaj' : stop.type === 'Repair' ? 'Arıza' : stop.type} 
                            type={stop.type === 'Installation' ? 'info' : 'warning'} 
                          />
                        </View>
                        {isBacklog && (
                          <Text style={styles.backlogWarningText}>Eski Plan Tarihi: {String(dateStr).split('-').reverse().join('.')}</Text>
                        )}
                        <Text style={styles.poolItemCustomerName}>{stop.customerName || 'Müşteri Belirtilmemiş'}</Text>
                        <Text style={styles.poolItemAddress}>{stop.customerAddress || 'Adres Belirtilmemiş'}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>

            {/* Modal Actions Footer */}
            <View style={styles.poolModalFooter}>
              <Text style={styles.selectedCountText}>{selectedPoolStops.length} iş seçildi</Text>
              <TouchableOpacity
                style={[styles.poolAssignSubmitBtn, selectedPoolStops.length === 0 && { opacity: 0.5 }]}
                disabled={selectedPoolStops.length === 0}
                onPress={handleAssignPoolStops}
              >
                <Text style={styles.poolAssignSubmitBtnText}>Çizelgeye Ekle</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* 6. ZAMANI GEÇEN İŞLER RESCHEDULE MODAL */}
      <Modal
        visible={isOverdueModalOpen}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setIsOverdueModalOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.poolModalContent}>
            <View style={styles.poolModalHeader}>
              <View>
                <Text style={styles.poolModalTitle}>Zamanı Geçen İşler ({overdueStops.length})</Text>
                <Text style={styles.choiceSubText}>Tarihi veya planlanan saati geçmiş işleri erteleyebilirsiniz.</Text>
              </View>
              <TouchableOpacity onPress={() => setIsOverdueModalOpen(false)}>
                <X color={colors.text} size={20} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.poolList} contentContainerStyle={{ paddingBottom: 24 }}>
              {overdueStops.length === 0 ? (
                <Text style={styles.emptyPoolText}>Gecikmiş veya zamanı geçmiş iş bulunmuyor.</Text>
              ) : (
                overdueStops.map((stop) => {
                  const dateStr = stop.routeDate || (stop.plannedAt ? stop.plannedAt.substring(0, 10) : '');
                  const formattedDate = dateStr ? dateStr.split('-').reverse().join('.') : 'Belirtilmemiş';
                  const isRescheduledSelected = rescheduleDates[stop.id];

                  return (
                    <View key={stop.id} style={styles.overdueItemCard}>
                      <View style={{ flex: 1 }}>
                        <View style={styles.poolItemHeader}>
                          <Text style={styles.poolItemNumber}>{stop.serviceNumber}</Text>
                          <Badge 
                            label={stop.type === 'Installation' ? 'Montaj' : stop.type === 'Repair' ? 'Arıza' : stop.type} 
                            type={stop.type === 'Installation' ? 'info' : 'warning'} 
                          />
                        </View>
                        <Text style={styles.poolItemCustomerName}>{stop.customerName || 'Müşteri Belirtilmemiş'}</Text>
                        <Text style={[styles.poolItemAddress, { color: '#ef4444', fontWeight: 'bold' }]}>Planlanan: {formattedDate}</Text>
                      </View>
                      
                      <View style={styles.overdueRescheduleControls}>
                        <TouchableOpacity
                          style={styles.overdueSelectDateBtn}
                          onPress={() => {
                            setOverdueRescheduleActiveId(stop.id);
                            setDatePickerForOverdueOpen(true);
                          }}
                        >
                          <Text style={styles.overdueSelectDateBtnText}>
                            {isRescheduledSelected ? isRescheduledSelected.split('-').reverse().join('.') : 'Tarih Seç'}
                          </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[styles.overdueRescheduleSubmitBtn, !isRescheduledSelected && { opacity: 0.5 }]}
                          disabled={!isRescheduledSelected || rescheduleLoadingId === stop.id}
                          onPress={() => handleRescheduleOverdue(stop.id)}
                        >
                          <Text style={styles.overdueRescheduleSubmitBtnText}>
                            {rescheduleLoadingId === stop.id ? '...' : 'Güncelle'}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })
              )}
            </ScrollView>

            <View style={styles.poolModalFooter}>
              <TouchableOpacity
                style={styles.sortDoneBtn}
                onPress={() => setIsOverdueModalOpen(false)}
              >
                <Text style={styles.sortDoneBtnText}>Kapat</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* 7. TIMELINE SORT MODAL */}
      <Modal visible={isSortModalOpen} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.choiceModalContent}>
            <View style={styles.poolModalHeader}>
              <View>
                <Text style={styles.poolModalTitle}>Zaman Çizelgesini Sırala</Text>
                <Text style={styles.choiceSubText}>
                  Okları kullanarak işlerin sırasını düzenleyebilirsiniz.
                </Text>
              </View>
              <TouchableOpacity onPress={() => setIsSortModalOpen(false)}>
                <X color={colors.text} size={20} />
              </TouchableOpacity>
            </View>

            {localStops.length === 0 ? (
              <Text style={styles.emptyText}>Atanmış görev bulunmuyor.</Text>
            ) : (
              <FlatList
                data={localStops}
                keyExtractor={(item) => item.id}
                contentContainerStyle={{ paddingBottom: 24, paddingTop: 12 }}
                renderItem={({ item, index }) => (
                  <View style={styles.sortRow}>
                    <View style={styles.sortSeqBadge}>
                      <Text style={styles.sortSeqText}>{index + 1}</Text>
                    </View>
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={styles.sortCustomerText} numberOfLines={1}>
                        {item.customerName || 'Müşteri Belirtilmemiş'}
                      </Text>
                      <Text style={styles.sortProductText} numberOfLines={1}>
                        {item.productName}
                      </Text>
                    </View>
                    <View style={styles.sortControls}>
                      <TouchableOpacity
                        disabled={index === 0}
                        style={[styles.sortArrowBtn, index === 0 && { opacity: 0.2 }]}
                        onPress={() => handleReorderStopsOfficial(index, index - 1)}
                      >
                        <ArrowUp size={16} color={colors.text} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        disabled={index === localStops.length - 1}
                        style={[styles.sortArrowBtn, index === localStops.length - 1 && { opacity: 0.2 }]}
                        onPress={() => handleReorderStopsOfficial(index, index + 1)}
                      >
                        <ArrowDown size={16} color={colors.text} />
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
                style={{ maxHeight: 300 }}
              />
            )}
            
            <View style={styles.sortModalFooter}>
              <TouchableOpacity
                style={styles.sortDoneBtn}
                onPress={() => setIsSortModalOpen(false)}
              >
                <Text style={styles.sortDoneBtnText}>Tamamlandı</Text>
              </TouchableOpacity>
            </View>
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
    paddingTop: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.inputBorder,
    backgroundColor: colors.surface,
  },
  headerLeftIconBlock: {
    marginRight: 14,
  },
  headerWebIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#E11D48',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleRow: {
    flex: 1,
  },
  title: { fontSize: 18, fontWeight: '900', color: colors.text, letterSpacing: -0.5 },
  webRoleBadge: {
    backgroundColor: '#FFE4E6',
    borderWidth: 1,
    borderColor: '#FDA4AF',
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 6,
  },
  webRoleBadgeText: {
    color: '#E11D48',
    fontSize: 9,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  subtitle: { fontSize: 11, color: colors.textSub, marginTop: 2, lineHeight: 15 },

  container: { padding: 16, gap: 16, paddingBottom: 60, maxWidth: 650, width: '100%', alignSelf: 'center' },
  centerContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, minHeight: 300 },
  errorText: { color: 'rgb(252, 165, 165)', fontSize: 14, fontWeight: '600', marginTop: 12, textAlign: 'center' },
  retryBtn: { marginTop: 16, backgroundColor: colors.inputBg, borderColor: colors.inputBorder, borderWidth: 1, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 20 },
  retryBtnText: { color: colors.text, fontSize: 13, fontWeight: '800' },

  summaryCard: {},
  summaryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  routeNumber: { fontSize: 16, fontWeight: '800', color: '#B91C1C', letterSpacing: 0.5 },
  
  progressSection: {
    borderTopWidth: 1,
    borderTopColor: colors.inputBorder,
    paddingTop: 14,
    gap: 8,
  },
  progressLabelRow: { flexDirection: 'row', justifyContent: 'space-between' },
  progressLabel: { fontSize: 11, color: colors.textMuted, fontWeight: '700' },
  progressValue: { fontSize: 11, color: colors.text, fontWeight: '800' },

  sectionTitle: { fontSize: 11, fontWeight: '800', color: '#E11D48', letterSpacing: 1.5, marginTop: 8, marginLeft: 4 },
  webTimelineSortedHint: { fontSize: 9, color: colors.textMuted, fontStyle: 'italic', fontWeight: '600' },
  emptyText: { color: colors.textMuted, fontSize: 13, marginLeft: 4, fontStyle: 'italic' },
  stopsList: { gap: 12 },

  stopCard: {},
  stopCardDone: {
    borderColor: 'rgba(16, 185, 129, 0.2)',
    backgroundColor: isDark ? 'rgba(16, 185, 129, 0.02)' : 'rgba(16, 185, 129, 0.05)',
  },
  stopCardDragging: {
    borderColor: '#B91C1C',
    borderWidth: 2,
    opacity: 0.8,
  },
  dragHandle: {
    padding: 8,
    marginRight: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stopHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  stopSeqBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(185, 28, 28, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopSeqText: { color: '#B91C1C', fontSize: 12, fontWeight: '800' },

  stopCustomerName: { fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: 6 },
  serviceTypeBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.inputBg,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.inputBorder,
  },
  serviceTypeText: { fontSize: 10, color: colors.textSub, fontWeight: '700' },

  stopAddressBlock: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
  stopAddressText: { flex: 1, color: colors.textSub, fontSize: 13, lineHeight: 18 },

  stopCardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.inputBorder,
    paddingTop: 12,
    marginTop: 4,
  },
  clickHintBlock: { flexDirection: 'row', alignItems: 'center' },
  clickHintText: { color: '#B73A0B', fontSize: 12, fontWeight: '700' },
  stopCardMainRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  checkboxContainer: {
    padding: 8,
    marginRight: 4,
    marginTop: 2,
  },

  timePlanningWrapper: {
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.inputBorder,
    paddingTop: 8,
  },
  timePlanningHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  timePlanningTitle: {
    fontSize: 11,
    color: colors.textSub,
    fontWeight: '700',
  },
  presetsContainer: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  presetBtn: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  presetBtnText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
  },
  presetBtnSub: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 8,
    marginTop: 1,
  },

  arrivalInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.inputBg,
    padding: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.inputBorder,
  },
  arrivalInput: {
    flex: 1,
    height: 28,
    color: colors.text,
    fontSize: 12,
    padding: 0,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontWeight: '600',
  },
  saveArrivalBtn: {
    marginLeft: 8,
    backgroundColor: '#B91C1C',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  saveArrivalBtnText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  textStrikeThrough: {
    textDecorationLine: 'line-through',
    color: colors.textMuted,
  },
  doneBtn: {
    backgroundColor: '#10b981',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginLeft: 6,
  },
  doneBtnText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  timePassedBadge: {
    backgroundColor: '#0f172a',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginLeft: 6,
    borderWidth: 1,
    borderColor: '#334155',
  },
  timePassedBadgeText: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: '900',
    textTransform: 'uppercase',
  },

  // Map Modal Styles
  mapModalContainer: {
    flex: 1,
    backgroundColor: '#0b0f19',
  },
  mapModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#1e293b',
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  mapModalTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#fff',
  },
  closeMapBtn: {
    padding: 4,
  },
  webview: {
    flex: 1,
    backgroundColor: '#0b0f19',
  },

  // Web-like Inline Map Styles
  inlineMapContainer: {
    height: 220,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    backgroundColor: colors.surface,
    marginBottom: 16,
    position: 'relative',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 4,
  },
  inlineMapWebview: {
    flex: 1,
  },
  inlineMapFullscreenBtn: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    zIndex: 100,
  },

  // Stats Bar Styles
  statsScrollWrapper: {
    marginBottom: 16,
  },
  statsBarContainer: {
    paddingHorizontal: 4,
    gap: 10,
  },
  statBox: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    borderLeftWidth: 4,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minWidth: 95,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  statVal: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
  },
  statLabel: {
    fontSize: 9,
    color: colors.textMuted,
    fontWeight: '600',
    marginTop: 2,
    textTransform: 'uppercase',
  },

  // Action Bar / Pool Styles
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    paddingHorizontal: 4,
  },

  // Pool Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'flex-end',
  },
  poolModalContent: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '75%',
    paddingTop: 16,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  poolModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.inputBorder,
  },
  poolModalTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
  },
  closePoolBtn: {
    padding: 4,
  },
  poolList: {
    marginTop: 12,
  },
  emptyPoolText: {
    color: colors.textMuted,
    textAlign: 'center',
    paddingVertical: 32,
    fontStyle: 'italic',
    fontSize: 13,
  },
  poolItemCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  poolItemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  poolItemNumber: {
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontWeight: '700',
    color: colors.textMuted,
  },
  poolItemCustomerName: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 2,
  },
  poolItemAddress: {
    fontSize: 11,
    color: colors.textSub,
  },
  backlogWarningText: {
    fontSize: 9,
    color: '#f59e0b',
    fontWeight: '700',
    marginBottom: 4,
  },

  // Redesigned Tab Styles
  tabBar: {
    flexDirection: 'row',
    backgroundColor: colors.inputBg,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    borderRadius: 12,
    padding: 3,
    borderWidth: 1,
    borderColor: colors.inputBorder,
  },
  tabItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 9,
  },
  tabItemActive: {
    backgroundColor: '#B91C1C',
  },
  tabItemText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
  },
  tabItemTextActive: {
    color: '#fff',
  },

  // Web-like filters styling
  filtersWrapper: {
    backgroundColor: colors.surface,
    borderColor: colors.surfaceBorder,
    borderWidth: 1,
    borderRadius: 12,
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 10,
  },
  filtersHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  filtersTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.text,
  },
  filtersToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.inputBg,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.inputBorder,
  },
  filtersToggleText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.textSub,
  },
  filtersGrid: {
    marginTop: 10,
    gap: 8,
  },
  filterRow: {
    flexDirection: 'row',
    gap: 10,
  },
  filterCol: {
    flex: 1,
  },
  filterLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: colors.textMuted,
    marginBottom: 4,
  },
  filterSelectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: 8,
    height: 36,
    paddingHorizontal: 8,
  },
  filterSelectBtnText: {
    fontSize: 11,
    color: colors.text,
    fontWeight: '600',
  },
  filterTextInput: {
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: 8,
    height: 36,
    paddingHorizontal: 8,
    color: colors.text,
    fontSize: 11,
    fontWeight: '600',
  },
  resetFiltersBtn: {
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.25)',
    borderRadius: 8,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resetFiltersText: {
    color: '#ef4444',
    fontSize: 11,
    fontWeight: '800',
  },

  // Empty state & Banner styling
  emptyTechBanner: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    paddingHorizontal: 24,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    marginTop: 8,
  },
  emptyTechBannerText: {
    color: colors.textSub,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 20,
  },

  summaryTechName: {
    fontSize: 13,
    color: colors.textSub,
    fontWeight: '700',
    marginBottom: 10,
  },

  // Choices dialog modals
  choiceModalContent: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '60%',
    paddingTop: 16,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    paddingBottom: 24,
  },
  modalSearchInput: {
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: 10,
    height: 40,
    paddingHorizontal: 12,
    color: colors.text,
    fontSize: 13,
    marginBottom: 12,
  },
  choiceRow: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.inputBorder,
  },
  choiceText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  choiceSubText: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },

  // Technicians List Container and Grid
  techsListContainer: {
    padding: 4,
  },
  techsListHeader: {
    marginBottom: 12,
  },
  techsListTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  techsGrid: {
    gap: 12,
  },
  techCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    borderRadius: 16,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  techCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  techAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    position: 'relative',
  },
  techAvatarText: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.text,
  },
  onlineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#10b981',
    position: 'absolute',
    bottom: -1,
    right: -1,
    borderWidth: 1.5,
    borderColor: '#fff',
  },
  techNameText: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.text,
    flex: 1,
    marginRight: 8,
  },
  techStatsText: {
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontWeight: '700',
    color: colors.textSub,
  },
  techRegionText: {
    fontSize: 11,
    color: colors.textMuted,
    flex: 1,
    marginRight: 8,
  },
  techInProgressText: {
    fontSize: 10,
    color: colors.textMuted,
  },

  // Back to techs list
  backToTechsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 2,
  },
  backToTechsBtnText: {
    fontSize: 13,
    color: '#B91C1C',
    fontWeight: '800',
    marginLeft: 4,
  },

  // Timeline footer and action buttons
  timelineFooter: {
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: colors.inputBorder,
    gap: 12,
  },
  footerPoolStats: {
    fontSize: 12,
    color: colors.textSub,
    fontWeight: '600',
    textAlign: 'center',
  },
  footerActionsRow: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
  },
  footerActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.inputBg,
    borderColor: colors.inputBorder,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 8,
    position: 'relative',
  },
  footerActionBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.text,
  },
  overdueBadge: {
    position: 'absolute',
    top: -6,
    right: -4,
    backgroundColor: '#b91c1c',
    borderRadius: 8,
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    minWidth: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overdueBadgeText: {
    color: '#fff',
    fontSize: 8,
    fontWeight: '900',
  },

  // Sort and Overdue Modal specific layouts
  sortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.inputBorder,
  },
  sortSeqBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(185, 28, 28, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sortSeqText: {
    color: '#B91C1C',
    fontSize: 10,
    fontWeight: '800',
  },
  sortCustomerText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  sortProductText: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },
  sortControls: {
    flexDirection: 'row',
    gap: 8,
    marginLeft: 12,
  },
  sortArrowBtn: {
    padding: 6,
    backgroundColor: colors.inputBg,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.inputBorder,
  },
  sortModalFooter: {
    marginTop: 16,
    borderTopWidth: 1,
    borderTopColor: colors.inputBorder,
    paddingTop: 16,
    alignItems: 'flex-end',
  },
  sortDoneBtn: {
    backgroundColor: '#0f172a',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    minWidth: 100,
    alignItems: 'center',
  },
  sortDoneBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
  },

  // Overdue item cards
  overdueItemCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    borderRadius: 14,
    padding: 14,
    flexDirection: 'column',
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
    gap: 10,
  },
  overdueRescheduleControls: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  overdueSelectDateBtn: {
    flex: 1,
    height: 36,
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overdueSelectDateBtnText: {
    fontSize: 12,
    color: colors.text,
    fontWeight: '700',
  },
  overdueRescheduleSubmitBtn: {
    backgroundColor: '#b91c1c',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overdueRescheduleSubmitBtnText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '800',
  },

  // Pool multi-select footer
  poolModalFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.inputBorder,
    paddingTop: 14,
    marginTop: 10,
    paddingBottom: 16,
  },
  selectedCountText: {
    fontSize: 12,
    color: colors.textSub,
    fontWeight: '700',
  },
  poolAssignSubmitBtn: {
    backgroundColor: '#B91C1C',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  poolAssignSubmitBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
  },

  // Web-specific customized header details
  webTechTimelineHeader: {
    marginTop: 4,
    marginBottom: 10,
  },
  webTechTimelineName: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
  },
  webTechTimelineRegion: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },

  // Web-like Atanmis Gorev Yok UI
  webNoTasksContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 44,
    paddingHorizontal: 20,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    borderStyle: 'dashed',
    marginTop: 8,
  },
  webNoTasksTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
    marginBottom: 6,
  },
  webNoTasksSub: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 18,
  },

  // Web buttons in filters grid
  webResetFilterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E11D48',
    borderRadius: 8,
    height: 36,
  },
  webResetFilterBtnText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '800',
  },
  webRefreshBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.inputBg,
    borderColor: colors.inputBorder,
    borderWidth: 1,
    borderRadius: 8,
    height: 36,
  },
});
