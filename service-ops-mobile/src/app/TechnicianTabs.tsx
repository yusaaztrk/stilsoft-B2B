import React from 'react';
import { View, Text, TouchableOpacity, Animated, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useNavigationState, useNavigation } from '@react-navigation/native';
import JobsStack from './JobsStack';
import InstallationStack from './InstallationStack';
import RepairStack from './RepairStack';
import CalendarStack from './CalendarStack';
import KargoStack from './KargoStack';
import StockStack from './StockStack';
import SettingsScreen from '../pages/settings/SettingsScreen';
import LocationTrackingScreen from '../pages/admin/LocationTrackingScreen';
import VehicleDepotSaleScreen from '../pages/technician/VehicleDepotSaleScreen';
import NotificationsScreen from '../pages/technician/NotificationsScreen';
import { useLocationTracker } from '../shared/hooks/useLocationTracker';
import { useSessionStore } from '../shared/session/store';
import { logoutShared } from '../shared/session/sharedSession';
import { useThemeStore } from '../shared/theme/store';
import { 
  Briefcase, 
  Wrench, 
  PenTool, 
  CalendarDays, 
  Settings, 
  MapPin, 
  Package,
  Menu,
  LogOut,
  X,
  Warehouse,
  Bell
} from 'lucide-react-native';

export type TechnicianTabParamList = {
  Jobs: undefined;
  Installations: undefined;
  SahaRepairs: { repairKind: 'saha' | 'atolye' } | undefined;
  AtolyeRepairs: { repairKind: 'saha' | 'atolye' } | undefined;
  Kargo: undefined;
  Calendar: undefined;
  Tracking: undefined;
  Settings: undefined;
  Stock: undefined;
  VehicleDepotSale: undefined;
  Notifications: undefined;
};

import { apiJson } from '../shared/api/client';

const Tab = createBottomTabNavigator<TechnicianTabParamList>();
const DRAWER_WIDTH = 300;

