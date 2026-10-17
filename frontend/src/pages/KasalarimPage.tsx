import React, { useEffect, useMemo, useState } from 'react'
import Modal from '../components/Modal'
import Table, { type TableColumn } from '../components/Table'
import FormInput from '../components/forms/FormInput'
import FormSelect from '../components/forms/FormSelect'
import NotificationPopup from '../components/NotificationPopup'
import { createCashAccount, deleteCashAccount, fetchCashAccounts, updateCashAccount, type CashAccountDto } from '../api/cashAccounts'
import { formatMoneyTr, handleCurrencyInputChange, parseMoneyTr } from '../utils/formatters'

function formatMoney(n: number) {
  try {
    return new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n ?? 0))
  } catch {
    return String(n ?? 0)
  }
}

function normalizeCurrencyTypeId(cur: number) {
  const v = Number(cur ?? 1)
  return v > 0 ? v : 1
}

function currencyCodeByTypeId(cur: number) {
  const v = Number(cur ?? 1)
  return v === 2 ? 'EUR' : v === 3 ? 'USD' : v === 4 ? 'GBP' : 'TRY'
}

function currencySymbolByCode(code: string) {
  return code === 'TRY' ? '₺' : code === 'USD' ? '$' : code === 'EUR' ? '€' : code === 'GBP' ? '£' : code
}

