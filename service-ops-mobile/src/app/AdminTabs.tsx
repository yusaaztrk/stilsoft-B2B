import React from 'react';
import { 
  View, 
  Text, 
  TouchableOpacity, 
  Animated, 
  StyleSheet, 
  ScrollView, 
  Pressable 
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useNavigationState, useNavigation } from '@react-navigation/native';
import DashboardStack from './DashboardStack';
import UrunKabulStack from './UrunKabulStack';
import CalendarStack from './CalendarStack';
import SettingsScreen from '../pages/settings/SettingsScreen';
import LocationTrackingScreen from '../pages/admin/LocationTrackingScreen';
import UnauthorizedScreen from '../pages/auth/UnauthorizedScreen';
import InstallationStack from './InstallationStack';
import PlanningStack from './PlanningStack';
import TechniciansStack from './TechniciansStack';
import RoutesStack from './RoutesStack';
import StockStack from './StockStack';
import CustomersStack from './CustomersStack';
import ArizaStack from './ArizaStack';
import AdminKargoTakipScreen from '../pages/admin/AdminKargoTakipScreen';
import VehicleDepotSaleScreen from '../pages/technician/VehicleDepotSaleScreen';
import SilinenKayitlarScreen from '../pages/admin/SilinenKayitlarScreen';
import { useThemeStore } from '../shared/theme/store';
import { useSessionStore } from '../shared/session/store';
import { logoutShared } from '../shared/session/sharedSession';
import { 
  LayoutDashboard,
  Wrench,
  PackageCheck,
  CalendarDays,
  Users,
  Map,
  Package,
  User,
  CalendarClock,
  Settings,
  MapPin,
  AlertTriangle,
  Menu,
  LogOut,
  X,
  Building2,
  Warehouse,
  Trash2,
} from 'lucide-react-native';

export type AdminTabParamList = {
  Dashboard: undefined;
  Installations: undefined;
  Ariza: undefined;
  Acceptance: undefined;
  ArizaPlanning: { planningKind: 'repair' | 'installation' } | undefined;
  MontajPlanning: { planningKind: 'repair' | 'installation' } | undefined;
  Technicians: undefined;
  Routes: undefined;
  Stock: undefined;
  VehicleDepotSale: undefined;
  Customers: undefined;
  Calendar: undefined;
  Tracking: undefined;
  Settings: undefined;
  Kargo: undefined;
  SilinenKayitlar: undefined;
};

const Tab = createBottomTabNavigator<AdminTabParamList>();

const DRAWER_WIDTH = 300;
const HiddenTabButton = () => null;

