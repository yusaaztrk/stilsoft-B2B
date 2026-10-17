import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Bot, MessageSquareText, Plus, Save, ShieldCheck, Timer, Trash2, UserPlus, Users } from 'lucide-react'
import { api } from '../lib/session'
import { DEFAULT_SLA, MessageBanner, usePanelMessage, type Sla } from './mesajlar/parts'

/*
  ASİSTAN AYARLARI — yalnız yönetici (2026-10-08).

  Kimin hangi birimin mesajlarını gördüğü burada belirlenir. Kişiler B2B kullanıcıları; burada
  yalnız asistan ayarları tutulur (ayrı şifre yok). Programa GİRİŞ yetkisi ayrıca B2B → Kullanıcılar →
  "Asistan (WhatsApp)" kutusundan verilir — listede girişi kapalı olan kişi uyarıyla gösterilir.

  Yapay zekâ bölümü (2. aşama): asistan açık/kapalı, otomatik birim yönlendirmesi, firma talimatı ve
  "insan kararı gereken konular". Asistan müşteriye KENDİLİĞİNDEN yazmaz — yalnız taslak hazırlar,
  personel onaylar. Birimlerin "asistana anlat" açıklaması yönlendirmeyi besler.

  2026-10-09: bekleme uyarısı eşikleri (sarı/kırmızı dakika) ve hazır cevap yönetimi.
*/

type QuickReplyView = { id: number; departmentId?: number | null; title: string; body: string; sortOrder: number; isActive: boolean; useCount: number }

type Department = { id: number; code: string; name: string; sortOrder: number; isActive: boolean; memberCount: number; aiDescription?: string | null }
type AiView = {
  provider?: string | null
  model: string
  enabled: boolean
  autoRoute: boolean
  instructions?: string | null
  initiativeTopics?: string | null
  draftStats30d: Record<string, number>
  toolsEnabled: boolean
  tools: { erp: boolean; serviceOps: boolean; names: string[] }
}
const DRAFT_STATUS_LABEL: Record<string, string> = {
  sent: 'olduğu gibi gönderildi',
  edited: 'düzeltilip gönderildi',
  discarded: 'silindi',
  superseded: 'geçersiz kaldı',
  pending: 'bekliyor'
}
type Agent = { userName: string; displayName?: string | null; canSeeAll: boolean; isAdmin: boolean; isActive: boolean; departmentIds: number[] }
type B2BUser = { userName: string; title: string; role: string; hasAccess: boolean }

