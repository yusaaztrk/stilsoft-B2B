import React, { useEffect, useState, useMemo, useCallback } from 'react'
import { useOutletContext, useSearchParams } from 'react-router-dom'
import { BellOff, CheckSquare, Clock, Search, Info, Bell, X, Trash2 } from 'lucide-react'
import {
  fetchNotifications,
  fetchSentNotifications,
  fetchTargetOptions,
  resolveRecipients,
  sendNotification,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  deleteNotification,
  type NotificationResponse,
  type TargetOptionsData,
} from '../api/notifications'

import NotificationTabs, { type TabType } from '../components/notifications/NotificationTabs'
import NotificationTargetSelector from '../components/notifications/NotificationTargetSelector'
import SelectedTargetsCard from '../components/notifications/SelectedTargetsCard'
import NotificationComposer from '../components/notifications/NotificationComposer'
import NotificationSendSummaryModal from '../components/notifications/NotificationSendSummaryModal'
import NotificationHistoryTable from '../components/notifications/NotificationHistoryTable'

export type NotificationsPageProps = {
  initialTab?: TabType
  isModal?: boolean
  onCloseModal?: () => void
  isSuperAdmin?: boolean
  allowedKeys?: Set<string>
}

export default function NotificationsPage({
  initialTab,
  isModal,
  onCloseModal,
  isSuperAdmin: propIsSuperAdmin,
  allowedKeys: propAllowedKeys
}: NotificationsPageProps = {}) {
  const context = useOutletContext<{ isSuperAdmin?: boolean; allowedKeys?: Set<string> }>() || {}
  
  const rawSsa = localStorage.getItem('isSuperSuperAdmin')
  const rawSa = localStorage.getItem('isSuperAdmin')
  const roleCode = (localStorage.getItem('roleCode') || '').toLowerCase().trim()
  const userName = (localStorage.getItem('userName') || '').toLowerCase().trim()

  // Yetki YALNIZ sunucunun verdiği bayraktan okunur.
  //
  // Buradaki zincir `??` ile kuruluydu; `??` sadece null/undefined'da devam ettiği için
  // `(rawSa === 'true')` (her zaman boolean) zinciri bitiriyor ve altındaki üç dal ÖLÜ koddu.
  // O ölü dalların sonuncusu şuydu:
  //     (userName === 'admin' || userName.includes('hayri'))
  // yani KULLANICI ADINA GÖRE yetki veren bir arka kapı. Bugün çalışmıyordu ama biri `??`
  // zincirini `||` sanıp "düzeltseydi", adında "hayri" geçen herkes bildirim gönderme
  // yetkisi kazanacaktı. Ölü dallar rol adına ve kullanıcı adına dayandığı için geri
  // getirilmedi de: rol adı yetki değildir, sunucunun bayrağı yetkidir.
  const isSuperAdmin = Boolean(
    propIsSuperAdmin ??
    context.isSuperAdmin ??
    (rawSa === 'true')
  )
  
  const allowedKeys = propAllowedKeys ?? context.allowedKeys ?? new Set(JSON.parse(localStorage.getItem('allowedKeys') || '[]'))

  // All authenticated users can view their own incoming notifications inbox
  const canViewInbox = true

  // Sending notifications and viewing sent history
  const canViewSend = isSuperAdmin
    || allowedKeys?.has('bildirimler/bildirimlerGonder')
    || allowedKeys?.has('users/bildirimlerGonder')
    || ['admin', 'superadmin', 'super_admin', 'yonetici'].includes(roleCode)

  // URL Tab Parameter or Local Modal Tab State
  const [searchParams, setSearchParams] = useSearchParams()
  const [modalTab, setModalTab] = useState<TabType>(
    initialTab || (canViewSend ? 'send' : 'incoming')
  )

  useEffect(() => {
    if (initialTab) {
      setModalTab(initialTab)
    }
  }, [initialTab])

  const currentTab = isModal ? modalTab : ((searchParams.get('tab') as TabType) || (canViewSend ? 'send' : 'incoming'))

  const setTab = (newTab: TabType) => {
    if (isModal) {
      setModalTab(newTab)
    } else {
      setSearchParams({ tab: newTab }, { replace: true })
    }
  }

  // Common target data
  const [targetData, setTargetData] = useState<TargetOptionsData | null>(null)
  const [targetLoading, setTargetLoading] = useState(false)

  // Target selection state
  const [selectedTargets, setSelectedTargets] = useState<string[]>([])
  const [includeAllActiveUsers, setIncludeAllActiveUsers] = useState(false)

  // Unique recipient count backend state
  const [uniqueRecipientCount, setUniqueRecipientCount] = useState<number>(0)
  const [isCalculatingRecipients, setIsCalculatingRecipients] = useState<boolean>(false)

  // Form state
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [isPopup, setIsPopup] = useState(true)
  const [sending, setSending] = useState(false)
  const [showSummaryModal, setShowSummaryModal] = useState(false)

  // Received (Inbox) states
  const [inboxList, setInboxList] = useState<NotificationResponse[]>([])
  const [inboxLoading, setInboxLoading] = useState(false)
  const [selectedNotification, setSelectedNotification] = useState<NotificationResponse | null>(null)
  const [inboxSearch, setInboxSearch] = useState('')

  // Sent history states
  const [sentList, setSentList] = useState<NotificationResponse[]>([])
  const [sentLoading, setSentLoading] = useState(false)

  // Feedback notification state
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const showFeedback = (type: 'success' | 'error', message: string) => {
    setFeedback({ type, message })
    setTimeout(() => {
      setFeedback(null)
    }, 4000)
  }

  // Load Target Options
  const loadTargets = useCallback(async () => {
    setTargetLoading(true)
    try {
      const res = await fetchTargetOptions()
      setTargetData(res)
    } catch (err: any) {
      console.error('Target options error:', err)
      showFeedback('error', err.message || 'Hedef seçenekleri yüklenemedi.')
    } finally {
      setTargetLoading(false)
    }
  }, [])

  // Load Inbox
  const loadInbox = useCallback(async () => {
    if (!canViewInbox) return
    setInboxLoading(true)
    try {
      const data = await fetchNotifications()
      setInboxList(data)
    } catch (err: any) {
      showFeedback('error', err.message || 'Gelen bildirimler yüklenemedi.')
    } finally {
      setInboxLoading(false)
    }
  }, [canViewInbox])

  // Load Sent History
  const loadSentHistory = useCallback(async () => {
    if (!canViewSend) return
    setSentLoading(true)
    try {
      const data = await fetchSentNotifications()
      setSentList(data)
    } catch (err: any) {
      showFeedback('error', err.message || 'Gönderilen bildirimler yüklenemedi.')
    } finally {
      setSentLoading(false)
    }
  }, [canViewSend])

  useEffect(() => {
    void loadInbox()
    void loadSentHistory()
    void loadTargets()
  }, [loadInbox, loadSentHistory, loadTargets])

  // Calculate Unique Recipients from Backend whenever selection changes
  useEffect(() => {
    const allKeys: string[] = []
    if (includeAllActiveUsers) {
      allKeys.push('all')
    }
    allKeys.push(...selectedTargets.filter((k) => k !== 'all'))

    if (allKeys.length === 0) {
      setUniqueRecipientCount(0)
      setIsCalculatingRecipients(false)
      return
    }

    setIsCalculatingRecipients(true)
    const timer = setTimeout(async () => {
      try {
        const count = await resolveRecipients(allKeys)
        setUniqueRecipientCount(count)
      } catch (err) {
        console.error('Resolve recipients error:', err)
      } finally {
        setIsCalculatingRecipients(false)
      }
    }, 250)

    return () => clearTimeout(timer)
  }, [selectedTargets, includeAllActiveUsers])

  // Toggle single target item
  const handleToggleTarget = (key: string) => {
    setSelectedTargets((prev) => {
      if (prev.includes(key)) {
        return prev.filter((k) => k !== key)
      }
      return [...prev, key]
    })
  }

  // Select all filtered keys
  const handleSelectAllFiltered = (keys: string[]) => {
    setSelectedTargets((prev) => {
      const set = new Set(prev)
      keys.forEach((k) => set.add(k))
      return Array.from(set)
    })
  }

  // Clear target keys for segment
  const handleClearTargetKeys = (keys: string[]) => {
    setSelectedTargets((prev) => prev.filter((k) => !keys.includes(k)))
  }

  // Remove single chip
  const handleRemoveTarget = (key: string) => {
    if (key === 'all') {
      setIncludeAllActiveUsers(false)
    } else {
      setSelectedTargets((prev) => prev.filter((k) => k !== key))
    }
  }

  // Clear all selections
  const handleClearAllTargets = () => {
    setSelectedTargets([])
    setIncludeAllActiveUsers(false)
  }

  // Submit trigger (Opens confirmation summary modal)
  const handleComposerSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !content.trim()) {
      showFeedback('error', 'Lütfen bildirim başlığı ve içeriğini doldurun.')
      return
    }
    if (title.trim().length > 25) {
      showFeedback('error', 'Bildirim başlığı en fazla 25 karakter olabilir.')
      return
    }
    if (!includeAllActiveUsers && selectedTargets.length === 0) {
      showFeedback('error', 'Lütfen en az bir hedef seçin.')
      return
    }
    setShowSummaryModal(true)
  }

  // Confirmed Send Execution
  const handleConfirmedSend = async () => {
    setSending(true)
    try {
      const allKeys: string[] = []
      if (includeAllActiveUsers) {
        allKeys.push('all')
      }
      allKeys.push(...selectedTargets.filter((k) => k !== 'all'))

      const payload = {
        targets: allKeys,
        title: title.trim().slice(0, 25),
        content: content.trim(),
        isPopup,
      }

      const res = await sendNotification(payload)
      showFeedback('success', res.message)

      // Reset form & selections
      setTitle('')
      setContent('')
      setSelectedTargets([])
      setIncludeAllActiveUsers(false)
      setShowSummaryModal(false)

      // Reload sent history
      void loadSentHistory()

      window.dispatchEvent(new CustomEvent('recheck-notifications'))
    } catch (err: any) {
      showFeedback('error', err.message || 'Bildirim gönderilemedi.')
    } finally {
      setSending(false)
    }
  }

  const handleDeleteNotification = async (id: number) => {
    if (!window.confirm('Bu bildirimi kalıcı olarak silmek istediğinize emin misiniz?')) return
    try {
      await deleteNotification(id)
      showFeedback('success', 'Bildirim başarıyla silindi.')
      void loadSentHistory()
      void loadInbox()
      window.dispatchEvent(new CustomEvent('notification-read'))
    } catch (err: any) {
      showFeedback('error', err.message || 'Bildirim silinemedi.')
    }
  }

  const handleMarkAllRead = async () => {
    try {
      await markAllNotificationsAsRead()
      void loadInbox()
      window.dispatchEvent(new CustomEvent('notification-read'))
      showFeedback('success', 'Tüm bildirimler okundu olarak işaretlendi.')
    } catch (err: any) {
      showFeedback('error', err.message || 'İşlem gerçekleştirilemedi.')
    }
  }

  const handleNotificationView = async (item: NotificationResponse) => {
    setSelectedNotification(item)
    if (!item.isRead) {
      try {
        await markNotificationAsRead(item.id)
        void loadInbox()
        window.dispatchEvent(new CustomEvent('notification-read'))
      } catch (err) {
        console.error('Mark read failed:', err)
      }
    }
  }

  const filteredInboxList = useMemo(() => {
    const q = inboxSearch.toLowerCase().trim()
    if (!q) return inboxList
    return inboxList.filter(
      (item) =>
        String(item.title ?? '').toLowerCase().includes(q) ||
        String(item.content ?? '').toLowerCase().includes(q) ||
        String(item.senderName ?? '').toLowerCase().includes(q) ||
        String(item.createUser ?? '').toLowerCase().includes(q)
    )
  }, [inboxList, inboxSearch])

  const unreadCount = useMemo(() => inboxList.filter((n) => !n.isRead).length, [inboxList])

  if (!canViewInbox && !canViewSend) {
    return (
      <div className="p-16 text-center text-slate-400 flex flex-col items-center gap-3 justify-center max-w-md mx-auto mt-20 bg-white border border-slate-100 rounded-2xl shadow-sm">
        <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center text-slate-300">
          <BellOff className="w-6 h-6" />
        </div>
        <div className="text-sm font-semibold text-slate-600">Erişim Yetkiniz Yok</div>
        <p className="text-xs leading-relaxed text-slate-400">
          Bildirimler sayfasına erişmek veya işlem yapmak için gerekli yetkilere sahip değilsiniz.
        </p>
      </div>
    )
  }

  const hasTargets = includeAllActiveUsers || selectedTargets.length > 0
  const allSelectedKeys = includeAllActiveUsers ? ['all', ...selectedTargets] : selectedTargets

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1440px] mx-auto space-y-6">
      {/* Feedback Toast */}
      {feedback && (
        <div
          className={`fixed top-4 right-4 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg border backdrop-blur-md transition-all duration-300 ${
            feedback.type === 'success'
              ? 'bg-emerald-50/95 border-emerald-200 text-emerald-800'
              : 'bg-rose-50/95 border-rose-200 text-rose-800'
          }`}
        >
          <Info className="w-5 h-5 flex-shrink-0" />
          <span className="text-xs sm:text-sm font-bold">{feedback.message}</span>
        </div>
      )}

      {/* Header and 3-Tab Bar */}
      <NotificationTabs
        activeTab={currentTab}
        onTabChange={setTab}
        unreadCount={unreadCount}
        canViewInbox={canViewInbox}
        canViewSend={canViewSend}
      />

      {/* TAB 1: Gelen Bildirimler */}
      {currentTab === 'incoming' && canViewInbox && (
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/40">
            <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              Gelen Kutusu ({inboxList.length})
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Başlık, içerik veya gönderende ara..."
                  value={inboxSearch}
                  onChange={(e) => setInboxSearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-1.5 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 bg-white text-slate-700 shadow-2xs"
                />
              </div>
              {inboxList.some((n) => !n.isRead) && (
                <button
                  type="button"
                  onClick={handleMarkAllRead}
                  className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl bg-orange-50 hover:bg-orange-100 text-orange-700 text-xs font-bold transition-all whitespace-nowrap cursor-pointer"
                >
                  <CheckSquare className="w-3.5 h-3.5" />
                  Tümünü Okundu İşaretle
                </button>
              )}
            </div>
          </div>

          {inboxLoading ? (
            <div className="p-12 text-center text-slate-400 text-xs">Bildirimler yükleniyor...</div>
          ) : inboxList.length === 0 ? (
            <div className="p-16 text-center text-slate-400 flex flex-col items-center gap-3 justify-center">
              <BellOff className="w-8 h-8 text-slate-300" />
              <div className="text-sm font-semibold text-slate-600">Henüz bir bildirim almadınız.</div>
            </div>
          ) : filteredInboxList.length === 0 ? (
            <div className="p-16 text-center text-slate-400 flex flex-col items-center gap-3 justify-center">
              <BellOff className="w-8 h-8 text-slate-300" />
              <div className="text-sm font-semibold text-slate-600">Arama sonucunda bildirim bulunamadı.</div>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {filteredInboxList.map((item) => (
                <div
                  key={item.id}
                  onClick={() => void handleNotificationView(item)}
                  className={`p-4 hover:bg-slate-50/50 cursor-pointer transition-colors flex items-start gap-4 ${
                    !item.isRead ? 'bg-orange-50/20 font-medium' : ''
                  }`}
                >
                  <div
                    className={`mt-1.5 w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                      !item.isRead ? 'bg-orange-600 animate-pulse' : 'bg-transparent'
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <h3
                        className={`text-sm truncate ${
                          !item.isRead ? 'font-bold text-slate-900' : 'text-slate-700'
                        }`}
                      >
                        {item.title}
                      </h3>
                      <span className="text-xs text-slate-400 flex items-center gap-1 font-medium whitespace-nowrap">
                        <Clock className="w-3 h-3" />
                        {new Date(item.createTime).toLocaleDateString('tr-TR', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 line-clamp-2 mt-1 leading-relaxed">
                      {item.content}
                    </p>
                    <div className="flex items-center gap-3 mt-2">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                        GÖNDEREN: <strong className="text-slate-600">{item.senderName || item.createUser}</strong>
                      </span>
                      {item.isPopup && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-orange-50 text-orange-600 border border-orange-100">
                          Pop-Up Bildirim
                        </span>
                      )}
                    </div>
                  </div>

                  {/* SİLME DÜĞMESİ. `stopPropagation` şart: satırın kendi onClick'i bildirimi
                      okundu işaretleyip detayını açıyor, olay yukarı sızarsa silmeden önce
                      o çalışıyor. Uç zaten sahiplik kontrollü (`n.UserId == userId`),
                      yani kullanıcı yalnız kendi bildirimini silebilir. */}
                  <button
                    type="button"
                    title="Bildirimi sil"
                    aria-label="Bildirimi sil"
                    onClick={(e) => {
                      e.stopPropagation()
                      void handleDeleteNotification(item.id)
                    }}
                    className="flex-shrink-0 mt-0.5 p-1.5 rounded-lg text-slate-300 hover:text-red-600 hover:bg-red-50 border border-transparent hover:border-red-100 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: Yeni Bildirim Gönder */}
      {currentTab === 'send' && canViewSend && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Target Selector (~60%) */}
          <div className="lg:col-span-7">
            <NotificationTargetSelector
              data={targetData}
              isLoading={targetLoading}
              selectedTargets={selectedTargets}
              includeAllActiveUsers={includeAllActiveUsers}
              onToggleTarget={handleToggleTarget}
              onSelectAllFiltered={handleSelectAllFiltered}
              onClearTargetKeys={handleClearTargetKeys}
              onToggleAllActiveUsers={(val) => setIncludeAllActiveUsers(val)}
            />
          </div>

          {/* Right Column: Summary & Composer (~40%) */}
          <div className="lg:col-span-5 space-y-6">
            <SelectedTargetsCard
              selectedTargets={selectedTargets}
              includeAllActiveUsers={includeAllActiveUsers}
              uniqueRecipientCount={uniqueRecipientCount}
              isCalculatingRecipients={isCalculatingRecipients}
              data={targetData}
              onRemoveTarget={handleRemoveTarget}
              onClearAll={handleClearAllTargets}
            />

            <NotificationComposer
              title={title}
              content={content}
              isPopup={isPopup}
              sending={sending}
              uniqueRecipientCount={uniqueRecipientCount}
              hasTargets={hasTargets}
              isCalculatingRecipients={isCalculatingRecipients}
              onTitleChange={setTitle}
              onContentChange={setContent}
              onIsPopupChange={setIsPopup}
              onSubmit={handleComposerSubmit}
            />
          </div>
        </div>
      )}

      {/* TAB 3: Gönderim Geçmişi */}
      {currentTab === 'history' && canViewSend && (
        <NotificationHistoryTable
          list={sentList}
          isLoading={sentLoading}
          onDelete={handleDeleteNotification}
        />
      )}

      {/* Pre-Send Summary Modal */}
      <NotificationSendSummaryModal
        isOpen={showSummaryModal}
        title={title}
        content={content}
        isPopup={isPopup}
        targetCount={allSelectedKeys.length}
        uniqueRecipientCount={uniqueRecipientCount}
        includeAllActiveUsers={includeAllActiveUsers}
        sending={sending}
        onClose={() => setShowSummaryModal(false)}
        onConfirm={handleConfirmedSend}
      />

      {/* Inbox Notification Details Modal */}
      {selectedNotification && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-fadeIn">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 rounded-xl bg-orange-50 text-orange-600">
                  <CheckSquare className="w-6 h-6" />
                </div>
                <div>
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                    Bildirim Detayı
                  </span>
                  <h3 className="text-base font-bold text-slate-800 line-clamp-1">
                    {selectedNotification.title}
                  </h3>
                </div>
              </div>

              <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 mb-6 max-h-60 overflow-y-auto text-xs text-slate-700 whitespace-pre-wrap leading-relaxed">
                {selectedNotification.content}
              </div>

              <div className="flex items-center justify-between text-xs text-slate-400 mb-6 border-b border-slate-100 pb-3">
                <span>
                  Gönderen:{' '}
                  <strong className="text-slate-700">
                    {selectedNotification.senderName || selectedNotification.createUser}
                  </strong>
                </span>
                <span>
                  {new Date(selectedNotification.createTime).toLocaleDateString('tr-TR', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>

              <button
                type="button"
                onClick={() => setSelectedNotification(null)}
                className="w-full h-10 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition flex items-center justify-center text-xs uppercase tracking-wider cursor-pointer"
              >
                Kapat
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export function NotificationModal({
  isOpen,
  initialTab = 'incoming',
  onClose,
  isSuperAdmin,
  allowedKeys
}: {
  isOpen: boolean
  initialTab?: TabType
  onClose: () => void
  isSuperAdmin?: boolean
  allowedKeys?: Set<string>
}) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-3 sm:p-6 animate-fadeIn overflow-y-auto" onClick={onClose}>
      <div className="relative w-full max-w-6xl bg-slate-50 rounded-3xl shadow-2xl border border-slate-200/80 overflow-hidden flex flex-col max-h-[92vh]" onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="px-6 py-4 bg-white border-b border-slate-200/80 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-orange-50 border border-orange-100 flex items-center justify-center text-orange-600">
              <Bell className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-slate-800">Bildirim Merkezi</h2>
              <p className="text-xs text-slate-400 font-medium">Bildirim takibi, gönderimi ve geçmiş detayları</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
            aria-label="Kapat"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto">
          <NotificationsPage isModal={true} initialTab={initialTab} onCloseModal={onClose} isSuperAdmin={isSuperAdmin} allowedKeys={allowedKeys} />
        </div>
      </div>
    </div>
  )
}