function CustomTabBar({ state, navigation, isDark, setDrawerOpen, unreadCount }: { state: any; navigation: any; isDark: boolean; setDrawerOpen: (open: boolean) => void; unreadCount: number }) {
  const insets = useSafeAreaInsets();
  const activeRouteName = state.routes[state.index].name;
  const inactiveColor = isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.4)';
  const activeColor = '#B91C1C';

  return (
    <View style={[
      styles.tabBarContainer, 
      isDark ? styles.tabBarDark : styles.tabBarLight,
      { height: 60 + insets.bottom, paddingBottom: insets.bottom }
    ]}>
      <View style={styles.tabBarRow}>
        <TouchableOpacity 
          style={styles.tabItem} 
          onPress={() => navigation.navigate('Jobs')}
          activeOpacity={0.7}
        >
          <Briefcase color={activeRouteName === 'Jobs' ? activeColor : inactiveColor} size={22} />
          <Text style={[styles.tabLabel, { color: activeRouteName === 'Jobs' ? activeColor : inactiveColor }]}>İşlerim</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={styles.tabItem} 
          onPress={() => navigation.navigate('Calendar')}
          activeOpacity={0.7}
        >
          <CalendarDays color={activeRouteName === 'Calendar' ? activeColor : inactiveColor} size={22} />
          <Text style={[styles.tabLabel, { color: activeRouteName === 'Calendar' ? activeColor : inactiveColor }]}>Takvim</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={styles.tabItem} 
          onPress={() => navigation.navigate('Settings')}
          activeOpacity={0.7}
        >
          <Settings color={activeRouteName === 'Settings' ? activeColor : inactiveColor} size={22} />
          <Text style={[styles.tabLabel, { color: activeRouteName === 'Settings' ? activeColor : inactiveColor }]}>Ayarlar</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={styles.menuCrescentButton} 
          onPress={() => setDrawerOpen(true)} 
          activeOpacity={0.8}
        >
          <Menu color="#FFF" size={20} />
          {unreadCount > 0 && (
            <View style={styles.menuBadgeDot} />
          )}
          <Text style={styles.menuCrescentLabel}>Menü</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function TechnicianTabs() {
  useLocationTracker();
  const roles = useSessionStore(s => s.technicianRoles) || [];
  const theme = useThemeStore((s) => s.theme);
  const isDark = theme === 'dark';
  
  const { username, tenantCode, clearSession, technicianId } = useSessionStore();
  const navigation = useNavigation<any>();

  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [shouldRenderDrawer, setShouldRenderDrawer] = React.useState(false);
  const [unreadCount, setUnreadCount] = React.useState(0);

  const fetchUnreadCount = async () => {
    try {
      const data = await apiJson<number>('/api/notifications/unread-count');
      setUnreadCount(data);
    } catch (e) {
      console.warn('Failed to fetch unread notifications count in mobile tab', e);
    }
  };

  React.useEffect(() => {
    fetchUnreadCount();
    const interval = setInterval(fetchUnreadCount, 30000);
    return () => clearInterval(interval);
  }, []);

  const slideAnim = React.useRef(new Animated.Value(DRAWER_WIDTH)).current;
  const opacityAnim = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    if (technicianId) {
      apiJson(`/api/technicians/${technicianId}/online`, {
        method: 'PATCH',
        body: JSON.stringify({ isOnline: true }),
      }).catch(e => console.warn('Failed to set online status to true on startup', e));
    }
  }, [technicianId]);

  // React Navigation State listener to detect active tab
  const activeRouteName = useNavigationState((state) => {
    if (!state) return 'Jobs';
    const route = state.routes[state.index];
    return route?.name || 'Jobs';
  });

  React.useEffect(() => {
    if (drawerOpen) {
      setShouldRenderDrawer(true);
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        })
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: DRAWER_WIDTH,
          duration: 220,
          useNativeDriver: true,
        }),
        Animated.timing(opacityAnim, {
          toValue: 0,
          duration: 220,
          useNativeDriver: true,
        })
      ]).start(() => {
        setShouldRenderDrawer(false);
      });
    }
  }, [drawerOpen, slideAnim, opacityAnim]);

  const handleNavigate = (routeName: string) => {
    setDrawerOpen(false);
    navigation.navigate('Technician', { screen: routeName });
  };

  const handleLogout = async () => {
    setDrawerOpen(false);
    if (technicianId) {
      try {
        await apiJson(`/api/technicians/${technicianId}/online`, {
          method: 'PATCH',
          body: JSON.stringify({ isOnline: false }),
        });
      } catch (e) {
        console.warn('Failed to update technician online status to false at logout', e);
      }
    }
    // Çıkış ortak kayda yazılır: bayi tarafındaki oturum da düşer.
    await logoutShared();
    await clearSession();
  };

  const categoryItems = [
    { name: 'Notifications', label: 'Bildirimler', icon: Bell, badge: unreadCount },
    ...(roles.length === 0 || roles.includes('Montaj') ? [{ name: 'Installations', label: 'Montaj', icon: Wrench }] : []),
    ...(roles.length === 0 || roles.includes('Kargo') ? [{ name: 'Kargo', label: 'Kargo', icon: Package }] : []),
    ...(roles.length === 0 || roles.includes('Saha Arıza') ? [{ name: 'SahaRepairs', label: 'Saha Arıza', icon: PenTool }] : []),
    ...(roles.length === 0 || roles.includes('Atölye Arıza') ? [{ name: 'AtolyeRepairs', label: 'Atölye Arıza', icon: Wrench }] : []),
    { name: 'Stock', label: 'Stok', icon: Package },
    { name: 'VehicleDepotSale', label: 'Araç Depoları (Satış)', icon: Warehouse },
    { name: 'Tracking', label: 'Canlı Takip', icon: MapPin }
  ];

  return (
    <View style={styles.flex1}>
      <Tab.Navigator
        tabBar={(props) => <CustomTabBar {...props} isDark={isDark} setDrawerOpen={setDrawerOpen} unreadCount={unreadCount} />}
        screenOptions={{
          headerShown: false,
        }}
      >
        <Tab.Screen name="Jobs" component={JobsStack} />
        <Tab.Screen name="Calendar" component={CalendarStack} />
        <Tab.Screen name="Settings" component={SettingsScreen} />
        
        {/* Secondary role-dependent screens in navigator stack */}
        <Tab.Screen name="Notifications" component={NotificationsScreen} />
        <Tab.Screen name="Installations" component={InstallationStack} />
        <Tab.Screen name="Kargo" component={KargoStack} />
        <Tab.Screen name="SahaRepairs" component={RepairStack} initialParams={{ repairKind: 'saha' }} />
        <Tab.Screen name="AtolyeRepairs" component={RepairStack} initialParams={{ repairKind: 'atolye' }} />
        <Tab.Screen name="Stock" component={StockStack} />
        <Tab.Screen name="VehicleDepotSale" component={VehicleDepotSaleScreen} />
        <Tab.Screen name="Tracking" component={LocationTrackingScreen} />
      </Tab.Navigator>

      {/* Slide-out Sidebar Drawer Overlay */}
      {shouldRenderDrawer && (
        <View style={StyleSheet.absoluteFill}>
          {/* Backdrop Overlay */}
          <Animated.View style={[styles.backdrop, { opacity: opacityAnim }]}>
            <Pressable style={styles.flex1} onPress={() => setDrawerOpen(false)} />
          </Animated.View>

          {/* Drawer Panel */}
          <Animated.View 
            style={[
              styles.drawerPanel, 
              isDark ? styles.drawerPanelDark : styles.drawerPanelLight,
              { transform: [{ translateX: slideAnim }] }
            ]}
          >
            <SafeAreaView style={styles.flex1} edges={['top', 'bottom']}>
              {/* Drawer Header (Profile) */}
              <View style={styles.drawerHeader}>
                <View style={styles.profileRow}>
                  <View style={styles.avatarCircle}>
                    <Text style={styles.avatarText}>
                      {username ? username[0].toUpperCase() : 'T'}
                    </Text>
                  </View>
                  <View style={styles.profileInfo}>
                    <Text style={[styles.profileName, isDark ? styles.textWhite : styles.textDark]}>
                      {username || 'Teknisyen'}
                    </Text>
                    <Text style={styles.profileRole}>
                      {tenantCode || 'Saha Ekibi'}
                    </Text>
                  </View>
                </View>
                <TouchableOpacity 
                  style={styles.closeButton} 
                  onPress={() => setDrawerOpen(false)}
                >
                  <X color={isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)'} size={20} />
                </TouchableOpacity>
              </View>

              {/* Drawer Navigation List */}
              <ScrollView 
                style={styles.flex1} 
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
              >
                <View style={styles.categoryBlock}>
                  <Text style={styles.categoryTitle}>KATEGORİLER</Text>
                  
                  {categoryItems.map((item) => {
                    const isActive = activeRouteName === item.name;
                    const Icon = item.icon;
                    
                    return (
                      <TouchableOpacity
                        key={item.name}
                        style={[
                          styles.drawerItem,
                          isActive && (isDark ? styles.drawerItemActiveDark : styles.drawerItemActiveLight)
                        ]}
                        onPress={() => handleNavigate(item.name)}
                      >
                        <View style={styles.itemLeftRow}>
                          <Icon 
                            color={isActive ? '#B91C1C' : (isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)')} 
                            size={18} 
                            style={styles.itemIcon}
                          />
                          <Text 
                            style={[
                              styles.itemLabel,
                              isDark ? styles.textWhite : styles.textDark,
                              isActive && styles.itemLabelActive
                            ]}
                          >
                            {item.label}
                          </Text>
                          {item.badge !== undefined && item.badge > 0 && (
                            <View style={styles.badgeContainer}>
                              <Text style={styles.badgeText}>{item.badge}</Text>
                            </View>
                          )}
                        </View>
                        {isActive && <View style={styles.activeIndicator} />}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </ScrollView>

              {/* Drawer Footer (Sign out) */}
              <View style={[styles.drawerFooter, isDark ? styles.drawerFooterDark : styles.drawerFooterLight]}>
                <TouchableOpacity 
                  style={styles.logoutButton}
                  onPress={handleLogout}
                >
                  <LogOut color="#EF4444" size={20} style={styles.itemIcon} />
                  <Text style={styles.logoutLabel}>Oturumu Kapat</Text>
                </TouchableOpacity>
              </View>
            </SafeAreaView>
          </Animated.View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  backdrop: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  drawerPanel: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    width: DRAWER_WIDTH,
    borderLeftWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: -4, height: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 5,
    elevation: 8,
  },
  drawerPanelDark: {
    backgroundColor: '#0f0f0f',
    borderLeftColor: 'rgba(255,255,255,0.08)',
  },
  drawerPanelLight: {
    backgroundColor: '#FFFFFF',
    borderLeftColor: 'rgba(0,0,0,0.08)',
  },
  drawerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 24,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  avatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#B91C1C',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
  },
  profileInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  profileName: {
    fontSize: 15,
    fontWeight: '700',
  },
  profileRole: {
    fontSize: 11,
    color: '#9CA3AF',
    marginTop: 2,
    fontWeight: '500',
  },
  closeButton: {
    padding: 8,
    borderRadius: 8,
  },
  scrollContent: {
    paddingHorizontal: 12,
    paddingBottom: 24,
  },
  categoryBlock: {
    marginBottom: 16,
  },
  categoryTitle: {
    fontSize: 10,
    fontWeight: '800',
    color: '#9CA3AF',
    letterSpacing: 1.5,
    marginTop: 18,
    marginBottom: 8,
    paddingHorizontal: 14,
  },
  drawerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    marginBottom: 2,
  },
  itemLeftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  drawerItemActiveDark: {
    backgroundColor: 'rgba(185, 28, 28, 0.12)',
  },
  drawerItemActiveLight: {
    backgroundColor: 'rgba(185, 28, 28, 0.06)',
  },
  itemIcon: {
    marginRight: 14,
  },
  itemLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  itemLabelActive: {
    fontWeight: '700',
    color: '#B91C1C',
  },
  activeIndicator: {
    width: 4,
    height: 18,
    borderRadius: 2,
    backgroundColor: '#B91C1C',
  },
  textWhite: {
    color: '#FFFFFF',
  },
  textDark: {
    color: '#111111',
  },
  drawerFooter: {
    padding: 16,
    borderTopWidth: 1,
  },
  drawerFooterDark: {
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  drawerFooterLight: {
    borderTopColor: 'rgba(0,0,0,0.06)',
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: 'rgba(239, 68, 68, 0.05)',
  },
  logoutLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#EF4444',
  },
  tabBarContainer: {
    borderTopWidth: 1,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
  },
  tabBarLight: {
    backgroundColor: '#FFFFFF',
    borderTopColor: 'rgba(0,0,0,0.06)',
  },
  tabBarDark: {
    backgroundColor: '#1F2937',
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  tabBarRow: {
    flexDirection: 'row',
    height: 60,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tabItem: {
    flex: 1,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: '600',
    marginTop: 4,
  },
  menuCrescentButton: {
    width: 75,
    height: 60,
    backgroundColor: '#B91C1C',
    borderTopLeftRadius: 30,
    borderBottomLeftRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#B91C1C',
    shadowOffset: { width: -2, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 5,
    elevation: 6,
  },
  menuCrescentLabel: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
    marginTop: 2,
  },
  badgeContainer: {
    backgroundColor: '#B91C1C',
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
    marginLeft: 8,
  },
  badgeText: {
    color: '#FFF',
    fontSize: 9,
    fontWeight: 'bold',
  },
  menuBadgeDot: {
    position: 'absolute',
    top: 6,
    right: 14,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#EF4444',
    borderWidth: 1.5,
    borderColor: '#B91C1C',
  },
});
