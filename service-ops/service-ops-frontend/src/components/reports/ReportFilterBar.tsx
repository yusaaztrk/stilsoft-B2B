import { DATE_PRESETS, type DatePreset, type ReportFilter } from '../../api/reports'

type Props = {
  value: ReportFilter
  onChange: (next: ReportFilter) => void
  /** Bu ekranda anlamı olmayan alanlar gizlenir; boş filtre kutusu göstermek yerine. */
  hide?: Array<'type' | 'category' | 'dealer' | 'technician' | 'search'>
  dealers?: Array<{ code: string; name: string }>
  technicians?: Array<{ id: string; name: string }>
  right?: React.ReactNode
}

/**
 * Bütün rapor ekranlarının paylaştığı filtre çubuğu.
 *
 * Ön ayar seçildiğinde from/to TEMİZLENİR: ikisi birden dolu kalırsa hangisinin kazandığı
 * ekrandan okunamaz, kullanıcı "Bu Ay"a bastığı halde eski tarih aralığını görmeye devam eder.
 */
export default function ReportFilterBar({ value, onChange, hide = [], dealers, technicians, right }: Props) {
  const hidden = new Set(hide)

  const setPreset = (preset: DatePreset) => {
    onChange({ ...value, preset, from: undefined, to: undefined })
  }

  const setCustomDate = (key: 'from' | 'to', date: string) => {
    onChange({ ...value, [key]: date || undefined, preset: undefined })
  }

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-3 sm:p-4 space-y-3 shadow-xs">
      <div className="flex flex-wrap gap-1.5">
        {DATE_PRESETS.map((p) => {
          const active = value.preset === p.id
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => setPreset(p.id)}
              className={
                'px-2.5 py-1 rounded-lg text-[11px] font-bold transition ' +
                (active
                  ? 'bg-gray-900 text-white'
                  : 'bg-gray-50 text-gray-600 hover:bg-gray-100 border border-gray-200')
              }
            >
              {p.label}
            </button>
          )
        })}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Başlangıç">
          <input
            type="date"
            value={value.from ?? ''}
            onChange={(e) => setCustomDate('from', e.target.value)}
            className={inputClass}
          />
        </Field>

        <Field label="Bitiş">
          <input
            type="date"
            value={value.to ?? ''}
            onChange={(e) => setCustomDate('to', e.target.value)}
            className={inputClass}
          />
        </Field>

        {!hidden.has('type') && (
          <Field label="İş Tipi">
            <select
              value={value.type ?? ''}
              onChange={(e) => onChange({ ...value, type: (e.target.value || undefined) as ReportFilter['type'] })}
              className={inputClass}
            >
              <option value="">Tümü</option>
              <option value="Installation">Montaj</option>
              <option value="Repair">Arıza</option>
              <option value="Maintenance">Bakım</option>
              <option value="Warranty">Garanti</option>
            </select>
          </Field>
        )}

        {!hidden.has('category') && (
          <Field label="Ürün Grubu">
            <select
              value={value.productCategory ?? ''}
              onChange={(e) =>
                onChange({ ...value, productCategory: (e.target.value || undefined) as ReportFilter['productCategory'] })
              }
              className={inputClass}
            >
              <option value="">Tümü</option>
              <option value="Large">Büyük Ürün</option>
              <option value="Small">Küçük Ürün</option>
            </select>
          </Field>
        )}

        {!hidden.has('dealer') && dealers && dealers.length > 0 && (
          <Field label="Bayi">
            <select
              value={value.dealerCode ?? ''}
              onChange={(e) => onChange({ ...value, dealerCode: e.target.value || undefined })}
              className={inputClass}
            >
              <option value="">Tümü</option>
              {dealers.map((d) => (
                <option key={d.code} value={d.code}>{d.name || d.code}</option>
              ))}
            </select>
          </Field>
        )}

        {!hidden.has('technician') && technicians && technicians.length > 0 && (
          <Field label="Teknisyen">
            <select
              value={value.technicianId ?? ''}
              onChange={(e) => onChange({ ...value, technicianId: e.target.value || undefined })}
              className={inputClass}
            >
              <option value="">Tümü</option>
              {technicians.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </Field>
        )}

        {!hidden.has('search') && (
          <Field label="Ara">
            <input
              type="text"
              placeholder="Servis no, müşteri, ürün…"
              value={value.search ?? ''}
              onChange={(e) => onChange({ ...value, search: e.target.value || undefined })}
              className={inputClass + ' min-w-[180px]'}
            />
          </Field>
        )}

        <div className="ml-auto flex items-end gap-2">{right}</div>
      </div>
    </div>
  )
}

const inputClass =
  'h-9 px-2.5 rounded-lg border border-gray-200 bg-white text-xs text-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-200'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400">{label}</span>
      {children}
    </label>
  )
}
