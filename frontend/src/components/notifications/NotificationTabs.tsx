import React from 'react'
import { Inbox, Send, History, Bell } from 'lucide-react'

export type TabType = 'incoming' | 'send' | 'history'

interface NotificationTabsProps {
  activeTab: TabType
  onTabChange: (tab: TabType) => void
  unreadCount?: number
  canViewInbox: boolean
  canViewSend: boolean
}

export default function NotificationTabs({
  activeTab,
  onTabChange,
  unreadCount = 0,
  canViewInbox,
  canViewSend,
}: NotificationTabsProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-slate-800 tracking-tight flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-orange-50 text-orange-600 border border-orange-100">
            <Bell className="w-5 h-5 sm:w-6 sm:h-6" />
          </div>
          Bildirim Yönetimi
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Sistem içi duyuru, pop-up mesaj gönderme ve gelen bildirim takibi
        </p>
      </div>

      {/* Tabs */}
      <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200/60 self-start sm:self-auto overflow-x-auto max-w-full">
        {canViewInbox && (
          <button
            type="button"
            onClick={() => onTabChange('incoming')}
            className={`flex items-center gap-2 px-3.5 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'incoming'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Inbox className="w-3.5 h-3.5 text-indigo-500" />
            <span>Gelen Bildirimler</span>
            {unreadCount > 0 && (
              <span className="px-1.5 py-0.5 text-[10px] bg-indigo-600 text-white font-mono rounded-full font-black">
                {unreadCount}
              </span>
            )}
          </button>
        )}

        {canViewSend && (
          <>
            <button
              type="button"
              onClick={() => onTabChange('send')}
              className={`flex items-center gap-2 px-3.5 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer whitespace-nowrap ${
                activeTab === 'send'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Send className="w-3.5 h-3.5 text-orange-600" />
              <span>Yeni Bildirim Gönder</span>
            </button>

            <button
              type="button"
              onClick={() => onTabChange('history')}
              className={`flex items-center gap-2 px-3.5 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer whitespace-nowrap ${
                activeTab === 'history'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <History className="w-3.5 h-3.5 text-slate-600" />
              <span>Gönderim Geçmişi</span>
            </button>
          </>
        )}
      </div>
    </div>
  )
}
