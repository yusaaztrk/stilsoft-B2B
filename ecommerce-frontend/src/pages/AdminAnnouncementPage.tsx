import { useEffect, useState, useRef, useMemo } from 'react'
import { AdminLayout } from '../components/admin/AdminLayout'
import { getAdminToken, readApiResponse } from '../lib/api'
import { Button } from '../components/ui/Button'
import { useToast } from '../components/ui/ToastContext'

interface AnnouncementItem {
  id: string
  contentHtml: string
  bgColor: string
  textColor: string
  isActive: boolean
  link: string
  order: number
}

type StoreDesign = {
  announcementHtml: string
  announcementBgColor: string
  announcementTextColor: string
  announcementActive: boolean
  announcementLink: string
  announcements?: AnnouncementItem[]
  [key: string]: any
}

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

  useEffect(() => {
    const editor = editorInstanceRef.current
    if (editor && value !== lastValueRef.current) {
      lastValueRef.current = value
      editor.setData(value)
    }
  }, [value])

  if (usePlainFallback) {
    return (
      <div className="border border-zinc-200/80 rounded-2xl overflow-hidden min-h-[250px] bg-white shadow-sm focus-within:ring-4 focus-within:ring-[#df0000]/5 focus-within:border-[#df0000] transition-all duration-200 flex flex-col">
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
          placeholder="Duyuru içeriğini buraya girin (HTML etiketleri kullanabilirsiniz)..."
          className="flex-1 w-full min-h-[190px] p-4 text-xs outline-none resize-none font-semibold text-zinc-700"
        />
      </div>
    )
  }

  return (
    <div className="border border-zinc-200/80 rounded-2xl overflow-hidden min-h-[250px] bg-white shadow-sm focus-within:ring-4 focus-within:ring-[#df0000]/5 focus-within:border-[#df0000] transition-all duration-200">
      {!loaded && (
        <div className="flex flex-col items-center justify-center p-16 text-zinc-400 text-xs gap-3">
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

const generateId = () => {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Math.random().toString(36).substring(2) + Date.now().toString(36)
}

export function AdminAnnouncementPage() {
  const { showToast } = useToast()
  const [design, setDesign] = useState<StoreDesign>({
    announcementHtml: '<p>Stilsoft Teknoloji Marketi Kıbrıs\'ta Hizmetinizde! Özel indirimli ürünleri kaçırmayın.</p>',
    announcementBgColor: '#D32F2F',
    announcementTextColor: '#FFFFFF',
    announcementActive: true,
    announcementLink: '',
    announcements: [],
  })
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [selectedAnnId, setSelectedAnnId] = useState<string | null>(null)

  const announcementsList = useMemo(() => {
    const list = design.announcements || []
    return [...list].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  }, [design.announcements])

  const selectedAnnouncement = useMemo(() => {
    return announcementsList.find((a) => a.id === selectedAnnId) || null
  }, [announcementsList, selectedAnnId])

  const fetchDesign = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/store-design')
      const json = await readApiResponse(res)
      if (res.ok && json?.data) {
        const data = json.data
        const loadedAnnouncements = Array.isArray(data.announcements) ? data.announcements : []
        
        // If there are no announcements in the list but legacy announcement exists, migrate it
        if (loadedAnnouncements.length === 0 && data.announcementHtml) {
          loadedAnnouncements.push({
            id: generateId(),
            contentHtml: data.announcementHtml,
            bgColor: data.announcementBgColor || '#D32F2F',
            textColor: data.announcementTextColor || '#FFFFFF',
            isActive: data.announcementActive ?? true,
            link: data.announcementLink || '',
            order: 0,
          })
        }

        setDesign({
          ...data,
          announcements: loadedAnnouncements,
        })

        if (loadedAnnouncements.length > 0) {
          setSelectedAnnId(loadedAnnouncements[0].id)
        }
      }
    } catch (err) {
      showToast('Tasarım ayarları yüklenemedi.', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchDesign()
  }, [])

  const save = async (updatedAnnouncements: AnnouncementItem[]) => {
    setSaving(true)
    try {
      // Sync legacy properties with the first active announcement
      const activeList = updatedAnnouncements.filter((a) => a.isActive)
      let legacyHtml = design.announcementHtml
      let legacyBg = design.announcementBgColor
      let legacyText = design.announcementTextColor
      let legacyLink = design.announcementLink
      let legacyActive = design.announcementActive

      if (activeList.length > 0) {
        legacyHtml = activeList[0].contentHtml
        legacyBg = activeList[0].bgColor
        legacyText = activeList[0].textColor
        legacyLink = activeList[0].link
        legacyActive = true
      } else {
        legacyActive = false
      }

      const payload = {
        ...design,
        announcements: updatedAnnouncements,
        announcementHtml: legacyHtml,
        announcementBgColor: legacyBg,
        announcementTextColor: legacyText,
        announcementLink: legacyLink,
        announcementActive: legacyActive,
      }

      const res = await fetch('/api/store-design', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getAdminToken()}`,
        },
        body: JSON.stringify(payload),
      })
      const json = await readApiResponse(res)
      if (!res.ok || !json?.success) throw new Error(json?.message || 'Kaydedilemedi')
      
      setDesign(payload)
      showToast('Duyuru çubuğu başarıyla kaydedildi.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Kaydedilemedi', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleAddNew = () => {
    const newAnn: AnnouncementItem = {
      id: generateId(),
      contentHtml: '<p>Yeni duyuru metni...</p>',
      bgColor: '#D32F2F',
      textColor: '#FFFFFF',
      isActive: true,
      link: '',
      order: announcementsList.length,
    }
    const newList = [...announcementsList, newAnn]
    setDesign((prev) => ({ ...prev, announcements: newList }))
    setSelectedAnnId(newAnn.id)
    void save(newList)
  }

  const handleDelete = (id: string) => {
    const newList = announcementsList.filter((a) => a.id !== id)
    setDesign((prev) => ({ ...prev, announcements: newList }))
    
    if (selectedAnnId === id) {
      setSelectedAnnId(newList.length > 0 ? newList[0].id : null)
    }
    
    void save(newList)
  }

  const handleUpdateSelected = (key: keyof AnnouncementItem, value: any) => {
    if (!selectedAnnId) return
    const newList = announcementsList.map((a) => {
      if (a.id === selectedAnnId) {
        return { ...a, [key]: value }
      }
      return a
    })
    setDesign((prev) => ({ ...prev, announcements: newList }))
  }

  const handleSaveAll = () => {
    void save(announcementsList)
  }

  return (
    <AdminLayout
      title="Duyuru Çubuğu Yönetimi"
      subtitle="E-ticaret sitenizin en üstünde yer alan ve sağa doğru kayan duyuruları yönetin."
    >
      {loading ? (
        <div className="flex flex-col items-center justify-center py-24 bg-white rounded-3xl border border-zinc-200/80 shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
          <div className="w-10 h-10 border-4 border-zinc-200 border-t-[#df0000] rounded-full animate-spin mb-3" />
          <span className="text-sm text-zinc-400 font-medium">Ayarlar yükleniyor...</span>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Live Preview Block */}
          {announcementsList.filter((a) => a.isActive).length > 0 && (
            <div className="border border-zinc-200 bg-white rounded-3xl p-6 shadow-sm">
              <h3 className="text-xs font-black text-zinc-400 uppercase tracking-widest mb-4">Canlı Önizleme (Kayan Bar)</h3>
              <div className="border border-zinc-150 rounded-2xl overflow-hidden bg-zinc-50 p-4">
                <div 
                  className="relative h-10 overflow-hidden w-full flex items-center rounded-xl bg-zinc-900"
                >
                  <div 
                    className="absolute whitespace-nowrap text-sm font-semibold select-none flex items-center gap-2 marquee-inner"
                    style={{
                      left: 0,
                      animation: 'preview-marquee-ltr 15s linear infinite',
                    }}
                    dangerouslySetInnerHTML={{ 
                      __html: announcementsList.filter((a) => a.isActive).map((a) => {
                        return `<span style="color: ${a.textColor}; display: inline-flex; align-items: center;">${a.contentHtml}</span>`
                      }).join(' <span style="margin: 0 2rem; opacity: 0.6; color: #FFFFFF; display: inline-block;">-</span> ')
                    }}
                  />
                </div>
              </div>
              {/* Inline keyframe definition for preview scrolling */}
              <style dangerouslySetInnerHTML={{ __html: `
                @keyframes preview-marquee-ltr {
                  0% { transform: translate3d(-100%, 0, 0); }
                  100% { transform: translate3d(100vw, 0, 0); }
                }
                .marquee-inner p, .marquee-inner div {
                  display: inline !important;
                  margin: 0 !important;
                }
              `}} />
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-3">
            {/* Left Column: Announcements List */}
            <div className="lg:col-span-1 border border-zinc-200 bg-white rounded-3xl p-6 shadow-sm flex flex-col h-[520px]">
              <div className="flex items-center justify-between border-b border-zinc-100 pb-3 mb-4">
                <h3 className="text-sm font-extrabold text-zinc-900">Duyuru Listesi</h3>
                <Button variant="outline" size="sm" onClick={handleAddNew} icon="add">
                  Yeni Ekle
                </Button>
              </div>

              <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                {announcementsList.length === 0 ? (
                  <div className="text-center py-12 text-zinc-400 text-xs italic">
                    Kayıtlı duyuru bulunmamaktadır.
                  </div>
                ) : (
                  announcementsList.map((ann, idx) => (
                    <div
                      key={ann.id}
                      onClick={() => setSelectedAnnId(ann.id)}
                      className={`p-3.5 rounded-2xl border transition-all cursor-pointer relative group flex flex-col gap-2 ${
                        selectedAnnId === ann.id
                          ? 'border-[#df0000] bg-rose-50/10'
                          : 'border-zinc-200 hover:border-zinc-300 bg-white'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-zinc-400 font-mono">Duyuru #{idx + 1}</span>
                        <div className="flex items-center gap-2">
                          <span className={`inline-block w-2.5 h-2.5 rounded-full ${ann.isActive ? 'bg-green-500' : 'bg-zinc-300'}`} title={ann.isActive ? 'Aktif' : 'Pasif'} />
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleDelete(ann.id)
                            }}
                            className="text-zinc-400 hover:text-red-600 p-0.5 rounded transition opacity-0 group-hover:opacity-100"
                            title="Sil"
                          >
                            <span className="material-symbols-outlined text-[16px]">delete</span>
                          </button>
                        </div>
                      </div>
                      
                      <div 
                        className="text-xs text-zinc-650 truncate max-w-[200px]"
                        dangerouslySetInnerHTML={{ __html: ann.contentHtml }}
                      />

                      <div className="flex items-center gap-1.5 text-[9px] font-bold text-zinc-500 font-mono mt-1">
                        <span className="w-3.5 h-3.5 rounded border border-zinc-200" style={{ backgroundColor: ann.bgColor }} />
                        <span>Arka Plan</span>
                        <span className="w-3.5 h-3.5 rounded border border-zinc-200 ml-2" style={{ backgroundColor: ann.textColor }} />
                        <span>Yazı</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Right Column: Edit Form */}
            <div className="lg:col-span-2 border border-zinc-200 bg-white rounded-3xl p-6 shadow-sm flex flex-col h-[520px]">
              {selectedAnnouncement ? (
                <div className="flex flex-col h-full space-y-4">
                  <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
                    <h3 className="text-sm font-extrabold text-zinc-900 flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-zinc-400">edit_note</span>
                      Duyuru Düzenle
                    </h3>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-zinc-700">Aktif</span>
                      <label className="relative inline-flex items-center cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={selectedAnnouncement.isActive}
                          onChange={(e) => handleUpdateSelected('isActive', e.target.checked)}
                          className="sr-only peer"
                        />
                        <div className="w-9 h-5 bg-zinc-250 rounded-full peer peer-focus:ring-2 peer-focus:ring-primary/20 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
                      </label>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-zinc-650">Arka Plan Rengi</label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={selectedAnnouncement.bgColor}
                          onChange={(e) => handleUpdateSelected('bgColor', e.target.value)}
                          className="h-9 flex-1 rounded-xl border border-zinc-200 px-3 outline-none focus:border-primary text-xs font-mono"
                        />
                        <input
                          type="color"
                          value={selectedAnnouncement.bgColor}
                          onChange={(e) => handleUpdateSelected('bgColor', e.target.value)}
                          className="h-9 w-10 rounded-xl border border-zinc-200 p-0.5 bg-white cursor-pointer"
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-bold text-zinc-655">Yazı Rengi</label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={selectedAnnouncement.textColor}
                          onChange={(e) => handleUpdateSelected('textColor', e.target.value)}
                          className="h-9 flex-1 rounded-xl border border-zinc-200 px-3 outline-none focus:border-primary text-xs font-mono"
                        />
                        <input
                          type="color"
                          value={selectedAnnouncement.textColor}
                          onChange={(e) => handleUpdateSelected('textColor', e.target.value)}
                          className="h-9 w-10 rounded-xl border border-zinc-200 p-0.5 bg-white cursor-pointer"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-zinc-650">Yönlendirme Linki (Opsiyonel)</label>
                      <input
                        type="text"
                        placeholder="Örn: /kampanyalar veya https://site.com"
                        value={selectedAnnouncement.link}
                        onChange={(e) => handleUpdateSelected('link', e.target.value)}
                        className="h-9 w-full rounded-xl border border-zinc-200 px-3 outline-none focus:border-primary text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-zinc-650">Görüntüleme Sırası</label>
                      <input
                        type="number"
                        min="0"
                        placeholder="Örn: 1"
                        value={selectedAnnouncement.order ?? 0}
                        onChange={(e) => handleUpdateSelected('order', Math.max(0, parseInt(e.target.value) || 0))}
                        className="h-9 w-full rounded-xl border border-zinc-200 px-3 outline-none focus:border-primary text-xs"
                      />
                    </div>
                  </div>

                  <div className="flex-1 overflow-hidden flex flex-col">
                    <label className="text-xs font-bold text-zinc-650 mb-1">Duyuru İçeriği</label>
                    <div className="flex-1 overflow-y-auto min-h-0">
                      <RichTextEditor
                        key={selectedAnnId}
                        value={selectedAnnouncement.contentHtml}
                        onChange={(val) => handleUpdateSelected('contentHtml', val)}
                      />
                    </div>
                  </div>

                  <div className="flex justify-end pt-3 border-t border-zinc-100 bg-white">
                    <Button
                      variant="primary"
                      loading={saving}
                      onClick={handleSaveAll}
                      className="rounded-xl bg-[#df0000] hover:bg-[#c00000] active:scale-[0.98] transition-all px-6 py-2 font-bold text-xs shadow-md"
                    >
                      Duyuruları Kaydet
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-zinc-400 text-xs italic p-12 text-center bg-zinc-50 rounded-2xl border border-dashed border-zinc-200">
                  <span className="material-symbols-outlined text-[32px] text-zinc-300 mb-2">edit_note</span>
                  <span>Sol listeden düzenlemek için bir duyuru seçin veya yeni bir tane ekleyin.</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  )
}