function CustomTabBar({ state, navigation, isDark, setDrawerOpen }: { state: any; navigation: any; isDark: boolean; setDrawerOpen: (open: boolean) => void }) {
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
          onPress={() => navigation.navigate('Dashboard')}
          activeOpacity={0.7}
        >
          <LayoutDashboard color={activeRouteName === 'Dashboard' ? activeColor : inactiveColor} size={22} />
          <Text style={[styles.tabLabel, { color: activeRouteName === 'Dashboard' ? activeColor : inactiveColor }]}>Panel</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={styles.tabItem} 
          onPress={() => navigation.navigate('Acceptance')}
          activeOpacity={0.7}
        >
          <Package color={activeRouteName === 'Acceptance' ? activeColor : inactiveColor} size={22} />
          <Text style={[styles.tabLabel, { color: activeRouteName === 'Acceptance' ? activeColor : inactiveColor }]}>Kabul</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={styles.tabItem} 
          onPress={() => navigation.navigate('ArizaPlanning')}
          activeOpacity={0.7}
        >
          <CalendarClock color={(activeRouteName === 'ArizaPlanning' || activeRouteName === 'MontajPlanning') ? activeColor : inactiveColor} size={22} />
          <Text style={[styles.tabLabel, { color: (activeRouteName === 'ArizaPlanning' || activeRouteName === 'MontajPlanning') ? activeColor : inactiveColor }]}>Planlama</Text>
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
          style={styles.menuCrescentButton} 
          onPress={() => setDrawerOpen(true)} 
          activeOpacity={0.8}
        >
          <Menu color="#FFF" size={20} />
          <Text style={styles.menuCrescentLabel}>Menü</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function AdminTabs() {
  const theme = useThemeStore((s) => s.theme);
  const isDark = theme === 'dark';
  
  const { username, tenantCode, role, clearSession } = useSessionStore();
  const navigation = useNavigation<any>();

  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [shouldRenderDrawer, setShouldRenderDrawer] = React.useState(false);

  const slideAnim = React.useRef(new Animated.Value(DRAWER_WIDTH)).current;
  const opacityAnim = React.useRef(new Animated.Value(0)).current;

  // React Navigation State listener to detect active tab
  const activeRouteName = useNavigationState((state) => {
    if (!state) return 'Dashboard';
    const route = state.routes[state.index];
    return route?.name || 'Dashboard';
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
    if (routeName === 'SahaAriza') {
      navigation.navigate('Admin', {
        screen: 'Ariza',
        params: { screen: 'SahaAriza' }
      });
    } else if (routeName === 'AtolyeAriza') {
      navigation.navigate('Admin', {
        screen: 'Ariza',
        params: { screen: 'AtolyeAriza' }
      });
    } else {
      navigation.navigate('Admin', { screen: routeName });
    }
  };

  const handleLogout = async () => {
    setDrawerOpen(false);
    // Çıkış ortak kayda yazılır: bayi tarafındaki oturum da düşer.
    await logoutShared();
    await clearSession();
  };

  const isSuperAdmin = role?.toLowerCase() === 'superadmin' || role?.toLowerCase() === 'supersuperadmin';

  const categories = [
    {
      title: 'ANA MENÜ',
      items: [
        { name: 'Dashboard', label: 'Dashboard', icon: LayoutDashboard },
        { name: 'Acceptance', label: 'Ürün Kabul', icon: Package },
        { name: 'SahaAriza', label: 'Saha Ürün Arıza', icon: MapPin },
        { name: 'AtolyeAriza', label: 'Atölye Ürün Arıza', icon: Wrench },
        { name: 'ArizaPlanning', label: 'Ürün Arıza Planlama', icon: CalendarDays },
        { name: 'Installations', label: 'Montaj Yönetimi', icon: AlertTriangle },
        { name: 'Kargo', label: 'Kargo Takibi', icon: Package },
        { name: 'MontajPlanning', label: 'Montaj Planlama', icon: CalendarClock },
        { name: 'Technicians', label: 'Teknisyenler', icon: Users },
        { name: 'Calendar', label: 'Takvim', icon: CalendarDays },
        { name: 'Routes', label: 'Rota', icon: MapPin },
        { name: 'Customers', label: 'Müşteriler/Bayiler', icon: Building2 },
        { name: 'Stock', label: 'Stok', icon: Package },
        { name: 'VehicleDepotSale', label: 'Araç Depoları (Satış)', icon: Warehouse },
        { name: 'SilinenKayitlar', label: 'Silinen Kayıtlar', icon: Trash2 },
        ...(isSuperAdmin ? [{ name: 'Tracking', label: 'Teknisyen Takip', icon: MapPin }] : []),
      ]
    },
    {
      title: 'DİĞER',
      items: [
        { name: 'Settings', label: 'Ayarlar', icon: Settings },
      ]
    }
  ];

  return (
    <View style={styles.flex1}>
      {/* Bottom Tab Navigator acting as main layout */}
      <Tab.Navigator
        tabBar={(props) => <CustomTabBar {...props} isDark={isDark} setDrawerOpen={setDrawerOpen} />}
        screenOptions={{
          headerShown: false,
        }}
      >
        <Tab.Screen name="Dashboard" component={DashboardStack} />
        <Tab.Screen name="Installations" component={InstallationStack} />
        <Tab.Screen name="Ariza" component={ArizaStack} />
        <Tab.Screen name="Acceptance" component={UrunKabulStack} />
        <Tab.Screen name="ArizaPlanning" component={PlanningStack} initialParams={{ planningKind: 'repair' }} />
        <Tab.Screen name="MontajPlanning" component={PlanningStack} initialParams={{ planningKind: 'installation' }} />
        <Tab.Screen name="Technicians" component={TechniciansStack} />
        <Tab.Screen name="Routes" component={RoutesStack} />
        <Tab.Screen name="Stock" component={StockStack} />
        <Tab.Screen name="VehicleDepotSale" component={VehicleDepotSaleScreen} />
        <Tab.Screen name="Customers" component={CustomersStack} />
        <Tab.Screen name="Calendar" component={CalendarStack} />
        <Tab.Screen name="Tracking" component={isSuperAdmin ? LocationTrackingScreen : UnauthorizedScreen} />
        <Tab.Screen name="Settings" component={SettingsScreen} />
        <Tab.Screen name="Kargo" component={AdminKargoTakipScreen} />
        <Tab.Screen name="SilinenKayitlar" component={SilinenKayitlarScreen} />
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
                      {username ? username[0].toUpperCase() : 'A'}
                    </Text>
                  </View>
                  <View style={styles.profileInfo}>
                    <Text style={[styles.profileName, isDark ? styles.textWhite : styles.textDark]}>
                      {username || 'Yönetici'}
                    </Text>
                    <Text style={styles.profileRole}>
                      {tenantCode || 'Admin Hesabı'}
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

              {/* Drawer Navigation List with Categories */}
              <ScrollView 
                style={styles.flex1} 
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
              >
                {categories.map((category) => (
                  <View key={category.title} style={styles.categoryBlock}>
                    <Text style={styles.categoryTitle}>{category.title}</Text>
                    
                    {category.items.map((item) => {
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
                          </View>
                          {isActive && <View style={styles.activeIndicator} />}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ))}
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
  floatingMenuButton: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#B91C1C',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#B91C1C',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 8,
    zIndex: 999,
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
});
