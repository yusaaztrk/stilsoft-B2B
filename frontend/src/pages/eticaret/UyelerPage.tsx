import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { KeyRound, RefreshCw, UserPlus, Save } from 'lucide-react'
import { AppDataTable, type DataTableRowAction } from '../../components/data-table'
import type { ColumnDef } from '@tanstack/react-table'
import { Modal, MessageBanner, PageHeader, SHOP_API, authHeaders, btnDark, btnGhost, emptyMemberForm, formatDate, formatPrice, input, label, paymentLabels, send, usePanelMessage, type MemberActivity, type MemberForm, type ShopMember } from './shared'
import { OrderDetailModal, useOrderDetail } from './OrderDetailModal'

export default function UyelerPage() {
  const { message, notify } = usePanelMessage()
  const { orderDetail, setOrderDetail, openOrder } = useOrderDetail(notify)
  const [members, setMembers] = useState<ShopMember[]>([])
  const [search, setSearch] = useState('')
  const [memberPage, setMemberPage] = useState(0)
  const [memberPageSize, setMemberPageSize] = useState(25)
  const [memberForm, setMemberForm] = useState<MemberForm | null>(null)
  const [passwordFor, setPasswordFor] = useState<ShopMember | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [memberActivity, setMemberActivity] = useState<MemberActivity | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const loadMembers = useCallback(async (term: string) => {
    setLoading(true)
    try {
      const qs = term.trim() ? `?ara=${encodeURIComponent(term.trim())}` : ''
      const res = await fetch(`${SHOP_API}/api/admin/members${qs}`, { headers: authHeaders(false) })
      if (!res.ok) throw new Error()
      const data = await res.json()
      setMembers(data.data ?? [])
    } catch {
      notify('err', 'Üye listesi alınamadı.')
    } finally {
      setLoading(false)
    }
  }, [])

  const saveMember = async () => {
    if (!memberForm) return
    setSaving(true)
    try {
      if (memberForm.id) {
        const result = await send(`/api/admin/members/${memberForm.id}`, 'PUT', {
          email: memberForm.email,
          fullName: memberForm.fullName,
          phone: memberForm.phone,
          city: memberForm.city,
          district: memberForm.district,
          address: memberForm.address
        })
        notify(result?.warning ? 'err' : 'ok', result?.warning ?? 'Üye güncellendi.')
      } else {
        await send('/api/admin/members', 'POST', memberForm)
        notify('ok', 'Üye ve carisi oluşturuldu.')
      }
      setMemberForm(null)
      void loadMembers(search)
    } catch (err) {
      notify('err', (err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const toggleMember = async (member: ShopMember) => {
    const soru = member.isActive
      ? `${member.fullName} pasife alınsın mı? Giriş yapamaz ve açık oturumları kapanır.`
      : `${member.fullName} yeniden aktifleştirilsin mi?`
    if (!window.confirm(soru)) return

    try {
      await send(`/api/admin/members/${member.id}/status`, 'PUT', { isActive: !member.isActive })
      notify('ok', member.isActive ? 'Üye pasife alındı.' : 'Üye aktifleştirildi.')
      void loadMembers(search)
    } catch (err) {
      notify('err', (err as Error).message)
    }
  }

  const applyPassword = async () => {
    if (!passwordFor) return
    if (newPassword.trim().length < 8) {
      notify('err', 'Şifre en az 8 karakter olmalı.')
      return
    }

    setSaving(true)
    try {
      await send(`/api/admin/members/${passwordFor.id}/password`, 'POST', { newPassword })
      notify('ok', 'Yeni şifre belirlendi. Üyenin açık oturumları kapatıldı; şifreyi müşteriye siz iletmelisiniz.')
      setPasswordFor(null)
      setNewPassword('')
    } catch (err) {
      notify('err', (err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const revokeSessions = async (member: ShopMember) => {
    if (!window.confirm(`${member.fullName} için açık bütün oturumlar kapatılsın mı?`)) return
    try {
      const result = await send(`/api/admin/members/${member.id}/revoke-sessions`, 'POST')
      notify('ok', `${result?.closed ?? 0} oturum kapatıldı.`)
    } catch (err) {
      notify('err', (err as Error).message)
    }
  }

  const openMember = async (member: ShopMember) => {
    try {
      const res = await fetch(`${SHOP_API}/api/admin/members/${member.id}/activity`, { headers: authHeaders(false) })
      if (!res.ok) throw new Error()
      const data = await res.json()
      setMemberActivity(data.data)
    } catch {
      notify('err', 'Üye hareketleri alınamadı.')
    }
  }

  const memberColumns = useMemo<ColumnDef<ShopMember, any>[]>(() => [
    {
      id: 'member',
      accessorFn: (row) => `${row.fullName} ${row.email}`,
      header: 'Üye',
      meta: { filterType: 'text' },
      cell: ({ row }) => (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); void openMember(row.original) }}
          className="text-left"
          title="Siparişlerini ve faturalarını gör"
        >
          <div className="font-semibold text-gray-900 hover:underline">{row.original.fullName}</div>
          <div className="text-[11px] text-gray-500">{row.original.email}</div>
        </button>
      )
    },
    {
      accessorKey: 'phone',
      header: 'Telefon',
      meta: { filterType: 'text', width: '140px' },
      cell: ({ getValue }) => <span className="text-gray-600">{String(getValue() || '-')}</span>
    },
    {
      id: 'customerCode',
      accessorFn: (row) => row.customerCode || 'Cari açılmamış',
      header: 'Cari Kodu',
      meta: { filterType: 'text', width: '150px' },
      cell: ({ row }) =>
        row.original.customerCode ? (
          <span className="font-mono text-xs text-gray-900">{row.original.customerCode}</span>
        ) : (
          <span className="px-2 py-1 rounded-full text-[11px] font-bold bg-red-50 border border-red-200 text-red-700">
            Cari açılmamış
          </span>
        )
    },
    {
      accessorKey: 'createdAt',
      header: 'Kayıt',
      meta: { filterType: 'date', width: '120px' },
      cell: ({ getValue }) => (
        <span className="text-gray-600 whitespace-nowrap">{formatDate(String(getValue() ?? ''))}</span>
      )
    },
    {
      accessorKey: 'lastLoginAt',
      header: 'Son Giriş',
      meta: { filterType: 'date', width: '130px' },
      cell: ({ row }) => (
        <div className="text-gray-600 whitespace-nowrap">
          {formatDate(row.original.lastLoginAt)}
          {row.original.cartLines > 0 && (
            <div className="text-[11px] text-gray-400">sepette {row.original.cartLines} kalem</div>
          )}
        </div>
      )
    },
    {
      id: 'durum',
      accessorFn: (row) => (row.isActive ? 'Aktif' : 'Pasif'),
      header: 'Durum',
      meta: { filterType: 'select', width: '110px' },
      cell: ({ row }) => (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); void toggleMember(row.original) }}
          className={`px-3 py-1.5 rounded-full text-xs font-bold border transition ${
            row.original.isActive
              ? 'bg-green-50 border-green-200 text-green-700 hover:bg-green-100'
              : 'bg-gray-100 border-gray-200 text-gray-500 hover:bg-gray-200'
          }`}
        >
          {row.original.isActive ? 'Aktif' : 'Pasif'}
        </button>
      )
    },
    /*
      ŞİFRE DEĞİŞTİR — SATIRDA GÖRÜNÜR (2026-10-05 kullanıcı isteği: "üyeler panelinden şifre
      değişikliği koy, ben oradan değiştireyim"). Uç ve pencere vardı ama yalnız satır menüsünün
      içindeydi; bulunmuyordu. SMS sağlayıcısı kod ulaştıramadığı sürece müşterinin şifresini
      yenilemenin en hızlı yolu bu.
    */
    {
      id: 'sifre',
      header: 'Şifre',
      enableSorting: false,
      meta: { width: '130px' },
      cell: ({ row }) => (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setPasswordFor(row.original); setNewPassword('') }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border border-gray-300 bg-white text-gray-800 hover:bg-gray-900 hover:text-white transition whitespace-nowrap"
        >
          <KeyRound size={13} />
          Şifre değiştir
        </button>
      )
    }
  ], [openMember, toggleMember])

  const memberRowActions = useCallback((member: ShopMember): DataTableRowAction<ShopMember>[] => [
    {
      label: 'Düzenle',
      onClick: () =>
        setMemberForm({
          id: member.id,
          email: member.email,
          fullName: member.fullName,
          phone: member.phone ?? '',
          city: '',
          district: '',
          address: '',
          password: ''
        })
    },
    {
      label: 'Şifre değiştir',
      onClick: () => { setPasswordFor(member); setNewPassword('') }
    },
    {
      label: 'Çıkışa zorla',
      onClick: () => void revokeSessions(member)
    },
    /*
      CARİ BAĞLANTILARI (2026-09-09 kullanıcı isteği: "oluşan cariyi e-ticarette de görmem lazım").

      Üye kaydı ile ERP carisi arasındaki bağ `customer_code` alanında duruyordu ama ekranda
      yalnızca bir metindi: bakiyesini ya da hareketlerini görmek için ERP'de cari aramak
      gerekiyordu. Bağlantılar cari kodu yoksa hiç çıkmıyor — cari açılmamış üyede tıklanacak
      bir şey yok.
    */
    {
      key: 'ekstre',
      label: 'Cari ekstresini aç',
      hidden: !member.customerCode,
      onClick: () =>
        window.open(
          `/reports/cariEkstre?customerCode=${encodeURIComponent(member.customerCode ?? '')}`,
          '_blank'
        )
    },
    {
      key: 'cariKopyala',
      label: 'Cari kodunu kopyala',
      hidden: !member.customerCode,
      onClick: () => {
        void navigator.clipboard?.writeText(member.customerCode ?? '')
          .then(() => notify('ok', `${member.customerCode} kopyalandı.`))
          .catch(() => notify('err', 'Kopyalanamadı.'))
      }
    }
  ], [revokeSessions])

  useEffect(() => { void loadMembers('') }, [loadMembers])

  return (
    <div className="p-4 lg:p-6">
      <PageHeader title="Üyeler" desc="Üye aç, bilgilerini güncelle, carisine ve ekstresine geç, şifresini yenile."  />
      <MessageBanner message={message} />

      {(
        <div>
          <div className="flex flex-wrap gap-2 mb-4">
            <input
              className={`${input} mt-0 max-w-xs`}
              placeholder="Ad, e-posta veya cari kodu"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void loadMembers(search)}
            />
            <button
              type="button"
              onClick={() => void loadMembers(search)}
              className="h-11 px-5 rounded-2xl border border-gray-200 bg-white text-sm font-semibold text-gray-700 hover:bg-gray-50 inline-flex items-center gap-2"
            >
              <RefreshCw size={15} />
              Ara
            </button>
            <button
              type="button"
              onClick={() => setMemberForm({ ...emptyMemberForm })}
              className="h-11 px-5 rounded-2xl bg-gray-900 text-white text-sm font-semibold hover:bg-black inline-flex items-center gap-2 ml-auto"
            >
              <UserPlus size={16} />
              Yeni üye
            </button>
          </div>

          <AppDataTable<ShopMember>
            data={members}
            columns={memberColumns}
            rowId={(row) => String(row.id)}
            rowActions={memberRowActions}
            onRefresh={() => void loadMembers(search)}
            states={{
              loading,
              emptyTitle: 'Üye bulunamadı.',
              emptyDescription: 'Arama kutusunu boşaltarak bütün üyeleri listeleyebilirsiniz.'
            }}
            showExcelExport
            excelFileName="eticaret-uyeler"
            pagination={{
              pageIndex: memberPage,
              pageSize: memberPageSize,
              totalCount: members.length,
              pageCount: Math.max(1, Math.ceil(members.length / memberPageSize)),
              onPageChange: setMemberPage,
              onPageSizeChange: setMemberPageSize
            }}
          />

          <div className="text-[11px] text-gray-500 mt-3">
            Şifreler burada gösterilmez ve okunamaz — yalnızca yenisi belirlenebilir.
            Üye <b>silinmez</b>, pasife alınır: carisi faturalarının sahibi, kaydı silmek
            muhasebe bağını koparırdı. "Cari açılmamış" satırı, üyenin sipariş veremeyeceği
            anlamına gelir.
          </div>
        </div>
      )}
      {memberForm && (
        <Modal
          title={memberForm.id ? 'Üyeyi düzenle' : 'Yeni üye'}
          onClose={() => setMemberForm(null)}
          footer={
            <>
              <button type="button" onClick={() => setMemberForm(null)} className={btnGhost}>Vazgeç</button>
              <button type="button" disabled={saving} onClick={() => void saveMember()} className={btnDark}>
                <Save size={15} />
                {saving ? 'Kaydediliyor...' : 'Kaydet'}
              </button>
            </>
          }
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <span className={label}>Ad soyad</span>
              <input className={input} value={memberForm.fullName}
                onChange={(e) => setMemberForm({ ...memberForm, fullName: e.target.value })} />
            </div>
            <div>
              <span className={label}>Telefon</span>
              <input className={input} value={memberForm.phone}
                onChange={(e) => setMemberForm({ ...memberForm, phone: e.target.value })} />
            </div>
            <div className="md:col-span-2">
              <span className={label}>E-posta (giriş adresi)</span>
              <input className={input} value={memberForm.email}
                onChange={(e) => setMemberForm({ ...memberForm, email: e.target.value })} />
            </div>

            {!memberForm.id && (
              <div className="md:col-span-2">
                <span className={label}>Şifre</span>
                <input className={input} type="text" value={memberForm.password}
                  onChange={(e) => setMemberForm({ ...memberForm, password: e.target.value })} />
                <div className="text-[11px] text-gray-500 mt-1 ml-1">
                  En az 8 karakter. Şifreyi müşteriye siz iletirsiniz; sistem e-posta göndermiyor.
                </div>
              </div>
            )}

            <div>
              <span className={label}>Şehir</span>
              <input className={input} value={memberForm.city}
                onChange={(e) => setMemberForm({ ...memberForm, city: e.target.value })} />
            </div>
            <div>
              <span className={label}>Bölge / ilçe</span>
              <input className={input} value={memberForm.district}
                onChange={(e) => setMemberForm({ ...memberForm, district: e.target.value })} />
            </div>
            <div className="md:col-span-2">
              <span className={label}>Adres</span>
              <textarea className={`${input} h-auto py-3`} rows={2} value={memberForm.address}
                onChange={(e) => setMemberForm({ ...memberForm, address: e.target.value })} />
            </div>

            <div className="md:col-span-2 text-[11px] text-gray-500">
              {memberForm.id
                ? 'Adres alanları boş bırakılırsa ERP’deki cari adresi olduğu gibi kalır. Cari kodu buradan değiştirilemez: geçmiş sipariş ve faturaların sahibi odur.'
                : 'Kaydedince önce ERP’de 120-11- ön ekli cari açılır, sonra üye oluşturulur. Cari açılamazsa üye de oluşturulmaz.'}
            </div>
          </div>
        </Modal>
      )}
      {passwordFor && (
        <Modal
          title={`${passwordFor.fullName} — yeni şifre`}
          onClose={() => setPasswordFor(null)}
          footer={
            <>
              <button type="button" onClick={() => setPasswordFor(null)} className={btnGhost}>Vazgeç</button>
              <button type="button" disabled={saving} onClick={() => void applyPassword()} className={btnDark}>
                <KeyRound size={15} />
                {saving ? 'Uygulanıyor...' : 'Şifreyi belirle'}
              </button>
            </>
          }
        >
          <span className={label}>Yeni şifre</span>
          <input className={input} type="text" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-[12px] text-sky-900 leading-relaxed">
            Müşteri bu şifreyle sitede <b>telefon numarası</b>
            {passwordFor.phone ? <> (<b>{passwordFor.phone}</b>)</> : null} ya da{' '}
            {passwordFor.email.toLowerCase().endsWith('@telefon.stilsoft') ? 'e-posta (bu üyede e-posta yok)' : <>e-posta (<b>{passwordFor.email}</b>)</>}{' '}
            ile giriş yapar.
          </div>
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800 leading-relaxed">
            Mevcut şifre okunamaz; yalnızca yenisi konabilir. Kaydedince üyenin açık bütün
            oturumları kapanır ve yeni şifreyi <b>müşteriye siz iletmelisiniz</b> — sistem
            e-posta göndermiyor.
          </div>
        </Modal>
      )}
      {memberActivity && (
        <Modal
          title={`${memberActivity.member.fullName} — hareketler`}
          wide
          onClose={() => setMemberActivity(null)}
          footer={<button type="button" onClick={() => setMemberActivity(null)} className={btnGhost}>Kapat</button>}
        >
          <div className="rounded-xl border border-gray-200 p-4 mb-5 text-sm text-gray-700">
            <div>{memberActivity.member.email}{memberActivity.member.phone ? ` · ${memberActivity.member.phone}` : ''}</div>
            <div className="text-xs text-gray-500 font-mono mt-1">{memberActivity.member.customerCode ?? 'cari açılmamış'}</div>
          </div>

          {memberActivity.note && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800 mb-5">
              {memberActivity.note}
            </div>
          )}

          <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2">Siparişler</div>
          {memberActivity.orders.length === 0 ? (
            <div className="text-sm text-gray-500 mb-5">Sipariş yok.</div>
          ) : (
            <div className="rounded-xl border border-gray-200 overflow-hidden mb-5">
              <table className="w-full text-left border-collapse text-sm">
                <tbody>
                  {memberActivity.orders.map((order) => (
                    <tr
                      key={order.orderNo}
                      onClick={() => { setMemberActivity(null); void openOrder(order.orderNo) }}
                      className="border-b border-gray-100 last:border-0 hover:bg-gray-50/60 cursor-pointer"
                    >
                      <td className="px-4 py-2.5 font-mono text-xs font-semibold text-gray-900">{order.orderNo}</td>
                      <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">{formatDate(order.processedAt)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{formatPrice(order.grandTotal, 'TRY')}</td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold border inline-block ${
                          (paymentLabels[order.paymentStatus] ?? { className: 'bg-gray-100 border-gray-200 text-gray-600' }).className
                        }`}>
                          {(paymentLabels[order.paymentStatus] ?? { text: order.paymentStatus }).text}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-gray-500 font-mono text-xs">{order.invoiceNo ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2">Faturalar</div>
          {memberActivity.invoices.length === 0 ? (
            <div className="text-sm text-gray-500">Fatura yok.</div>
          ) : (
            <div className="rounded-xl border border-gray-200 overflow-hidden">
              <table className="w-full text-left border-collapse text-sm">
                <tbody>
                  {memberActivity.invoices.map((invoice) => (
                    <tr key={invoice.invoiceNo} className="border-b border-gray-100 last:border-0">
                      <td className="px-4 py-2.5 font-mono text-xs font-semibold text-gray-900">{invoice.invoiceNo}</td>
                      <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">{formatDate(invoice.date)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{formatPrice(invoice.grandTotal, 'TRY')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="text-[11px] text-gray-500 mt-4">
            Sipariş ve fatura kayıtlarının sahibi ERP'dir; burada yalnızca okunuyor.
            Siparişe tıklayınca tam dökümü açılır.
          </div>
        </Modal>
      )}
      <OrderDetailModal orderDetail={orderDetail} setOrderDetail={setOrderDetail} />
    </div>
  )
}