export default function KasalarimPage() {
  type Row = CashAccountDto & { actions: string }

  const todayYmd = () => {
    const d = new Date()
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }

  const [items, setItems] = useState<Row[]>([])
  const [loading, setLoading] = useState(false)

  const [open, setOpen] = useState(false)
  const [isEditMode, setIsEditMode] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [lastCarryDate, setLastCarryDate] = useState('')
  const [lastCarryAmount, setLastCarryAmount] = useState('0')
  const [currencyTypeId, setCurrencyTypeId] = useState('1')
  const [modalError, setModalError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [popupOpen, setPopupOpen] = useState(false)
  const [popupType, setPopupType] = useState<'success' | 'error' | 'info'>('info')
  const [popupTitle, setPopupTitle] = useState('')
  const [popupMessage, setPopupMessage] = useState('')

  const showPopup = (type: 'success' | 'error' | 'info', title: string, message: string) => {
    setPopupType(type)
    setPopupTitle(title)
    setPopupMessage(message)
    setPopupOpen(true)
  }

  const reload = async () => {
    const ac = new AbortController()
    try {
      setLoading(true)
      const list = await fetchCashAccounts({ signal: ac.signal })
      setItems((list ?? []).map((x) => ({ ...x, actions: '' })))
    } catch (e: any) {
      setItems([])
      showPopup('error', 'Hata', String(e?.message ?? 'Kasalar alınamadı'))
    } finally {
      setLoading(false)
    }
    return () => ac.abort()
  }

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const columns: TableColumn<Row>[] = useMemo(
    () => [
      { key: 'code', label: 'Kod', searchable: true },
      { key: 'name', label: 'Ad', searchable: true },
      {
        key: 'balance',
        label: 'Bakiye',
        searchable: true,
        render: (value, row) => {
          const code = currencyCodeByTypeId(Number((row as any)?.currencyTypeId ?? 0))
          const sym = currencySymbolByCode(code)
          return (
            <span className="font-semibold">
              {formatMoney(Number(value ?? 0))} {sym} ({code})
            </span>
          )
        }
      },
      {
        key: 'actions',
        label: '',
        render: (_value, row) => (
          <div className="flex items-center justify-end gap-1.5">
            <button
              type="button"
              className="inline-flex items-center gap-1 h-[24px] px-2 rounded-md text-[10px] font-medium bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-100 transition-colors"
              onClick={(e) => {
                e.stopPropagation()
                setModalError(null)
                setIsEditMode(true)
                setEditingId(row.id)
                setCode(row.code)
                setName(row.name ?? '')
                setLastCarryDate(row.lastCarryDate ? row.lastCarryDate.split('T')[0] : todayYmd())
                setLastCarryAmount(formatMoneyTr(row.lastCarryAmount ?? 0))
                setCurrencyTypeId(String(row.currencyTypeId ?? 1))
                setOpen(true)
              }}
            >
              Düzenle
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1 h-[24px] px-2 rounded-md text-[10px] font-medium bg-red-50 text-red-700 hover:bg-red-100 border border-red-100 transition-colors"
              onClick={(e) => {
                e.stopPropagation()
                // Onay penceresi YOKTU: "Düzenle"nin hemen yanındaki butona yanlışlıkla
                // tıklayan biri kasayı tek tıkla siliyordu. Kasa silmek hareketleri de
                // etkileyen, geri alınamayan bir işlem.
                const confirmed = window.confirm(
                  `"${row.name || row.code}" kasası silinecek. Bu işlem geri alınamaz. Onaylıyor musunuz?`
                )
                if (!confirmed) return

                void (async () => {
                  try {
                    await deleteCashAccount(row.id)
                    showPopup('success', 'Başarılı', 'Kasa silindi')
                    await reload()
                  } catch (err: any) {
                    showPopup('error', 'Hata', String(err?.message ?? 'Silinemedi'))
                  }
                })()
              }}
            >
              Sil
            </button>
          </div>
        )
      }
    ],
    [reload]
  )

  const submit = async () => {
    setModalError(null)
    const payload = {
      code: String(code ?? '').trim(),
      name: String(name ?? '').trim() || null,
      lastCarryDate: lastCarryDate ? new Date(`${String(lastCarryDate).trim()}T00:00:00.000Z`).toISOString() : undefined,
      // tr-TR biçimli metni çöz ("1.125,00" -> 1125). Eski `replace(',', '.')` binlik
      // ayracını yiyordu: "1.125,00" -> 1.125 olarak okunuyordu.
      lastCarryAmount: parseMoneyTr(lastCarryAmount),
      currencyTypeId: normalizeCurrencyTypeId(Number(currencyTypeId) || 0)
    }

    if (!payload.code) {
      setModalError('Kasa kodu zorunludur')
      return
    }

    if (!String(name ?? '').trim()) {
      setModalError('Kasa adı zorunludur')
      return
    }

    if (!String(lastCarryDate ?? '').trim()) {
      setModalError('Tarih zorunludur')
      return
    }

    try {
      setSaving(true)
      if (isEditMode && editingId !== null) {
        await updateCashAccount(editingId, payload)
        showPopup('success', 'Başarılı', 'Kasa güncellendi')
      } else {
        await createCashAccount(payload)
        showPopup('success', 'Başarılı', 'Kasa oluşturuldu')
      }
      setOpen(false)
      setCode('')
      setName('')
      setLastCarryDate('')
      setLastCarryAmount('0,00')
      setCurrencyTypeId('1')
      setIsEditMode(false)
      setEditingId(null)
      await reload()
    } catch (e: any) {
      setModalError(String(e?.message ?? 'Kaydedilemedi'))
    }
    finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-4">
      <NotificationPopup isOpen={popupOpen} variant={popupType} title={popupTitle} message={popupMessage} onClose={() => setPopupOpen(false)} />

      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">Kasalarım</h1>
          <p className="text-xs text-gray-400 mt-0.5">Ayarlar / Kasalarım</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setModalError(null)
            setIsEditMode(false)
            setEditingId(null)
            setCode('')
            setName('')
            setLastCarryDate(todayYmd())
            setLastCarryAmount('0,00')
            setCurrencyTypeId('1')
            setOpen(true)
          }}
          className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition"
        >
          Yeni Kasa
        </button>
      </div>

      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-visible relative">
        {loading ? (
          <div className="p-6 text-sm text-gray-500">Yükleniyor...</div>
        ) : (
          <Table
          onRefresh={() => void reload()} columns={columns} data={items} showColumnFilters />
        )}
      </div>

      <Modal
        isOpen={open}
        onClose={() => {
          if (saving) return
          setOpen(false)
        }}
        title={isEditMode ? 'Kasa Düzenle' : 'Yeni Kasa'}
        footer={
          <>
            <button
              type="button"
              className="h-[34px] px-4 text-xs font-semibold rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 transition"
              onClick={() => setOpen(false)}
            >
              Vazgeç
            </button>
            <button
              type="button"
              className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition"
              disabled={saving}
              onClick={() => void submit()}
            >
              {saving ? 'Kaydediliyor...' : 'Kaydet'}
            </button>
          </>
        }
      >
        {modalError && <div className="mb-3 text-xs font-semibold text-red-600 whitespace-pre-line">{modalError}</div>}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormInput label="Kod" requiredMark value={code} onChange={(e) => setCode(e.target.value.toLocaleUpperCase('tr-TR'))} placeholder="Kasa kodu" disabled={isEditMode} />
          <FormInput label="Ad" requiredMark value={name} onChange={(e) => setName(e.target.value.toLocaleUpperCase('tr-TR'))} placeholder="Kasa adı" />
          {/*
            DEVİR TARİHİ VE TUTARI ARTIK DÜZENLENEBİLİR (kullanıcı kararı 2026-08-22).
            İkisi de düzenleme modunda kilitliydi; üstelik sunucu güncellemede tutarı hiç
            yazmıyordu (bkz. CashAccountsController). Banka hesaplarındaki açılış bakiyesiyle
            aynı davranış: kuruştan dolan tutar kutusu, eksi değer serbest.
          */}
          <FormInput
            label="Devir Tarihi"
            requiredMark
            type="date"
            value={lastCarryDate}
            onChange={(e) => setLastCarryDate(e.target.value)}
            placeholder="Tarih"
          />
          <FormInput
            label="Devir Bakiyesi"
            value={lastCarryAmount}
            onChange={(e) => setLastCarryAmount(handleCurrencyInputChange(e.target.value, { allowNegative: true }))}
            className="input-base text-right"
            placeholder="0,00"
            hint="Eksi bakiye için - yazın. İşareti kaldırmak için alanı temizleyin."
          />
          <FormSelect
            label="Döviz Tipi"
            requiredMark
            value={currencyTypeId}
            onChange={(e) => setCurrencyTypeId(e.target.value)}
            disabled={isEditMode}
            options={[
              { value: '1', label: 'TL (TRY)' },
              { value: '2', label: 'EUR' },
              { value: '3', label: 'USD' },
              { value: '4', label: 'GBP' }
            ]}
          />
        </div>
      </Modal>
    </div>
  )
}
