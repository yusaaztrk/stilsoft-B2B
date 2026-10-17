import { useEffect, useMemo, useState } from 'react'
import {
  fetchPosAccountSettings,
  savePosAccountSetting,
  type PosAccountSettingDto,
  type PosProviderDto,
  type TargetAccountDto
} from '../api/posAccounts'
import FormSearchableSelect from '../components/forms/FormSearchableSelect'

// Kanonik kodlama: 1 = TRY, 2 = EUR, 3 = USD, 4 = GBP (0 eski TL kayıtları).
// Diğer ekranlardaki (BankAccountDefinitionsPage, CariEkstreReport…) kardeşiyle aynı.
function currencyLabel(v: number) {
  const n = Number(v ?? 1)
  if (n === 2) return 'EURO'
  if (n === 3) return 'DOLAR'
  if (n === 4) return 'STERLİN'
  return 'TL'
}

export default function PosAccountSettingsPage() {
  const [rows, setRows] = useState<PosAccountSettingDto[]>([])
  const [targets, setTargets] = useState<TargetAccountDto[]>([])
  const [providers, setProviders] = useState<PosProviderDto[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await fetchPosAccountSettings()
      setRows(data.posAccounts)
      setTargets(data.targetAccounts)
      setProviders(data.providers)
    } catch (e: any) {
      setError(e?.message || 'POS hesapları yüklenemedi.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const patch = (id: number, changes: Partial<PosAccountSettingDto>) => {
    setRows(prev => prev.map(r => (r.posBankAccountDefinitionId === id ? { ...r, ...changes } : r)))
  }

  const save = async (row: PosAccountSettingDto) => {
    try {
      setSavingId(row.posBankAccountDefinitionId)
      setError(null)
      setNotice(null)
      await savePosAccountSetting({
        posBankAccountDefinitionId: row.posBankAccountDefinitionId,
        targetBankAccountDefinitionId: row.targetBankAccountDefinitionId,
        virtualPosBankCode: row.virtualPosBankCode,
        transferTime: row.transferTime,
        isAutoTransferEnabled: row.isAutoTransferEnabled
      })
      setNotice(`${row.accountName} kaydedildi.`)
      await load()
    } catch (e: any) {
      setError(e?.message || 'Kaydedilemedi.')
    } finally {
      setSavingId(null)
    }
  }

  const unconfigured = useMemo(() => rows.filter(r => !r.isConfigured).length, [rows])

  return (
    <div className="p-6">
      <h1 className="text-xl font-bold text-slate-800">POS Hesap Ayarları</h1>
      <p className="text-xs text-slate-500 mt-1">
        Her POS hesabının bakiyesinin hangi vadesiz hesaba, saat kaçta aktarılacağı burada tanımlanır.
      </p>

      {unconfigured > 0 && (
        <div className="mt-3 text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3">
          {unconfigured} POS hesabının vadesiz hesabı tanımlı değil. Tanımlanana kadar o hesaplar için otomatik aktarım çalışmaz.
        </div>
      )}

      {error && <div className="mt-3 text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg p-3">{error}</div>}
      {notice && <div className="mt-3 text-xs bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg p-3">{notice}</div>}

      {loading ? (
        <div className="mt-6 text-sm text-slate-500">Yükleniyor…</div>
      ) : (
        <div className="mt-4 overflow-x-auto border border-slate-200 rounded-xl bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left px-3 py-2 font-semibold">POS Hesabı</th>
                <th className="text-left px-3 py-2 font-semibold">Sanal POS Sağlayıcı</th>
                <th className="text-left px-3 py-2 font-semibold">Aktarılacak Vadesiz Hesap</th>
                <th className="text-left px-3 py-2 font-semibold">Aktarım Saati</th>
                <th className="text-left px-3 py-2 font-semibold">Otomatik</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.posBankAccountDefinitionId} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    <div className="font-medium text-slate-800">{row.accountName}</div>
                    <div className="text-[11px] text-slate-400">
                      {row.accountCode}
                      {row.accountNo ? ` · ${row.accountNo}` : ''}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <FormSearchableSelect
                      className="w-56"
                      placeholder="— Sanal POS yok —"
                      value={row.virtualPosBankCode ?? ''}
                      onChange={e =>
                        patch(row.posBankAccountDefinitionId, {
                          virtualPosBankCode: e.target?.value ? Number(e.target.value) : null
                        })
                      }
                      options={[
                        { value: '', label: '— Sanal POS yok (elle giriş) —' },
                        ...providers.map(p => ({
                          value: String(p.bankCode),
                          label: `${p.bankName} (${p.posType})`
                        }))
                      ]}
                    />
                    {/*
                      Seçim boşken bile hesap eski isim benzerliğiyle bağlı olabilir. Bunu
                      söylemezsek kullanıcı "bağlı değil" sanıp ya boş bırakır ya da ikinci
                      bir hesaba aynı sağlayıcıyı verir.
                    */}
                    {row.matchSource === 'convention' && row.matchedProvider && (
                      <div className="text-[10px] text-amber-600 mt-1">
                        Hesap koduyla eşleşiyor: {row.matchedProvider.bankName}. Kod değişirse
                        bağ kopar — seçerek sabitleyin.
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <FormSearchableSelect
                      className="w-64"
                      placeholder="— Seçilmedi —"
                      value={row.targetBankAccountDefinitionId ?? ''}
                      onChange={e =>
                        patch(row.posBankAccountDefinitionId, {
                          targetBankAccountDefinitionId: e.target?.value ? Number(e.target.value) : null
                        })
                      }
                      options={[
                        { value: '', label: '— Seçilmedi —' },
                        // Hedef hesabın PARA BİRİMİ etikette gösterilir: süpürme artık
                        // çapraz dövizi doğru işliyor (çıkış POS'un, giriş hedefin
                        // parasında), ama kullanıcının hangi hesaba aktardığını bilmesi
                        // gerekiyor — listede yalnız hesap adı vardı.
                        ...targets.map(t => ({
                          value: String(t.id),
                          label: `${t.accountName} (${currencyLabel(t.currencyTypeId)})`
                        }))
                      ]}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="time"
                      className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs"
                      value={row.transferTime}
                      onChange={e => patch(row.posBankAccountDefinitionId, { transferTime: e.target.value })}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={row.isAutoTransferEnabled}
                      onChange={e => patch(row.posBankAccountDefinitionId, { isAutoTransferEnabled: e.target.checked })}
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      disabled={savingId === row.posBankAccountDefinitionId}
                      onClick={() => void save(row)}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold"
                    >
                      {savingId === row.posBankAccountDefinitionId ? 'Kaydediliyor…' : 'Kaydet'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-[11px] text-slate-400">
        Aktarım her zaman kapanmış olan bir önceki günü aktarır; saat yalnızca ne zaman bakılacağını belirler.
        Sunucu o saatte kapalıysa açıldığında kaçırdığı günleri tamamlar.
      </p>
    </div>
  )
}