export default function AyarlarPage() {
  const { message, notify } = usePanelMessage()
  const [departments, setDepartments] = useState<Department[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [access, setAccess] = useState<Record<string, boolean | null>>({})
  const [loading, setLoading] = useState(true)
  const [denied, setDenied] = useState<string | null>(null)
  const [newDep, setNewDep] = useState('')
  const [userSearch, setUserSearch] = useState('')
  const [userResults, setUserResults] = useState<B2BUser[]>([])
  const [editing, setEditing] = useState<Record<string, Agent>>({})
  const [ai, setAi] = useState<AiView | null>(null)
  const [aiForm, setAiForm] = useState<{ enabled: boolean; autoRoute: boolean; toolsEnabled: boolean; instructions: string; initiativeTopics: string } | null>(null)
  const [aiSaving, setAiSaving] = useState(false)
  const [sla, setSla] = useState<Sla>(DEFAULT_SLA)
  const [slaForm, setSlaForm] = useState<Sla>(DEFAULT_SLA)
  const [quick, setQuick] = useState<QuickReplyView[]>([])
  const [newQuick, setNewQuick] = useState<{ departmentId: string; title: string; body: string }>({ departmentId: '', title: '', body: '' })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await api<{ ai: AiView; departments: Department[]; agents: Agent[]; access: Record<string, boolean | null>; sla?: Sla; quickReplies?: QuickReplyView[] }>('/api/panel/settings')
      setSla(d.sla ?? DEFAULT_SLA)
      setSlaForm(d.sla ?? DEFAULT_SLA)
      setQuick(d.quickReplies ?? [])
      setAi(d.ai)
      setAiForm({ enabled: d.ai.enabled, autoRoute: d.ai.autoRoute, toolsEnabled: d.ai.toolsEnabled, instructions: d.ai.instructions ?? '', initiativeTopics: d.ai.initiativeTopics ?? '' })
      setDepartments(d.departments)
      setAgents(d.agents)
      setEditing({})
      // Giriş yetkisi sunucuda kişi kişi hesaplanır; null = B2B'de bulunamadı (silinmiş/pasif kullanıcı).
      setAccess(d.access ?? {})
    } catch (e: any) {
      if (e?.status === 403) setDenied(e.message)
      else notify('err', (e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [notify])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const term = userSearch.trim()
    if (term.length < 2) {
      setUserResults([])
      return
    }
    const t = window.setTimeout(async () => {
      try {
        const list = await api<B2BUser[]>(`/api/panel/settings/b2b-users?q=${encodeURIComponent(term)}`)
        setUserResults(list)
        setAccess((p) => ({ ...p, ...Object.fromEntries(list.map((u) => [u.userName.toLowerCase(), u.hasAccess])) }))
      } catch (e) {
        notify('err', (e as Error).message)
      }
    }, 300)
    return () => window.clearTimeout(t)
  }, [userSearch, notify])

  const depName = (id: number) => departments.find((d) => d.id === id)?.name ?? `#${id}`
  const activeDeps = useMemo(() => departments.filter((d) => d.isActive), [departments])

  const current = (a: Agent) => editing[a.userName] ?? a
  const change = (a: Agent, patch: Partial<Agent>) => setEditing((p) => ({ ...p, [a.userName]: { ...current(a), ...patch } }))

  const saveAgent = async (a: Agent) => {
    const x = current(a)
    try {
      await api(`/api/panel/settings/agents/${encodeURIComponent(x.userName)}`, {
        method: 'PUT',
        body: JSON.stringify({ displayName: x.displayName, canSeeAll: x.canSeeAll, isAdmin: x.isAdmin, isActive: x.isActive, departmentIds: x.departmentIds })
      })
      notify('ok', `${x.userName} kaydedildi.`)
      void load()
    } catch (e) {
      notify('err', (e as Error).message)
    }
  }

  const addUser = (u: B2BUser) => {
    const key = u.userName.toLowerCase()
    if (agents.some((a) => a.userName === key)) {
      notify('err', `${u.userName} zaten listede.`)
      return
    }
    const a: Agent = { userName: key, displayName: u.title || null, canSeeAll: false, isAdmin: false, isActive: true, departmentIds: [] }
    setAgents((p) => [a, ...p])
    setEditing((p) => ({ ...p, [key]: a }))
    setUserSearch('')
    setUserResults([])
  }

  const saveAi = async () => {
    if (!aiForm) return
    setAiSaving(true)
    try {
      await api('/api/panel/settings/ai', { method: 'PUT', body: JSON.stringify(aiForm) })
      notify('ok', aiForm.enabled ? 'Asistan ayarları kaydedildi.' : 'Asistan kapatıldı.')
      void load()
    } catch (e) {
      notify('err', (e as Error).message)
    } finally {
      setAiSaving(false)
    }
  }

  const saveDepartment = async (d: Department, patch: Partial<Department>) => {
    try {
      await api(`/api/panel/settings/departments/${d.id}`, { method: 'PUT', body: JSON.stringify({ name: patch.name, isActive: patch.isActive, aiDescription: patch.aiDescription }) })
      void load()
    } catch (e) {
      notify('err', (e as Error).message)
    }
  }

  const createDepartment = async () => {
    if (!newDep.trim()) return
    try {
      await api('/api/panel/settings/departments', { method: 'POST', body: JSON.stringify({ name: newDep.trim() }) })
      setNewDep('')
      notify('ok', 'Birim eklendi.')
      void load()
    } catch (e) {
      notify('err', (e as Error).message)
    }
  }

  const saveSla = async () => {
    try {
      await api('/api/panel/settings/sla', { method: 'PUT', body: JSON.stringify(slaForm) })
      setSla(slaForm)
      notify('ok', `Bekleme uyarısı kaydedildi: ${slaForm.warnMinutes} dk sarı, ${slaForm.lateMinutes} dk kırmızı.`)
    } catch (e) {
      notify('err', (e as Error).message)
    }
  }

  const createQuick = async () => {
    if (!newQuick.title.trim() || !newQuick.body.trim()) return
    try {
      await api('/api/panel/settings/quick-replies', {
        method: 'POST',
        body: JSON.stringify({
          departmentId: newQuick.departmentId === '' ? null : Number(newQuick.departmentId),
          title: newQuick.title.trim(),
          body: newQuick.body.trim(),
          sortOrder: (quick.length + 1) * 10
        })
      })
      setNewQuick({ departmentId: newQuick.departmentId, title: '', body: '' })
      notify('ok', 'Hazır cevap eklendi.')
      await load()
    } catch (e) {
      notify('err', (e as Error).message)
    }
  }

  const saveQuick = async (q: QuickReplyView) => {
    try {
      await api(`/api/panel/settings/quick-replies/${q.id}`, {
        method: 'PUT',
        body: JSON.stringify({ departmentId: q.departmentId ?? null, title: q.title, body: q.body, sortOrder: q.sortOrder, isActive: q.isActive })
      })
      notify('ok', 'Hazır cevap kaydedildi.')
      await load()
    } catch (e) {
      notify('err', (e as Error).message)
    }
  }

  const deleteQuick = async (q: QuickReplyView) => {
    if (!window.confirm(`"${q.title}" hazır cevabı silinsin mi?`)) return
    try {
      await api(`/api/panel/settings/quick-replies/${q.id}`, { method: 'DELETE' })
      notify('ok', 'Hazır cevap silindi.')
      await load()
    } catch (e) {
      notify('err', (e as Error).message)
    }
  }

  if (denied) {
    return <div className="p-6 rounded-3xl bg-white border border-gray-200 text-sm font-semibold text-gray-700">{denied}</div>
  }

  return (
    <div className="h-full overflow-y-auto space-y-4 pb-6">
      <MessageBanner message={message} />

      {/* ---------------- asistan (yapay zekâ) */}
      <section className="rounded-3xl border border-gray-200 bg-white p-4">
        <h2 className="text-base font-black text-gray-900 flex items-center gap-2 mb-1"><Bot className="w-5 h-5" /> Asistan (yapay zekâ)</h2>
        <p className="text-xs text-gray-500 mb-3">
          Asistan müşteriye <b>kendiliğinden yazmaz</b>. Müşteri yazdığında konuyu çıkarır, konuşmayı özetler ve bir <b>cevap taslağı</b>
          hazırlar; taslak Mesajlar ekranında personelin onayını bekler. Her taslak ücretli bir çağrıdır.
        </p>

        {ai && !ai.provider && (
          <div className="mb-3 px-3 py-2 rounded-2xl text-xs font-semibold border bg-amber-50 border-amber-200 text-amber-800 flex items-start gap-1.5">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            Sunucuda yapay zekâ anahtarı tanımlı değil (<code>Ai:ApiKey</code>), bu yüzden taslak üretilmez. Aşağıdaki ayarlar
            anahtar girilince geçerli olur.
          </div>
        )}

        {aiForm && ai && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-4">
              <label className="inline-flex items-center gap-2 text-sm font-bold text-gray-800">
                <input type="checkbox" checked={aiForm.enabled} onChange={(e) => setAiForm({ ...aiForm, enabled: e.target.checked })} className="w-4 h-4 accent-green-600" />
                Asistan açık (taslak hazırlasın)
              </label>
              <label className="inline-flex items-center gap-2 text-sm font-bold text-gray-800">
                <input type="checkbox" checked={aiForm.autoRoute} onChange={(e) => setAiForm({ ...aiForm, autoRoute: e.target.checked })} className="w-4 h-4 accent-green-600" />
                Konuşmayı ilgili birime kendisi yönlendirsin
              </label>
              <label className="inline-flex items-center gap-2 text-sm font-bold text-gray-800">
                <input
                  type="checkbox"
                  checked={aiForm.toolsEnabled}
                  disabled={!ai.tools.erp && !ai.tools.serviceOps}
                  onChange={(e) => setAiForm({ ...aiForm, toolsEnabled: e.target.checked })}
                  className="w-4 h-4 accent-green-600"
                />
                Müşterinin kayıtlarına baksın (bakiye, sipariş, fatura, servis/montaj)
              </label>
              <span className="text-[11px] text-gray-500">
                Model: <b>{ai.model}</b>{ai.provider ? '' : ' (kapalı)'}
              </span>
            </div>

            {/* Kayıt bağlantısı: sunucudaki Tools anahtarları. Hangi kayda bakılacağını müşterinin numarası belirler. */}
            <div className="text-[11px] text-gray-600 flex flex-wrap items-center gap-2">
              <span className="font-bold">Kayıt bağlantısı:</span>
              <span className={`px-1.5 py-0.5 rounded-md font-bold ${ai.tools.erp ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                ERP (bakiye, sipariş, fatura) {ai.tools.erp ? 'hazır' : 'anahtar yok'}
              </span>
              <span className={`px-1.5 py-0.5 rounded-md font-bold ${ai.tools.serviceOps ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                Servis (servis, montaj) {ai.tools.serviceOps ? 'hazır' : 'anahtar yok'}
              </span>
              <span className="text-gray-400">Asistan yalnız mesajı yazan numaranın eşleştiği carinin ve kendi servis kayıtlarının bilgisine bakar.</span>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-black text-gray-700 mb-1">Firma talimatı</label>
                <textarea
                  value={aiForm.instructions}
                  onChange={(e) => setAiForm({ ...aiForm, instructions: e.target.value })}
                  rows={6}
                  maxLength={4000}
                  placeholder={'Örnek: Müşteriye "siz" diye hitap et. Çalışma saatlerimiz 08:30-18:00, pazar kapalı. Fiyat ve indirim sözü verme, Kurumsal Satış birimine devret. Teknik arızada önce model ve seri no sor.'}
                  className="w-full rounded-2xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-600/20"
                />
                <div className="text-[10px] text-gray-400 mt-0.5">Asistan her taslakta bu metne uyar. {aiForm.instructions.length}/4000</div>
              </div>
              <div>
                <label className="block text-xs font-black text-gray-700 mb-1">İnsan kararı gereken konular</label>
                <textarea
                  value={aiForm.initiativeTopics}
                  onChange={(e) => setAiForm({ ...aiForm, initiativeTopics: e.target.value })}
                  rows={6}
                  maxLength={2000}
                  placeholder={'Her satıra bir konu. Örnek:\nFiyat indirimi / iskonto\nGaranti dışı ücret\nİade ve para geri ödeme\nŞikâyet ve hukuki konular'}
                  className="w-full rounded-2xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-600/20"
                />
                <div className="text-[10px] text-gray-400 mt-0.5">Bu konular geçerse taslak "insan kararı gerekli" damgasıyla gelir. {aiForm.initiativeTopics.length}/2000</div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-[11px] text-gray-500">
                Son 30 gün:{' '}
                {Object.keys(ai.draftStats30d ?? {}).length === 0
                  ? 'henüz taslak üretilmedi.'
                  : Object.entries(ai.draftStats30d).map(([k, v]) => `${v} ${DRAFT_STATUS_LABEL[k] ?? k}`).join(' · ')}
              </div>
              <button
                type="button"
                onClick={() => void saveAi()}
                disabled={aiSaving}
                className="h-9 px-4 rounded-2xl bg-green-600 text-white text-xs font-bold disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                <Save className="w-4 h-4" /> {aiSaving ? 'Kaydediliyor…' : 'Asistan ayarlarını kaydet'}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ---------------- kişiler */}
      <section className="rounded-3xl border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <h2 className="text-base font-black text-gray-900 flex items-center gap-2"><Users className="w-5 h-5" /> Kişiler ve birimleri</h2>
            <p className="text-xs text-gray-500">
              Kişi yalnız işaretli birimlerin konuşmalarını görür ve cevaplar. "Hepsini gör" bütün konuşmaları ve atanmamış kuyruğu açar.
              "Yönetici" bu sayfayı yönetir. B2B süper yönetici rolündekiler zaten yöneticidir.
            </p>
          </div>
        </div>

        <div className="relative mb-3 max-w-md">
          <UserPlus className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={userSearch}
            onChange={(e) => setUserSearch(e.target.value)}
            placeholder="Kişi ekle: B2B kullanıcı adı ya da unvan (en az 2 harf)"
            className="w-full h-10 pl-9 pr-3 rounded-2xl border border-gray-200 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-green-600/20"
          />
          {userResults.length > 0 && (
            <div className="absolute z-20 mt-1 w-full rounded-2xl border border-gray-200 bg-white shadow-lg max-h-72 overflow-y-auto">
              {userResults.map((u) => (
                <button key={u.userName} type="button" onClick={() => addUser(u)} className="w-full text-left px-3 py-2 hover:bg-gray-50 flex items-center justify-between gap-2">
                  <span className="min-w-0">
                    <span className="text-sm font-bold text-gray-900">{u.userName}</span>
                    <span className="text-xs text-gray-500"> {u.title} · {u.role}</span>
                  </span>
                  {!u.hasAccess && <span className="text-[10px] font-bold text-amber-700 shrink-0">giriş yetkisi yok</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {loading ? (
          <div className="text-sm text-gray-500 p-4">Yükleniyor…</div>
        ) : agents.length === 0 ? (
          <div className="text-sm text-gray-500 p-4">Henüz kimse eklenmedi. Yukarıdan B2B kullanıcısı arayıp ekleyin.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-gray-400">
                  <th className="py-2 pr-3">Kişi</th>
                  <th className="py-2 pr-3">Birimler</th>
                  <th className="py-2 pr-3 text-center">Hepsini gör</th>
                  <th className="py-2 pr-3 text-center">Yönetici</th>
                  <th className="py-2 pr-3 text-center">Aktif</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {agents.map((a) => {
                  const x = current(a)
                  const dirty = !!editing[a.userName]
                  const hasAccess = access[a.userName]
                  return (
                    <tr key={a.userName} className="border-t border-gray-100 align-top">
                      <td className="py-2 pr-3 min-w-[160px]">
                        <div className="font-bold text-gray-900">{a.userName}</div>
                        {x.displayName && <div className="text-xs text-gray-500">{x.displayName}</div>}
                        {hasAccess === false && (
                          <div className="mt-1 text-[10px] font-bold text-amber-700 flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" /> Asistan giriş yetkisi kapalı (B2B → Kullanıcılar → "Asistan (WhatsApp)")
                          </div>
                        )}
                        {hasAccess === null && (
                          <div className="mt-1 text-[10px] font-bold text-red-600 flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" /> B2B'de aktif kullanıcı olarak bulunamadı
                          </div>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        <div className="flex flex-wrap gap-1.5">
                          {activeDeps.map((d) => {
                            const on = x.departmentIds.includes(d.id)
                            return (
                              <button
                                key={d.id}
                                type="button"
                                onClick={() => change(a, { departmentIds: on ? x.departmentIds.filter((i) => i !== d.id) : [...x.departmentIds, d.id] })}
                                className={`px-2 py-1 rounded-lg text-[11px] font-bold border ${on ? 'bg-sky-600 text-white border-sky-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
                              >
                                {d.name}
                              </button>
                            )
                          })}
                          {x.departmentIds.filter((i) => !activeDeps.some((d) => d.id === i)).map((i) => (
                            <span key={i} className="px-2 py-1 rounded-lg text-[11px] font-bold bg-gray-100 text-gray-400 line-through" title="Pasif birim">{depName(i)}</span>
                          ))}
                        </div>
                      </td>
                      <td className="py-2 pr-3 text-center"><input type="checkbox" checked={x.canSeeAll} onChange={(e) => change(a, { canSeeAll: e.target.checked })} className="w-4 h-4 accent-green-600" /></td>
                      <td className="py-2 pr-3 text-center"><input type="checkbox" checked={x.isAdmin} onChange={(e) => change(a, { isAdmin: e.target.checked })} className="w-4 h-4 accent-green-600" /></td>
                      <td className="py-2 pr-3 text-center"><input type="checkbox" checked={x.isActive} onChange={(e) => change(a, { isActive: e.target.checked })} className="w-4 h-4 accent-green-600" /></td>
                      <td className="py-2 text-right">
                        <button
                          type="button"
                          disabled={!dirty}
                          onClick={() => void saveAgent(a)}
                          className="h-8 px-3 rounded-xl bg-green-600 text-white text-xs font-bold disabled:opacity-30 inline-flex items-center gap-1"
                        >
                          <Save className="w-3.5 h-3.5" /> Kaydet
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ---------------- bekleme uyarısı */}
      <section className="rounded-3xl border border-gray-200 bg-white p-4">
        <h2 className="text-base font-black text-gray-900 flex items-center gap-2 mb-1"><Timer className="w-5 h-5" /> Bekleme uyarısı</h2>
        <p className="text-xs text-gray-500 mb-3">
          Müşteri yazdıktan sonra cevap verilmezse konuşma önce <b className="text-amber-700">sarı</b>, sonra <b className="text-red-700">kırmızı ve yanıp sönen</b> olur.
          Kırmızıya dönen konuşmalar listenin üstünde sayılır; ses ve (izin verildiyse) masaüstü bildirimi gelir.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-bold text-gray-700">
            Sarı (dk)
            <input type="number" min={1} max={1440} value={slaForm.warnMinutes} onChange={(e) => setSlaForm({ ...slaForm, warnMinutes: Number(e.target.value) })}
              className="mt-1 block w-24 h-9 px-2 rounded-xl border border-amber-300 bg-amber-50 text-sm font-bold" />
          </label>
          <label className="text-xs font-bold text-gray-700">
            Kırmızı (dk)
            <input type="number" min={1} max={1440} value={slaForm.lateMinutes} onChange={(e) => setSlaForm({ ...slaForm, lateMinutes: Number(e.target.value) })}
              className="mt-1 block w-24 h-9 px-2 rounded-xl border border-red-300 bg-red-50 text-sm font-bold" />
          </label>
          <button
            type="button"
            onClick={() => void saveSla()}
            disabled={slaForm.warnMinutes === sla.warnMinutes && slaForm.lateMinutes === sla.lateMinutes}
            className="h-9 px-3 rounded-xl bg-green-600 text-white text-xs font-bold inline-flex items-center gap-1 disabled:opacity-40"
          >
            <Save className="w-4 h-4" /> Kaydet
          </button>
          {slaForm.warnMinutes >= slaForm.lateMinutes && <span className="text-[11px] font-bold text-red-600">Sarı süre kırmızıdan kısa olmalı.</span>}
        </div>
      </section>

      {/* ---------------- hazır cevaplar */}
      <section className="rounded-3xl border border-gray-200 bg-white p-4">
        <h2 className="text-base font-black text-gray-900 flex items-center gap-2 mb-1"><MessageSquareText className="w-5 h-5" /> Hazır cevaplar</h2>
        <p className="text-xs text-gray-500 mb-3">
          Personel mesaj yazarken "Hazır cevap" düğmesinden seçer. Birim seçilmezse herkese görünür. Metinde <code className="px-1 rounded bg-gray-100">{'{musteri}'}</code> müşterinin adıyla,
          <code className="px-1 rounded bg-gray-100 ml-1">{'{numara}'}</code> telefonuyla dolar.
        </p>
        <div className="space-y-2">
          {quick.length === 0 && <div className="text-xs text-gray-500">Henüz hazır cevap yok.</div>}
          {quick.map((q) => (
            <QuickRow key={q.id} q={q} departments={departments} onSave={(x) => void saveQuick(x)} onDelete={() => void deleteQuick(q)} />
          ))}
        </div>
        <div className="mt-3 p-3 rounded-2xl border border-dashed border-gray-300 space-y-2">
          <div className="flex flex-wrap gap-2">
            <select value={newQuick.departmentId} onChange={(e) => setNewQuick({ ...newQuick, departmentId: e.target.value })} className="h-9 px-2 rounded-xl border border-gray-200 text-xs font-bold">
              <option value="">Bütün birimler</option>
              {departments.filter((d) => d.isActive).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <input value={newQuick.title} onChange={(e) => setNewQuick({ ...newQuick, title: e.target.value })} maxLength={60} placeholder="Başlık (ör. Servis randevusu)"
              className="flex-1 min-w-[180px] h-9 px-3 rounded-xl border border-gray-200 text-sm font-semibold" />
          </div>
          <textarea value={newQuick.body} onChange={(e) => setNewQuick({ ...newQuick, body: e.target.value })} rows={3} maxLength={2000}
            placeholder="Merhaba {musteri}, servis kaydınızı oluşturduk; teknisyenimiz sizi arayıp randevu verecek."
            className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" />
          <button type="button" onClick={() => void createQuick()} disabled={!newQuick.title.trim() || !newQuick.body.trim()}
            className="h-9 px-3 rounded-xl bg-gray-900 text-white text-xs font-bold inline-flex items-center gap-1 disabled:opacity-40">
            <Plus className="w-4 h-4" /> Hazır cevap ekle
          </button>
        </div>
      </section>

      {/* ---------------- birimler */}
      <section className="rounded-3xl border border-gray-200 bg-white p-4">
        <h2 className="text-base font-black text-gray-900 flex items-center gap-2 mb-1"><ShieldCheck className="w-5 h-5" /> Birimler</h2>
        <p className="text-xs text-gray-500 mb-3">
          Pasif birime yeni konuşma yönlendirilemez; içindeki konuşmalar yerinde kalır. "Asistana anlat" kutusu, yeni mesajın
          hangi birime gideceğine karar verirken asistanın okuduğu metindir.
        </p>
        <div className="space-y-1.5">
          {departments.map((d) => (
            <DepartmentRow key={d.id} d={d} onSave={(patch) => void saveDepartment(d, patch)} />
          ))}
        </div>
        <div className="flex gap-2 mt-3 max-w-md">
          <input
            value={newDep}
            onChange={(e) => setNewDep(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void createDepartment() }}
            placeholder="Yeni birim adı"
            className="flex-1 h-9 px-3 rounded-xl border border-gray-200 text-sm font-semibold"
          />
          <button type="button" onClick={() => void createDepartment()} className="h-9 px-3 rounded-xl bg-gray-900 text-white text-xs font-bold inline-flex items-center gap-1">
            <Plus className="w-4 h-4" /> Ekle
          </button>
        </div>
      </section>
    </div>
  )
}

function DepartmentRow({ d, onSave }: { d: Department; onSave: (patch: Partial<Department>) => void }) {
  const [name, setName] = useState(d.name)
  const [desc, setDesc] = useState(d.aiDescription ?? '')
  useEffect(() => setName(d.name), [d.name])
  useEffect(() => setDesc(d.aiDescription ?? ''), [d.aiDescription])
  const dirty = name.trim() !== d.name || desc.trim() !== (d.aiDescription ?? '').trim()
  return (
    <div className={`px-2 py-1.5 rounded-xl ${d.isActive ? '' : 'opacity-60'}`}>
      <div className="flex items-center gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} className="flex-1 max-w-xs h-8 px-2 rounded-lg border border-gray-200 text-sm font-semibold" />
        <span className="text-[11px] text-gray-500 w-20">{d.memberCount} kişi</span>
        {dirty && (
          <button type="button" onClick={() => onSave({ name: name.trim(), aiDescription: desc.trim() })} className="h-8 px-2.5 rounded-lg bg-green-600 text-white text-[11px] font-bold inline-flex items-center gap-1">
            <Save className="w-3.5 h-3.5" /> Kaydet
          </button>
        )}
        <button
          type="button"
          onClick={() => onSave({ isActive: !d.isActive })}
          className="h-8 px-2.5 rounded-lg border border-gray-200 text-[11px] font-bold text-gray-600 hover:bg-gray-50"
        >
          {d.isActive ? 'Pasife al' : 'Aktif et'}
        </button>
      </div>
      <textarea
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
        rows={2}
        maxLength={600}
        placeholder={`Asistana anlat: ${d.name} hangi konulara bakar? (örn. "arıza, tamir, yedek parça, garanti")`}
        className="mt-1 w-full rounded-xl border border-gray-200 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-green-600/20"
      />
    </div>
  )
}

function QuickRow({ q, departments, onSave, onDelete }: { q: QuickReplyView; departments: Department[]; onSave: (q: QuickReplyView) => void; onDelete: () => void }) {
  const [f, setF] = useState(q)
  useEffect(() => setF(q), [q])
  const dirty = f.title !== q.title || f.body !== q.body || (f.departmentId ?? null) !== (q.departmentId ?? null) || f.isActive !== q.isActive
  return (
    <div className={`p-2.5 rounded-2xl border border-gray-200 ${f.isActive ? '' : 'opacity-60'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={f.departmentId ?? ''}
          onChange={(e) => setF({ ...f, departmentId: e.target.value === '' ? null : Number(e.target.value) })}
          className="h-8 px-2 rounded-lg border border-gray-200 text-[11px] font-bold"
        >
          <option value="">Bütün birimler</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={60} className="flex-1 min-w-[160px] h-8 px-2 rounded-lg border border-gray-200 text-sm font-bold" />
        <span className="text-[10px] text-gray-400" title="Kaç kez kullanıldı">{q.useCount} kullanım</span>
        <label className="text-[11px] font-bold text-gray-600 inline-flex items-center gap-1">
          <input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> Aktif
        </label>
        {dirty && (
          <button type="button" onClick={() => onSave(f)} className="h-8 px-2.5 rounded-lg bg-green-600 text-white text-[11px] font-bold inline-flex items-center gap-1">
            <Save className="w-3.5 h-3.5" /> Kaydet
          </button>
        )}
        <button type="button" onClick={onDelete} className="h-8 px-2 rounded-lg border border-gray-200 text-gray-500 hover:bg-red-50 hover:text-red-600" title="Sil">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      <textarea value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} rows={2} maxLength={2000}
        className="mt-1.5 w-full rounded-xl border border-gray-200 px-2.5 py-1.5 text-xs" />
    </div>
  )
}
