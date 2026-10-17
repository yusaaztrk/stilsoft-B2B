import React, { useEffect, useState, useMemo } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Bell, Check, CheckCheck, Trash2, Clock, AlertCircle, ChevronRight } from 'lucide-react-native';
import { useSessionStore } from '../../shared/session/store';
import { useThemeColors, useThemeStore } from '../../shared/theme/store';
import { apiJson } from '../../shared/api/client';
import { useAssignmentNotification } from '../../shared/hooks/useSignalR';
import Card from '../../components/ui/Card';

interface NotificationItem {
  id: string;
  technicianId: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
  jobType: string | null;
  jobId: string | null;
}

export default function NotificationsScreen() {
  const navigation = useNavigation<any>();
  const colors = useThemeColors();
  const theme = useThemeStore((s) => s.theme);
  const isDark = theme === 'dark';
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);

  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchNotifications = async (showLoadingIndicator = true) => {
    if (showLoadingIndicator) setIsLoading(true);
    setError(null);
    try {
      const data = await apiJson<NotificationItem[]>('/api/notifications');
      setNotifications(data);
    } catch (err) {
      console.warn('Failed to fetch notifications:', err);
      setError('Bildirimler yüklenirken bir sorun oluştu.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchNotifications();
  }, []);

  // Yeni iş atandığı anda liste tazelenir — kullanıcı aşağı çekmek zorunda kalmasın.
  // Sesli okuma kök dinleyicide yapılıyor, burada tekrarlanmıyor.
  useAssignmentNotification(() => {
    fetchNotifications(false);
  });

  const handleRefresh = () => {
    setIsRefreshing(true);
    fetchNotifications(false);
  };

  const handleMarkAsRead = async (id: string) => {
    try {
      await apiJson(`/api/notifications/${id}/read`, { method: 'PATCH' });
      setNotifications(prev =>
        prev.map(n => n.id === id ? { ...n, isRead: true } : n)
      );
    } catch (err) {
      console.warn('Failed to mark read:', err);
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      await apiJson('/api/notifications/read-all', { method: 'POST' });
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
    } catch (err) {
      console.warn('Failed to mark all as read:', err);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiJson(`/api/notifications/${id}`, { method: 'DELETE' });
      setNotifications(prev => prev.filter(n => n.id !== id));
    } catch (err) {
      console.warn('Failed to delete notification:', err);
    }
  };

  const handleNavigateToJob = (item: NotificationItem) => {
    if (!item.jobId) return;

    // First mark as read
    if (!item.isRead) {
      handleMarkAsRead(item.id);
    }

    if (item.jobType === 'ServiceRecord') {
      navigation.navigate('Jobs', {
        screen: 'ServiceRecordDetail',
        params: { serviceId: item.jobId }
      });
    } else if (item.jobType === 'InstallationTask') {
      navigation.navigate('Jobs', {
        screen: 'InstallationDetail',
        params: { serviceId: item.jobId }
      });
    } else if (item.jobType === 'CargoTrackingTask') {
      navigation.navigate('Kargo');
    }
  };

  const hasUnread = notifications.some(n => !n.isRead);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.titleCol}>
          <View style={styles.titleRow}>
            <Bell color="#B91C1C" size={24} style={{ marginRight: 8 }} />
            <Text style={styles.title}>Bildirimler</Text>
          </View>
          <Text style={styles.subtitle}>Size atanan işlerin anlık takibi</Text>
        </View>
        
        {hasUnread && (
          <TouchableOpacity 
            style={styles.markAllBtn}
            onPress={handleMarkAllAsRead}
            activeOpacity={0.7}
          >
            <CheckCheck color="#fff" size={16} />
            <Text style={styles.markAllText}>Tümünü Oku</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* List Content */}
      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color="#B91C1C" size="large" />
          <Text style={styles.loadingText}>Bildirimler yükleniyor...</Text>
        </View>
      ) : error ? (
        <View style={styles.errorContainer}>
          <AlertCircle color="#EF4444" size={32} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => fetchNotifications()}>
            <Text style={styles.retryBtnText}>Yeniden Dene</Text>
          </TouchableOpacity>
        </View>
      ) : notifications.length === 0 ? (
        <ScrollView
          contentContainerStyle={styles.emptyContainer}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor="#B91C1C" />
          }
        >
          <View style={styles.emptyIconCircle}>
            <Bell color={colors.textSub} size={36} />
          </View>
          <Text style={styles.emptyText}>Henüz bildiriminiz bulunmuyor</Text>
          <Text style={styles.emptySubText}>Yeni bir görev atandığında anlık bildirim alacaksınız.</Text>
        </ScrollView>
      ) : (
        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor="#B91C1C" />
          }
        >
          {notifications.map((item) => (
            <Card 
              key={item.id}
              style={[
                styles.itemCard,
                !item.isRead && styles.itemCardUnread
              ]}
            >
              <View style={styles.itemRow}>
                {/* Icon wrapper */}
                <View style={[
                  styles.iconCircle,
                  item.isRead ? styles.iconCircleRead : styles.iconCircleUnread
                ]}>
                  <Bell color={item.isRead ? colors.textSub : '#B91C1C'} size={18} />
                </View>

                {/* Body info */}
                <View style={styles.itemBody}>
                  <View style={styles.itemHeader}>
                    <Text 
                      style={[
                        styles.itemTitle, 
                        !item.isRead && styles.itemTitleUnread
                      ]}
                      numberOfLines={1}
                    >
                      {item.title}
                    </Text>
                    {!item.isRead && (
                      <View style={styles.unreadDot} />
                    )}
                  </View>
                  <Text style={styles.itemMessage} numberOfLines={3}>
                    {item.message}
                  </Text>

                  <View style={styles.metaRow}>
                    <View style={styles.timeRow}>
                      <Clock color={colors.textSub} size={11} style={{ marginRight: 4 }} />
                      <Text style={styles.timeText}>
                        {new Date(item.createdAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}{' '}
                        {new Date(item.createdAt).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })}
                      </Text>
                    </View>

                    {item.jobId && (
                      <TouchableOpacity 
                        style={styles.actionBtn}
                        onPress={() => handleNavigateToJob(item)}
                        activeOpacity={0.6}
                      >
                        <Text style={styles.actionBtnText}>İşi Gör</Text>
                        <ChevronRight color="#B91C1C" size={12} />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              </View>

              {/* Action actions footer */}
              <View style={styles.cardActionsRow}>
                {!item.isRead && (
                  <TouchableOpacity
                    style={[styles.cardActionItem, { marginRight: 16 }]}
                    onPress={() => handleMarkAsRead(item.id)}
                  >
                    <Check color={colors.textSub} size={14} style={{ marginRight: 4 }} />
                    <Text style={styles.cardActionText}>Okundu İşaretle</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={styles.cardActionItem}
                  onPress={() => handleDelete(item.id)}
                >
                  <Trash2 color="#EF4444" size={14} style={{ marginRight: 4 }} />
                  <Text style={[styles.cardActionText, { color: '#EF4444' }]}>Sil</Text>
                </TouchableOpacity>
              </View>
            </Card>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function createStyles(colors: any, isDark: boolean) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.bg,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    titleCol: {
      flex: 1,
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    title: {
      fontSize: 18,
      fontWeight: 'bold',
      color: colors.text,
    },
    subtitle: {
      fontSize: 11,
      color: colors.textSub,
      marginTop: 2,
    },
    markAllBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: '#B91C1C',
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 8,
      gap: 4,
    },
    markAllText: {
      color: '#fff',
      fontSize: 11,
      fontWeight: 'bold',
    },
    loadingContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
    },
    loadingText: {
      fontSize: 13,
      color: colors.textSub,
    },
    errorContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 32,
      gap: 12,
    },
    errorText: {
      fontSize: 14,
      color: colors.textSub,
      textAlign: 'center',
    },
    retryBtn: {
      backgroundColor: colors.border,
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: 8,
    },
    retryBtnText: {
      fontSize: 13,
      fontWeight: 'bold',
      color: colors.text,
    },
    emptyContainer: {
      flexGrow: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 32,
    },
    emptyIconCircle: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 16,
    },
    emptyText: {
      fontSize: 15,
      fontWeight: 'bold',
      color: colors.text,
      textAlign: 'center',
    },
    emptySubText: {
      fontSize: 12,
      color: colors.textSub,
      textAlign: 'center',
      marginTop: 6,
      lineHeight: 18,
    },
    list: {
      flex: 1,
    },
    listContent: {
      padding: 12,
      gap: 10,
    },
    itemCard: {
      padding: 12,
      backgroundColor: colors.card,
    },
    itemCardUnread: {
      borderLeftWidth: 3,
      borderLeftColor: '#B91C1C',
    },
    itemRow: {
      flexDirection: 'row',
      gap: 12,
    },
    iconCircle: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
    },
    iconCircleRead: {
      backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
    },
    iconCircleUnread: {
      backgroundColor: 'rgba(185, 28, 28, 0.08)',
    },
    itemBody: {
      flex: 1,
    },
    itemHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    itemTitle: {
      fontSize: 13,
      fontWeight: 'bold',
      color: colors.textSub,
      flex: 1,
    },
    itemTitleUnread: {
      color: colors.text,
    },
    unreadDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: '#B91C1C',
    },
    itemMessage: {
      fontSize: 12,
      color: colors.textSub,
      marginTop: 4,
      lineHeight: 16,
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 8,
      paddingTop: 8,
      borderTopWidth: 1,
      borderTopColor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.01)',
    },
    timeRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    timeText: {
      fontSize: 10,
      color: colors.textSub,
    },
    actionBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
    },
    actionBtnText: {
      fontSize: 11,
      fontWeight: 'bold',
      color: '#B91C1C',
    },
    cardActionsRow: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      marginTop: 8,
      paddingTop: 8,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    cardActionItem: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    cardActionText: {
      fontSize: 11,
      color: colors.textSub,
      fontWeight: '600',
    },
  });
}
