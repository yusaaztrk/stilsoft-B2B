import { useEffect, useState, useRef } from 'react'
import { AdminLayout } from '../components/admin/AdminLayout'
import { getAdminToken, readApiResponse } from '../lib/api'
import { Button } from '../components/ui/Button'
import { useToast } from '../components/ui/ToastContext'

interface RichTextEditorProps {
  value: string
  onChange: (value: string) => void
}

function RichTextEditor({ value, onChange }: RichTextEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorInstanceRef = useRef<any>(null)
  const [loaded, setLoaded] = useState(!!(window as any).ClassicEditor)
  const [usePlainFallback, setUsePlainFallback] = useState(false)
  const lastValueRef = useRef(value)

  useEffect(() => {
    if ((window as any).ClassicEditor) {
      setLoaded(true)
      return
    }

    const scriptId = 'ckeditor-script'
    let script = document.getElementById(scriptId) as HTMLScriptElement
    if (!script) {
      script = document.createElement('script')
      script.id = scriptId
      script.src = '/ckeditor.js'
      script.async = true
      document.body.appendChild(script)
    }

    const handleLoad = () => setLoaded(true)
    const handleError = () => {
      setUsePlainFallback(true)
    }
    script.addEventListener('load', handleLoad)
    script.addEventListener('error', handleError)

    // Set a timeout to switch to fallback if loading takes too long (e.g. 3 seconds)
    const timer = setTimeout(() => {
      if (!(window as any).ClassicEditor) {
        setUsePlainFallback(true)
      }
    }, 3000)

    return () => {
      script.removeEventListener('load', handleLoad)
      script.removeEventListener('error', handleError)
      clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    if (usePlainFallback || !loaded || !containerRef.current) return

    let editor: any = null
    let active = true

    const element = document.createElement('div')
    containerRef.current.appendChild(element)

    ;(window as any).ClassicEditor.create(element, {
      toolbar: [
        'heading',
        '|',
        'bold',
        'italic',
        'link',
        'bulletedList',
        'numberedList',
        'blockQuote',
        '|',
        'undo',
        'redo',
      ],
    })
      .then((createdEditor: any) => {
        if (!active) {
          createdEditor.destroy()
          return
        }
        editor = createdEditor
        editorInstanceRef.current = editor
        editor.setData(value)

        editor.model.document.on('change:data', () => {
          const data = editor.getData()
          lastValueRef.current = data
          onChange(data)
        })
      })
      .catch((err: any) => {
        console.error('CKEditor error:', err)
        setUsePlainFallback(true)
      })

    return () => {
      active = false
      if (editor) {
        editor.destroy().then(() => {
          if (editorInstanceRef.current === editor) {
            editorInstanceRef.current = null
          }
        })
      }
      if (containerRef.current) {
        containerRef.current.innerHTML = ''
      }
    }
  }, [loaded, usePlainFallback])

  // Watch for external data changes
  useEffect(() => {
    const editor = editorInstanceRef.current
    if (editor && value !== lastValueRef.current) {
      lastValueRef.current = value
      editor.setData(value)
    }
  }, [value])

  if (usePlainFallback) {
    return (
      <div className="border border-zinc-200/80 rounded-2xl overflow-hidden min-h-[420px] bg-white shadow-sm focus-within:ring-4 focus-within:ring-[#df0000]/5 focus-within:border-[#df0000] transition-all duration-200 flex flex-col">
        <div className="flex justify-between items-center bg-zinc-50 border-b border-zinc-150 px-4 py-2 text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
          <span>Düz Metin Editörü (CKEditor Yüklenemedi)</span>
          <button
            type="button"
            onClick={() => setUsePlainFallback(false)}
            className="text-primary hover:underline lowercase font-bold text-[9px] tracking-normal"
          >
            Yeniden Dene
          </button>
        </div>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Sayfa içeriğini buraya girin (HTML etiketleri kullanabilirsiniz)..."
          className="flex-1 w-full min-h-[360px] p-4 text-xs outline-none resize-none font-semibold text-zinc-700"
        />
      </div>
    )
  }

  return (
    <div className="border border-zinc-200/80 rounded-2xl overflow-hidden min-h-[420px] bg-white shadow-sm focus-within:ring-4 focus-within:ring-[#df0000]/5 focus-within:border-[#df0000] transition-all duration-200">
      {!loaded && (
        <div className="flex flex-col items-center justify-center p-24 text-zinc-400 text-xs gap-3">
          <div className="w-8 h-8 border-4 border-zinc-200 border-t-[#df0000] rounded-full animate-spin" />
          <span>Zengin metin editörü yükleniyor...</span>
          <button
            type="button"
            onClick={() => setUsePlainFallback(true)}
            className="mt-2 text-[#df0000] hover:underline font-bold text-[10px]"
          >
            Düz Metin Editörüne Geç
          </button>
        </div>
      )}
      <div ref={containerRef} />
    </div>
  )
}

interface InformationPage {
  key: string
  title: string
  contentHtml: string
}

export function AdminPagesPage() {
  const { showToast } = useToast()
  const [pages, setPages] = useState<Record<string, InformationPage>>({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [activePage, setActivePage] = useState<string>('about-us')

  const fetchPages = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/info-pages')
      const json = await readApiResponse(res)
      if (res.ok && Array.isArray(json?.data)) {
        const map: Record<string, InformationPage> = {}
        json.data.forEach((p: InformationPage) => {
          map[p.key] = p
        })
        setPages(map)
      }
    } catch (err) {
      showToast('Sayfa içerikleri yüklenemedi.', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchPages()
  }, [])

  const save = async () => {
    setSaving(true)
    const activePageData = pages[activePage]
    if (!activePageData) return
    try {
      const res = await fetch(`/api/info-pages/${activePage}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getAdminToken()}`,
        },
        body: JSON.stringify({
          title: activePageData.title,
          contentHtml: activePageData.contentHtml
        }),
      })
      const json = await readApiResponse(res)
      if (!res.ok || !json?.success) throw new Error(json?.message || 'Kaydedilemedi')
      showToast('Sayfa içeriği başarıyla kaydedildi.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Kaydedilemedi', 'error')
    } finally {
      setSaving(false)
    }
  }

  const pagesConfig = [
    { key: 'about-us', label: 'Hakkımızda', icon: 'info' },
    { key: 'kvkk', label: 'KVKK Aydınlatma Metni', icon: 'gavel' },
    { key: 'privacy', label: 'Gizlilik Politikası', icon: 'security' },
    { key: 'distance-selling', label: 'Mesafeli Satış Sözleşmesi', icon: 'contract' },
    { key: 'returns', label: 'İade ve Değişim Koşulları', icon: 'keyboard_return' },
    { key: 'help', label: 'Destek / SSS', icon: 'help' },
  ]

  return (
    <AdminLayout
      title="Bilgi Sayfaları"
      subtitle="E-ticaret sitenizde yer alan kurumsal ve yasal sayfaların içeriklerini zengin metin editörüyle yönetin."
    >
      {loading ? (
        <div className="flex flex-col items-center justify-center py-24 bg-white rounded-3xl border border-zinc-200/80 shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
          <div className="w-10 h-10 border-4 border-zinc-200 border-t-[#df0000] rounded-full animate-spin mb-3" />
          <span className="text-sm text-zinc-400 font-medium">Sayfa içerikleri yükleniyor...</span>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-12">
          {/* Page Tabs Sidebar */}
          <div className="lg:col-span-3 space-y-1">
            <div className="text-[10px] font-extrabold text-zinc-400 uppercase tracking-widest px-4 mb-3">
              BİLGİ SAYFALARI
            </div>
            {pagesConfig.map((pg) => {
              const isActive = activePage === pg.key
              return (
                <button
                  key={pg.key}
                  type="button"
                  onClick={() => setActivePage(pg.key)}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-xs font-bold rounded-2xl transition-all duration-200 text-left border-l-4 active:scale-[0.98] ${
                    isActive
                      ? 'bg-[#df0000]/5 border-[#df0000] text-zinc-950 font-extrabold'
                      : 'border-transparent text-zinc-550 hover:bg-zinc-50 hover:text-zinc-900'
                  }`}
                >
                  <span className={`material-symbols-outlined text-[18px] transition-colors ${isActive ? 'text-[#df0000]' : 'text-zinc-400'}`}>
                    {pg.icon}
                  </span>
                  <span>{pg.label}</span>
                </button>
              )
            })}
          </div>

          {/* HTML Editor Area */}
          <div className="lg:col-span-9 space-y-4">
            <div className="border border-zinc-200/85 bg-white rounded-3xl p-6 shadow-[0_2px_8px_rgba(0,0,0,0.02),0_8px_24px_rgba(0,0,0,0.02)] space-y-5">
              <div className="flex justify-between items-center border-b border-zinc-150 pb-3.5">
                <span className="text-sm font-bold text-zinc-900 uppercase tracking-tight flex items-center gap-2">
                  <span className="material-symbols-outlined text-zinc-400">edit_note</span>
                  {pagesConfig.find((x) => x.key === activePage)?.label} Editörü
                </span>
                <span className="text-[10px] text-zinc-400 font-extrabold uppercase tracking-wider">ZENGİN METİN EDİTÖRÜ</span>
              </div>

              <div className="space-y-1 prose max-w-none">
                <RichTextEditor
                  key={activePage}
                  value={pages[activePage]?.contentHtml || ''}
                  onChange={(val) => {
                    setPages((prev) => ({
                      ...prev,
                      [activePage]: {
                        ...prev[activePage],
                        contentHtml: val,
                        key: activePage,
                        title: pagesConfig.find(x => x.key === activePage)?.label || ''
                      }
                    }))
                  }}
                />
              </div>

              <div className="flex justify-end gap-2 border-t border-zinc-150 pt-4.5">
                <Button 
                  variant="primary" 
                  loading={saving} 
                  onClick={save}
                  className="rounded-2xl bg-[#df0000] hover:bg-[#c00000] active:scale-[0.98] transition-all px-6 py-2.5"
                >
                  Değişiklikleri Kaydet
                </Button>
              </div>
            </div>

            {/* Quick HTML templates tip */}
            <div className="rounded-3xl bg-zinc-50 border border-zinc-200/80 p-5 flex gap-3.5 items-start shadow-sm">
              <div className="p-2 bg-zinc-100 rounded-2xl border border-zinc-200 text-[#df0000] flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-[20px] font-bold">lightbulb</span>
              </div>
              <div className="text-xs text-zinc-600 leading-relaxed">
                <p className="font-extrabold text-zinc-800 mb-1">Kullanım İpucu</p>
                Sayfa tasarımlarını zenginleştirmek için CKEditor zengin metin editörü üzerinden kalınlaştırma, eğik yazı (italic), bağlantı adresleri (link), maddeli veya numaralı listeler ve blok alıntılar oluşturabilirsiniz. Yaptığınız değişikliklerin ziyaretçilerinize yansıması için "Değişiklikleri Kaydet" butonuna basarak onaylamayı unutmayın.
              </div>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  )
}
