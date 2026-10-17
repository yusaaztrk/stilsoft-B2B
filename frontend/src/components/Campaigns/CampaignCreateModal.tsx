import React, { useMemo, useState } from 'react'
import Modal from '../Modal'
import FormInput from '../forms/FormInput'
import { CAMPAIGN_BACKGROUNDS, TEXT_COLOR_OPTIONS, formatCampaignDescription } from '../../utils/campaignBgHelper'

export type CampaignTypeId = string

export type TblKampanyaDraft = {
  KAMPANYA_ADI: string
  KAMPANYA_ACIKLAMA: string
  BASLANGIC_TARIH: string
  BITIS_TARIH: string
  KAMPANYA_TIPI: string | null
  AKTIF: boolean
  TASLAK: boolean
}

type Props = {
  isOpen: boolean
  onClose: () => void
  onContinue?: (draft: TblKampanyaDraft) => void
}

type CampaignTypeOption = {
  id: CampaignTypeId
  title: string
  description?: string
}

export default function CampaignCreateModal({ isOpen, onClose, onContinue }: Props) {
  const campaignTypes: CampaignTypeOption[] = useMemo(
    () =>
      [
        {
          id: 'BasketTotalDiscount',
          title: 'Sepet Toplam İndirim',
          description: 'Sepet toplamına göre indirim kurgusu (sonraki adımda detaylandırılacak)'
        },
        {
          id: 'QuantityTieredDiscount',
          title: 'Adet Bazlı Kademeli İndirim',
          description: 'Alım adedine göre kademeli indirim (örn: 1-5 %10, 6-10 %15)'
        },
        {
          id: 'BuyXGetY',
          title: 'X Alana Y Hediye / İndirimli Ürün',
          description: 'Bir ürün/kategori alımına karşılık farklı ürünlerde hediye veya indirim uygular (örn: buzdolabı alana kahve makinesi %30)'
        },
        {
          id: 'ProductDiscount',
          title: 'Seçili Ürün İndirimi',
          description: 'Seçilen kategori veya seçilen ürünlere (multi-select) fiyat grubu bazlı indirim uygular'
        },
        {
          id: 'CategoryBrandDiscount',
          title: 'Kategori-Marka Bazlı İndirim',
          description: 'Seçilen kategori ve KOD4/KOD5 kombinasyonuna uyan ürünlere toplu indirim uygular'
        },
        {
          id: 'PackageCampaign',
          title: 'Paket Kampanya',
          description: 'Birden fazla ürünün birlikte alınması durumunda sabit paket fiyatı veya % indirim uygular'
        }
      ] as const,
    []
  )

  const [selectedTypeId, setSelectedTypeId] = useState<string>('BuyXGetY')
  const [kampanyaAdi, setKampanyaAdi] = useState('')
  const [kampanyaAciklama, setKampanyaAciklama] = useState('')
  const [selectedBgId, setSelectedBgId] = useState('bg-red-silk')
  const [selectedTextColor, setSelectedTextColor] = useState('')
  const [baslangicTarih, setBaslangicTarih] = useState(() => new Date().toISOString().slice(0, 10))
  const [bitisTarih, setBitisTarih] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() + 30)
    return d.toISOString().slice(0, 10)
  })
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setSelectedTypeId('BuyXGetY')
    setKampanyaAdi('')
    setKampanyaAciklama('')
    setSelectedBgId('bg-red-silk')
    setSelectedTextColor('')
    setBaslangicTarih(new Date().toISOString().slice(0, 10))
    const d = new Date()
    d.setDate(d.getDate() + 30)
    setBitisTarih(d.toISOString().slice(0, 10))
    setError(null)
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  const toDate = (iso: string) => {
    const s = String(iso ?? '').trim()
    if (!s) return null
    const d = new Date(s)
    return Number.isNaN(d.getTime()) ? null : d
  }

  const validate = (): string | null => {
    if (!kampanyaAdi.trim()) return 'Kampanya adı zorunludur'
    if (!baslangicTarih.trim()) return 'Başlangıç tarihi zorunludur'
    if (!bitisTarih.trim()) return 'Bitiş tarihi zorunludur'

    const start = toDate(baslangicTarih)
    if (!start) return 'Başlangıç tarihi geçersiz'
    const end = toDate(bitisTarih)
    if (!end) return 'Bitiş tarihi geçersiz'
    if (end.getTime() <= start.getTime()) return 'Bitiş tarihi, başlangıç tarihinden büyük olmalıdır'

    return null
  }

  const draft: TblKampanyaDraft = useMemo(
    () => {
      const finalDescription = formatCampaignDescription(kampanyaAciklama, selectedBgId, selectedTextColor)
      return {
        KAMPANYA_ADI: kampanyaAdi.trim(),
        KAMPANYA_ACIKLAMA: finalDescription,
        BASLANGIC_TARIH: baslangicTarih.trim(),
        BITIS_TARIH: bitisTarih.trim(),
        KAMPANYA_TIPI: selectedTypeId,
        AKTIF: true,
        TASLAK: true
      }
    },
    [baslangicTarih, bitisTarih, kampanyaAciklama, kampanyaAdi, selectedTypeId, selectedBgId, selectedTextColor]
  )

  const canContinue = useMemo(() => validate() == null, [kampanyaAdi, baslangicTarih, bitisTarih])

  const handleContinue = () => {
    const msg = validate()
    if (msg) {
      setError(msg)
      return
    }
    setError(null)
    onContinue?.(draft)
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Kampanya Ekle"
      footer={
        <>
          <button
            type="button"
            className="px-4 py-2 text-xs font-semibold border border-gray-200 text-gray-700 rounded hover:bg-gray-50"
            onClick={handleClose}
          >
            Vazgeç
          </button>
          <button
            type="button"
            className="px-4 py-2 text-xs font-semibold bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-500"
            onClick={handleContinue}
            disabled={!canContinue}
          >
            Devam
          </button>
        </>
      }
    >
      {error && <div className="mb-3 text-sm font-semibold text-red-600">{error}</div>}

      <div className="space-y-5">
        <FormInput
          label="Kampanya Adı"
          requiredMark
          value={kampanyaAdi}
          onChange={(e) => {
            setKampanyaAdi(e.target.value)
            if (error) setError(null)
          }}
          placeholder="Örn: Ocak Sepet İndirimi"
        />

        <div className="space-y-2">
          <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Kampanya Açıklaması</label>
          <textarea
            className="input-base min-h-[90px]"
            value={kampanyaAciklama}
            onChange={(e) => {
              setKampanyaAciklama(e.target.value)
              if (error) setError(null)
            }}
            placeholder="Örn: 2 ürün birlikte alınırsa paket fiyatı uygulanır..."
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-2">
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Kampanya Arka Planı</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {CAMPAIGN_BACKGROUNDS.map((bg) => {
                const isSelected = selectedBgId === bg.id
                const effectiveColor = selectedTextColor || bg.textColor
                return (
                  <button
                    key={bg.id}
                    type="button"
                    onClick={() => setSelectedBgId(bg.id)}
                    className={`relative h-12 rounded-xl overflow-hidden text-center flex flex-col items-center justify-center border-2 transition-all duration-200 hover:scale-[1.01] ${
                      isSelected ? 'border-blue-600 ring-2 ring-blue-100 scale-[1.02]' : 'border-slate-200 hover:border-slate-400'
                    }`}
                    style={{ background: bg.style }}
                  >
                    <span
                      className="text-[11px] font-extrabold px-1 text-center truncate w-full"
                      style={{ color: effectiveColor, textShadow: bg.textShadow }}
                    >
                      {bg.name}
                    </span>
                    {isSelected && (
                      <div className="absolute top-1 right-1 w-3.5 h-3.5 rounded-full bg-blue-600 border border-white flex items-center justify-center shadow-sm">
                        <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="4">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Yazı Rengi</label>
            <div className="flex flex-wrap gap-1.5 p-2.5 bg-slate-50 border border-slate-200 rounded-xl">
              {TEXT_COLOR_OPTIONS.map((opt) => {
                const isSelected = selectedTextColor === opt.color
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setSelectedTextColor(opt.color)}
                    title={opt.name}
                    className={`h-7 px-2 rounded-lg text-[11px] font-bold transition-all flex items-center gap-1 border ${
                      isSelected
                        ? 'border-blue-600 ring-2 ring-blue-200 font-extrabold bg-blue-50 text-blue-900 scale-105'
                        : 'border-slate-300 hover:border-slate-400 bg-white text-slate-700'
                    }`}
                  >
                    {opt.color ? (
                      <span className="w-3 h-3 rounded-full border border-black/20 shrink-0" style={{ backgroundColor: opt.color }} />
                    ) : (
                      <span className="w-3 h-3 rounded-full border border-slate-300 bg-linear-to-tr from-slate-200 to-slate-400 shrink-0" />
                    )}
                    <span>{opt.name}</span>
                  </button>
                )
              })}
              
              {/* Custom Color Picker */}
              <div className="flex items-center gap-1 mt-1 pt-1 border-t border-slate-200 w-full">
                <span className="text-[10px] font-bold text-slate-500 uppercase">Özel Renk:</span>
                <input
                  type="color"
                  value={selectedTextColor || '#ffffff'}
                  onChange={(e) => setSelectedTextColor(e.target.value)}
                  className="w-6 h-6 rounded cursor-pointer border border-slate-300 bg-transparent p-0"
                  title="Özel Renk Seç"
                />
                <span className="text-[11px] font-mono text-slate-600 ml-1">{selectedTextColor || 'Varsayılan'}</span>
                {selectedTextColor && (
                  <button
                    type="button"
                    onClick={() => setSelectedTextColor('')}
                    className="text-[10px] text-red-600 hover:underline ml-auto font-semibold"
                  >
                    Temizle
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormInput
            label="Başlangıç Tarihi"
            requiredMark
            type="date"
            value={baslangicTarih}
            onChange={(e) => {
              setBaslangicTarih(e.target.value)
              if (error) setError(null)
            }}
          />

          <FormInput
            label="Bitiş Tarihi"
            requiredMark
            type="date"
            value={bitisTarih}
            onChange={(e) => {
              setBitisTarih(e.target.value)
              if (error) setError(null)
            }}
          />
        </div>

        <div>
          <div className="text-sm font-semibold text-gray-700 mb-2">Kampanya Tipini Seçin</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {campaignTypes.map((t) => {
              const selected = selectedTypeId === t.id

              const theme =
                t.id === 'BasketTotalDiscount'
                  ? {
                      border: selected ? 'border-emerald-500 bg-emerald-50/70 ring-2 ring-emerald-100' : 'border-slate-200 hover:border-emerald-300 hover:bg-emerald-50/20',
                      icon: (
                        <div className="w-9 h-9 rounded-xl bg-emerald-100/80 flex items-center justify-center shrink-0">
                          <svg className="w-5 h-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" /></svg>
                        </div>
                      )
                    }
                  : t.id === 'QuantityTieredDiscount'
                  ? {
                      border: selected ? 'border-indigo-500 bg-indigo-50/70 ring-2 ring-indigo-100' : 'border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/20',
                      icon: (
                        <div className="w-9 h-9 rounded-xl bg-indigo-100/80 flex items-center justify-center shrink-0">
                          <svg className="w-5 h-5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
                        </div>
                      )
                    }
                  : t.id === 'BuyXGetY'
                  ? {
                      border: selected ? 'border-amber-500 bg-amber-50/70 ring-2 ring-amber-100' : 'border-slate-200 hover:border-amber-300 hover:bg-amber-50/20',
                      icon: (
                        <div className="w-9 h-9 rounded-xl bg-amber-100/80 flex items-center justify-center shrink-0">
                          <svg className="w-5 h-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" /></svg>
                        </div>
                      )
                    }
                  : t.id === 'ProductDiscount'
                  ? {
                      border: selected ? 'border-sky-500 bg-sky-50/70 ring-2 ring-sky-100' : 'border-slate-200 hover:border-sky-300 hover:bg-sky-50/20',
                      icon: (
                        <div className="w-9 h-9 rounded-xl bg-sky-100/80 flex items-center justify-center shrink-0">
                          <svg className="w-5 h-5 text-sky-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 7h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                        </div>
                      )
                    }
                  : t.id === 'CategoryBrandDiscount'
                  ? {
                      border: selected ? 'border-fuchsia-500 bg-fuchsia-50/70 ring-2 ring-fuchsia-100' : 'border-slate-200 hover:border-fuchsia-300 hover:bg-fuchsia-50/20',
                      icon: (
                        <div className="w-9 h-9 rounded-xl bg-fuchsia-100/80 flex items-center justify-center shrink-0">
                          <svg className="w-5 h-5 text-fuchsia-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>
                        </div>
                      )
                    }
                  : {
                      border: selected ? 'border-rose-500 bg-rose-50/70 ring-2 ring-rose-100' : 'border-slate-200 hover:border-rose-300 hover:bg-rose-50/20',
                      icon: (
                        <div className="w-9 h-9 rounded-xl bg-rose-100/80 flex items-center justify-center shrink-0">
                          <svg className="w-5 h-5 text-rose-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>
                        </div>
                      )
                    }

              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSelectedTypeId(t.id)}
                  className={`flex items-start gap-3 text-left border rounded-2xl p-4 transition-all duration-200 bg-white hover:-translate-y-0.5 hover:shadow-sm ${theme.border}`}
                >
                  {theme.icon}
                  <div className="min-w-0">
                    <div className="text-xs font-extrabold text-slate-800 flex items-center gap-1.5">
                      {t.title}
                      {selected && (
                        <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                      )}
                    </div>
                    {t.description && <div className="mt-1 text-[11px] font-medium text-slate-500 leading-normal">{t.description}</div>}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </Modal>
  )
}
