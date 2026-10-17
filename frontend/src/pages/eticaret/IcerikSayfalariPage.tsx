import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { FileText, Plus, RefreshCw, Trash2, Save } from 'lucide-react'
import { Modal, MessageBanner, PageHeader, SHOP_API, SHOP_SITE, authHeaders, btnDark, btnGhost, emptyPage, formatDate, input, label, send, usePanelMessage, type ContentPage } from './shared'

export default function IcerikSayfalariPage() {
  const { message, notify } = usePanelMessage()
  const [contentPages, setContentPages] = useState<ContentPage[]>([])
  const [pageDraft, setPageDraft] = useState<ContentPage | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const loadContentPages = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${SHOP_API}/api/admin/pages`, { headers: authHeaders(false) })
      if (!res.ok) throw new Error()
      const data = await res.json()
      setContentPages(data.data ?? [])
    } catch {
      notify('err', 'Sayfa listesi alınamadı.')
    } finally {
      setLoading(false)
    }
  }, [])

  const saveContentPage = async () => {
    if (!pageDraft) return
    setSaving(true)
    try {
      await send('/api/admin/pages', 'POST', pageDraft)
      notify('ok', 'Sayfa kaydedildi.')
      setPageDraft(null)
      void loadContentPages()
    } catch (err) {
      notify('err', (err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const deleteContentPage = async (page: ContentPage) => {
    if (!window.confirm(`"${page.title}" sayfası silinsin mi? Bu işlem geri alınamaz.`)) return
    try {
      await send(`/api/admin/pages/${page.id}`, 'DELETE')
      notify('ok', 'Sayfa silindi.')
      void loadContentPages()
    } catch (err) {
      notify('err', (err as Error).message)
    }
  }

  useEffect(() => { void loadContentPages() }, [loadContentPages])

  return (
    <div className="p-4 lg:p-6">
      <PageHeader title="İçerik Sayfaları" desc="Hakkımızda, sıkça sorulanlar gibi kendi yazdığın sayfalar."  />
      <MessageBanner message={message} />

      {(
        <div>
          <div className="flex flex-wrap gap-2 mb-4">
            <button
              type="button"
              onClick={() => void loadContentPages()}
              className="h-11 px-5 rounded-2xl border border-gray-200 bg-white text-sm font-semibold text-gray-700 hover:bg-gray-50 inline-flex items-center gap-2"
            >
              <RefreshCw size={15} />
              Yenile
            </button>
            <button
              type="button"
              onClick={() => setPageDraft({ ...emptyPage })}
              className="h-11 px-5 rounded-2xl bg-gray-900 text-white text-sm font-semibold hover:bg-black inline-flex items-center gap-2 ml-auto"
            >
              <Plus size={16} />
              Yeni sayfa
            </button>
          </div>

          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-4 py-3 text-[11px] font-bold text-gray-500 uppercase tracking-wider">Sayfa</th>
                    <th className="px-4 py-3 text-[11px] font-bold text-gray-500 uppercase tracking-wider">Adres</th>
                    <th className="px-4 py-3 text-[11px] font-bold text-gray-500 uppercase tracking-wider">Güncelleme</th>
                    <th className="px-4 py-3 text-[11px] font-bold text-gray-500 uppercase tracking-wider text-center">Durum</th>
                    <th className="px-4 py-3 text-[11px] font-bold text-gray-500 uppercase tracking-wider text-right">İşlem</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500">Yükleniyor...</td></tr>
                  )}

                  {!loading && contentPages.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                        <div className="font-semibold text-gray-700">Henüz ek sayfa oluşturulmadı.</div>
                        <div className="text-xs mt-1 max-w-xl mx-auto">
                          Burası mağazadaki <b>ek içerik sayfalarını</b> yönetir
                          (&quot;Hakkımızda&quot;, &quot;Sıkça sorulanlar&quot;, kampanya
                          sayfaları gibi) ve bunlar <code>/sayfa/adres</code> adresinde yayınlanır.
                          Sitede zaten yayında olan yasal sayfalar aşağıda listeli; onlar bu
                          tablodan gelmiyor, o yüzden burası boş görünüyor.
                        </div>
                      </td>
                    </tr>
                  )}

                  {!loading && contentPages.map((page) => (
                    <tr key={page.id} className="border-b border-gray-100 hover:bg-gray-50/60">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-gray-900">{page.title}</div>
                        {page.summary && <div className="text-[11px] text-gray-500">{page.summary}</div>}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-600">/sayfa/{page.slug}</td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                        {formatDate(page.updatedAt)}
                        {page.updatedBy && <div className="text-[11px] text-gray-400">{page.updatedBy}</div>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-3 py-1.5 rounded-full text-xs font-bold border inline-block ${
                          page.isPublished
                            ? 'bg-green-50 border-green-200 text-green-700'
                            : 'bg-gray-100 border-gray-200 text-gray-500'
                        }`}>
                          {page.isPublished ? 'Yayında' : 'Taslak'}
                        </span>
                        {page.showInFooter && (
                          <div className="text-[10px] text-gray-400 mt-1">alt menüde</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setPageDraft({ ...page })}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 text-gray-700 hover:bg-gray-50"
                        >
                          Düzenle
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteContentPage(page)}
                          className="ml-2 px-3 py-1.5 rounded-lg text-xs font-semibold border border-red-200 text-red-700 hover:bg-red-50 inline-flex items-center gap-1"
                        >
                          <Trash2 size={13} />
                          Sil
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/*
            SİSTEM SAYFALARI LİSTESİ.
            "Sayfalar boş görünüyor ama sitede sayfalar var" şikayetinin kaynağı buydu: iki
            ayrı kaynak var ve panel yalnızca birini gösteriyordu. Yasal sayfalar kod içinde
            duruyor (tablolu yapıları var ve firma bilgisini Vitrin Yönetimi'ndeki alanlardan
            çekiyorlar); metinleri panelden düzenlenmiyor ama hangi sayfaların YAYINDA olduğu
            burada görünmeli — aksi halde yönetici sitede ne olduğunu paneli açarak öğrenemiyor.
          */}
          <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden mt-4">
            <div className="px-5 py-4 border-b border-gray-100 bg-gradient-to-b from-gray-50 to-white">
              <div className="text-sm font-black text-gray-900">Sistem sayfaları (yayında)</div>
              <div className="text-[11px] text-gray-500 mt-0.5">
                Bu sayfalar kod içinde duruyor ve silinemez. İçlerindeki firma unvanı, adres,
                e-posta ve vergi bilgisi <b>Vitrin Yönetimi → Firma bilgileri</b> alanlarından
                gelir; o alanlar boşken sayfalar &quot;yayına hazır değil&quot; uyarısı gösterir.
              </div>
            </div>
            <div className="p-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {[
                { path: '/mesafeli-satis', label: 'Mesafeli Satış Sözleşmesi' },
                { path: '/gizlilik', label: 'Gizlilik Politikası' },
                { path: '/kvkk', label: 'KVKK Aydınlatma Metni' },
                { path: '/cerez', label: 'Çerez Politikası' },
                { path: '/teslimat', label: 'Teslimat ve İade' },
                { path: '/garanti', label: 'Garanti ve İade Koşulları' },
                { path: '/servis', label: 'Yetkili Servis' },
                { path: '/iletisim', label: 'İletişim' },
                { path: '/siparis-takibi', label: 'Sipariş Takibi' },
              ].map((p) => (
                <div
                  key={p.path}
                  className="flex items-center justify-between gap-2 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-gray-800 truncate">{p.label}</div>
                    <div className="font-mono text-[11px] text-gray-500 truncate">{p.path}</div>
                  </div>
                  <span className="shrink-0 px-2 py-1 rounded-full text-[10px] font-bold border bg-green-50 border-green-200 text-green-700">
                    Yayında
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {pageDraft && (
        <Modal
          title={pageDraft.id ? 'Sayfayı düzenle' : 'Yeni sayfa'}
          wide
          onClose={() => setPageDraft(null)}
          footer={
            <>
              <button type="button" onClick={() => setPageDraft(null)} className={btnGhost}>Vazgeç</button>
              <button type="button" disabled={saving} onClick={() => void saveContentPage()} className={btnDark}>
                <Save size={15} />
                {saving ? 'Kaydediliyor...' : 'Kaydet'}
              </button>
            </>
          }
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <span className={label}>Başlık</span>
              <input className={input} value={pageDraft.title}
                onChange={(e) => setPageDraft({ ...pageDraft, title: e.target.value })} />
            </div>
            <div>
              <span className={label}>Adres</span>
              <input className={input} placeholder="boş bırakılırsa başlıktan üretilir"
                value={pageDraft.slug}
                onChange={(e) => setPageDraft({ ...pageDraft, slug: e.target.value })} />
              <div className="text-[11px] text-gray-500 mt-1 ml-1">
                /sayfa/<b>{pageDraft.slug || '...'}</b>
                {pageDraft.id && ' — adresi değiştirirsen eski adres 404 verir.'}
              </div>
            </div>

            <div className="md:col-span-2">
              <span className={label}>Kısa açıklama (arama sonucunda görünür)</span>
              <input className={input} value={pageDraft.summary ?? ''}
                onChange={(e) => setPageDraft({ ...pageDraft, summary: e.target.value })} />
            </div>

            <div className="md:col-span-2">
              <span className={label}>İçerik</span>
              <textarea className={`${input} h-auto py-3 font-normal leading-relaxed`} rows={14}
                value={pageDraft.body}
                onChange={(e) => setPageDraft({ ...pageDraft, body: e.target.value })} />
              <div className="text-[11px] text-gray-500 mt-1 ml-1 leading-relaxed">
                Düz metin yazın. Boş satır bırakınca yeni paragraf olur; <b>##</b> ile başlayan
                satır ara başlık, <b>-</b> ile başlayan satır madde olur. HTML çalışmaz — bilerek:
                panele HTML yazma imkânı vermek, vitrine betik sokulabilmesi demek olurdu.
              </div>
            </div>

            <div className="md:col-span-2 flex flex-wrap items-center gap-5">
              <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                <input type="checkbox" checked={pageDraft.isPublished}
                  onChange={(e) => setPageDraft({ ...pageDraft, isPublished: e.target.checked })} />
                Yayında
              </label>
              <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                <input type="checkbox" checked={pageDraft.showInFooter}
                  onChange={(e) => setPageDraft({ ...pageDraft, showInFooter: e.target.checked })} />
                Alt menüde görünsün
              </label>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold text-gray-600 uppercase tracking-[0.14em]">Sıra</span>
                <input type="number" className={`${input} mt-0 w-24`} value={pageDraft.sortOrder}
                  onChange={(e) => setPageDraft({ ...pageDraft, sortOrder: Number(e.target.value || 0) })} />
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
