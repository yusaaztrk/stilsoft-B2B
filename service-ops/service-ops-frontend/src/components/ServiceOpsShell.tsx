import React from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { clearSession, getTenantCode, getUsername } from '../auth/storage'
import { logoutShared } from '../api/session'

type Props = {
  title: string
  actions?: React.ReactNode
  children: React.ReactNode
}

export default function ServiceOpsShell({ title, actions, children }: Props) {
  const location = useLocation()
  const navigate = useNavigate()

  const tenantCode = getTenantCode() || ''
  const username = getUsername() || ''

  const tabs = [
    { to: '/montaj', label: 'Montaj Listesi' },
    { to: '/service-requests', label: 'Kabul Listesi' },
    { to: '/reports', label: 'Montaj Raporu' },
    { to: '/analysis', label: 'Analiz' }
  ]

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          borderBottom: '2px solid #e5e7eb',
          paddingBottom: 10,
          marginBottom: 14
        }}
      >
        <div>
          <div style={{ fontWeight: 900, fontSize: 20, lineHeight: '24px' }}>{title}</div>
          <div style={{ marginTop: 6, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {tabs.map((t) => {
              const active = location.pathname === t.to
              return (
                <Link
                  key={t.to}
                  to={t.to}
                  style={{
                    textDecoration: 'none',
                    fontSize: 13,
                    fontWeight: 800,
                    padding: '8px 12px',
                    borderRadius: 999,
                    border: active ? '1px solid #ef4444' : '1px solid #e5e7eb',
                    background: active ? '#fee2e2' : 'white',
                    color: '#111827'
                  }}
                >
                  {t.label}
                </Link>
              )
            })}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {actions ? <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{actions}</div> : null}
          <div style={{ fontSize: 12, fontWeight: 800, color: '#374151' }}>
            {tenantCode} / {username}
          </div>
          <button
            type="button"
            onClick={() => {
              // Ortak oturum kapatılır: bayi tarafındaki oturum da düşer.
              void logoutShared().finally(() => {
                clearSession()
                navigate('/login', { replace: true })
              })
            }}
            style={{
              height: 34,
              padding: '0 12px',
              borderRadius: 10,
              border: '1px solid #e5e7eb',
              background: 'white',
              fontWeight: 900,
              cursor: 'pointer'
            }}
          >
            Çıkış
          </button>
        </div>
      </div>

      <div>{children}</div>
    </div>
  )
}
