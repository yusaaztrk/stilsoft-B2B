import { useEffect, useState, useMemo } from 'react'
import { AdminLayout } from '../components/admin/AdminLayout'
import { getAdminToken, readApiResponse } from '../lib/api'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { useToast } from '../components/ui/ToastContext'

interface Question {
  id: string
  text: string
  type: string // "star" or "text"
  orderNo: number
}

interface SurveyResponse {
  id: number
  submittedAt: string
  name: string
  email: string
  phone: string
  answersJson: string
}

const generateId = () => {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Math.random().toString(36).substring(2) + Date.now().toString(36)
}

export function AdminSurveyPage() {
  const { showToast } = useToast()
  const [activeTab, setActiveTab] = useState<'designer' | 'responses'>('designer')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  // Designer states
  const [questions, setQuestions] = useState<Question[]>([])
  const [newQuestionText, setNewQuestionText] = useState('')
  const [newQuestionType, setNewQuestionType] = useState('star')

  // Responses states
  const [responses, setResponses] = useState<SurveyResponse[]>([])
  const [allQuestions, setAllQuestions] = useState<Question[]>([])
  const [expandedResponseId, setExpandedResponseId] = useState<number | null>(null)

  const fetchQuestions = async () => {
    try {
      const res = await fetch('/api/survey/questions')
      if (res.ok) {
        const json = await res.json()
        if (json?.success) {
          setQuestions(json.data || [])
        }
      }
    } catch (err) {
      showToast('Sorular yüklenemedi.', 'error')
    }
  }

  const fetchResponses = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/survey/responses', {
        headers: {
          Authorization: `Bearer ${getAdminToken()}`,
        },
      })
      const json = await readApiResponse(res)
      if (res.ok && json?.success) {
        setResponses(json.data || [])
        setAllQuestions(json.allQuestions || [])
      }
    } catch (err) {
      showToast('Cevaplar yüklenemedi.', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void fetchQuestions()
  }, [])

  useEffect(() => {
    if (activeTab === 'responses') {
      void fetchResponses()
    }
  }, [activeTab])

  // Question editing handlers
  const handleAddQuestion = () => {
    const text = newQuestionText.trim()
    if (!text) {
      showToast('Lütfen soru metnini yazın.', 'warning')
      return
    }

    const newQ: Question = {
      id: generateId(),
      text,
      type: newQuestionType,
      orderNo: questions.length + 1,
    }

    setQuestions((prev) => [...prev, newQ])
    setNewQuestionText('')
  }

  const handleDeleteQuestion = (id: string) => {
    const updated = questions.filter((q) => q.id !== id).map((q, idx) => ({ ...q, orderNo: idx + 1 }))
    setQuestions(updated)
  }

  const handleUpdateQuestionText = (id: string, text: string) => {
    setQuestions((prev) =>
      prev.map((q) => (q.id === id ? { ...q, text } : q))
    )
  }


  const handleMoveUp = (idx: number) => {
    if (idx === 0) return
    const updated = [...questions]
    const temp = updated[idx]
    updated[idx] = updated[idx - 1]
    updated[idx - 1] = temp

    // Recalculate orderNo
    const reordered = updated.map((q, i) => ({ ...q, orderNo: i + 1 }))
    setQuestions(reordered)
  }

  const handleMoveDown = (idx: number) => {
    if (idx === questions.length - 1) return
    const updated = [...questions]
    const temp = updated[idx]
    updated[idx] = updated[idx + 1]
    updated[idx + 1] = temp

    // Recalculate orderNo
    const reordered = updated.map((q, i) => ({ ...q, orderNo: i + 1 }))
    setQuestions(reordered)
  }

  const handleSaveQuestions = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/admin/survey/questions', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getAdminToken()}`,
        },
        body: JSON.stringify(questions),
      })
      const json = await readApiResponse(res)
      if (res.ok && json?.success) {
        showToast('Memnuniyet anketi soruları başarıyla kaydedildi.', 'success')
        setQuestions(json.data || [])
      } else {
        showToast(json?.message || 'Kaydedilemedi.', 'error')
      }
    } catch (err) {
      showToast('Bağlantı hatası.', 'error')
    } finally {
      setSaving(false)
    }
  }

  // Parse response answers
  const parseAnswers = (answersJson: string): Record<string, string> => {
    try {
      const parsed = JSON.parse(answersJson)
      const result: Record<string, string> = {}
      Object.entries(parsed).forEach(([key, val]) => {
        if (val && typeof val === 'object' && 'value' in val) {
          result[key] = String((val as any).value || '')
        } else {
          result[key] = String(val || '')
        }
      })
      return result
    } catch {
      return {}
    }
  }

  // Calculation of statistics
  const stats = useMemo(() => {
    const totalSubmissions = responses.length
    if (totalSubmissions === 0) return { totalSubmissions, starAverages: {} }

    const starCounts: Record<string, { sum: number; count: number }> = {}
    responses.forEach((resp) => {
      const ansMap = parseAnswers(resp.answersJson)
      questions.forEach((q) => {
        if (q.type === 'star') {
          const val = parseInt(ansMap[q.id])
          if (!isNaN(val)) {
            starCounts[q.id] = starCounts[q.id] || { sum: 0, count: 0 }
            starCounts[q.id].sum += val
            starCounts[q.id].count += 1
          }
        }
      })
    })

    const starAverages: Record<string, number> = {}
    Object.entries(starCounts).forEach(([qId, data]) => {
      starAverages[qId] = data.count > 0 ? parseFloat((data.sum / data.count).toFixed(1)) : 0
    })

    return { totalSubmissions, starAverages }
  }, [responses, questions])

  return (
    <AdminLayout
      title="Memnuniyet Anketi Yönetimi"
      subtitle="Kullanıcılar için memnuniyet anketi soruları oluşturun ve gelen anket cevaplarını izleyin."
    >
      <div className="space-y-6">
        {/* Navigation Tabs */}
        <div className="flex gap-2 p-1 bg-zinc-200/60 rounded-xl w-fit">
          <button
            type="button"
            onClick={() => setActiveTab('designer')}
            className={`px-6 py-2.5 text-xs font-black rounded-lg transition-all ${
              activeTab === 'designer'
                ? 'bg-white text-zinc-900 shadow-sm'
                : 'text-zinc-550 hover:text-zinc-900'
            }`}
          >
            Anket Tasarımcısı
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('responses')}
            className={`px-6 py-2.5 text-xs font-black rounded-lg transition-all ${
              activeTab === 'responses'
                ? 'bg-white text-zinc-900 shadow-sm'
                : 'text-zinc-550 hover:text-zinc-900'
            }`}
          >
            Anket Cevapları ({responses.length})
          </button>
        </div>

        {/* TAB 1: DESIGNER */}
        {activeTab === 'designer' && (
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Left Box: Add Question */}
            <div className="lg:col-span-1 bg-white border border-zinc-200 rounded-3xl p-6 shadow-sm h-fit space-y-4">
              <h3 className="text-xs font-black text-zinc-400 uppercase tracking-widest border-b border-zinc-100 pb-3">
                Yeni Soru Ekle
              </h3>
              
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wide">Soru Metni</label>
                <textarea
                  value={newQuestionText}
                  onChange={(e) => setNewQuestionText(e.target.value)}
                  placeholder="Müşteriye sorulacak soru metni..."
                  className="w-full min-h-[90px] p-3 text-xs border border-zinc-200 rounded-xl outline-none focus:ring-4 focus:ring-[#df0000]/10 focus:border-[#df0000] bg-white transition-all"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wide">Cevap Tipi</label>
                <select
                  value={newQuestionType}
                  onChange={(e) => setNewQuestionType(e.target.value)}
                  className="w-full p-2.5 border border-zinc-200 rounded-xl bg-white outline-none focus:ring-4 focus:ring-[#df0000]/10 focus:border-[#df0000] text-xs font-bold transition-all"
                >
                  <option value="star">Yıldız Puanlama (1 - 5)</option>
                  <option value="text">Yazılı Cevap Satırı</option>
                </select>
              </div>

              <Button
                type="button"
                variant="primary"
                onClick={handleAddQuestion}
                className="w-full text-center py-2.5 font-bold uppercase tracking-wider bg-[#df0000] hover:bg-[#c00000] shadow-md shadow-[#df0000]/10"
                icon="add"
              >
                Soru Ekle
              </Button>
            </div>

            {/* Right Box: Current Questions */}
            <div className="lg:col-span-2 bg-white border border-zinc-200 rounded-3xl p-6 shadow-sm flex flex-col min-h-[500px]">
              <div className="flex items-center justify-between border-b border-zinc-100 pb-3 mb-4">
                <h3 className="text-sm font-extrabold text-zinc-900">Anket Soruları</h3>
                <span className="text-[10px] font-black text-zinc-400 font-mono">Toplam {questions.length} Soru</span>
              </div>

              <div className="flex-1 space-y-3 overflow-y-auto max-h-[380px] pr-1 custom-scrollbar">
                {questions.length === 0 ? (
                  <div className="text-center py-16 text-zinc-400 italic text-xs border border-dashed border-zinc-200 rounded-2xl">
                    Ankete henüz soru eklenmedi. Sol panelden soru ekleyebilirsiniz.
                  </div>
                ) : (
                  questions.map((q, idx) => (
                    <div
                      key={q.id}
                      className="p-4 rounded-2xl border border-zinc-200 bg-zinc-55/10 flex items-center justify-between gap-4 group"
                    >
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-extrabold text-zinc-400 font-mono">Soru #{idx + 1}</span>
                          <span
                            className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider ${
                              q.type === 'star' ? 'bg-amber-50 text-amber-600 border border-amber-100' : 'bg-blue-50 text-blue-600 border border-blue-100'
                            }`}
                          >
                            {q.type === 'star' ? '⭐ Yıldız' : '📝 Yazılı'}
                          </span>
                        </div>
                        <Input
                          value={q.text}
                          onChange={(e) => handleUpdateQuestionText(q.id, e.target.value)}
                          className="font-bold text-zinc-850"
                        />
                      </div>

                      {/* Controls */}
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() => handleMoveUp(idx)}
                          className="w-8 h-8 rounded-lg hover:bg-zinc-100 flex items-center justify-center text-zinc-500 disabled:opacity-30 transition-colors"
                          title="Yukarı Taşı"
                        >
                          <span className="material-symbols-outlined text-[18px]">arrow_upward</span>
                        </button>
                        <button
                          type="button"
                          disabled={idx === questions.length - 1}
                          onClick={() => handleMoveDown(idx)}
                          className="w-8 h-8 rounded-lg hover:bg-zinc-100 flex items-center justify-center text-zinc-500 disabled:opacity-30 transition-colors"
                          title="Aşağı Taşı"
                        >
                          <span className="material-symbols-outlined text-[18px]">arrow_downward</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteQuestion(q.id)}
                          className="w-8 h-8 rounded-lg hover:bg-rose-50 text-rose-500 flex items-center justify-center transition-colors"
                          title="Soruyu Sil"
                        >
                          <span className="material-symbols-outlined text-[18px]">delete</span>
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {questions.length > 0 && (
                <div className="flex justify-end pt-4 border-t border-zinc-100 mt-4 bg-white">
                  <Button
                    variant="primary"
                    loading={saving}
                    onClick={handleSaveQuestions}
                    className="rounded-xl bg-[#df0000] hover:bg-[#c00000] transition-all px-8 py-2.5 font-bold uppercase tracking-wider text-xs shadow-md shadow-[#df0000]/15"
                    icon="check"
                  >
                    Soruları Kaydet
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: RESPONSES */}
        {activeTab === 'responses' && (
          <div className="space-y-6 animate-in fade-in duration-200">
            {/* Stats Overview */}
            {responses.length > 0 && (
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="bg-white border border-zinc-200 rounded-3xl p-5 shadow-sm flex items-center gap-4">
                  <div className="p-3 bg-zinc-50 border border-zinc-150 rounded-2xl text-zinc-600">
                    <span className="material-symbols-outlined text-[24px]">ballot</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-zinc-400 block font-bold uppercase tracking-wider">Toplam Katılım</span>
                    <span className="text-xl font-black text-zinc-900">{stats.totalSubmissions} Yanıt</span>
                  </div>
                </div>

                {/* Star averages summary */}
                {questions.filter((q) => q.type === 'star').map((q) => {
                  const avg = stats.starAverages[q.id] ?? 0
                  return (
                    <div key={q.id} className="bg-white border border-zinc-200 rounded-3xl p-5 shadow-sm flex items-center gap-4">
                      <div className="p-3 bg-amber-50 border border-amber-100 rounded-2xl text-amber-500">
                        <span className="material-symbols-outlined text-[24px]" style={{ fontVariationSettings: "'FILL' 1" }}>star</span>
                      </div>
                      <div className="min-w-0">
                        <span className="text-[10px] text-zinc-400 block font-bold uppercase tracking-wider truncate" title={q.text}>
                          {q.text}
                        </span>
                        <span className="text-xl font-black text-zinc-900">{avg} / 5</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* List of responses */}
            <div className="bg-white border border-zinc-200 rounded-3xl p-6 shadow-sm min-h-[400px]">
              <div className="flex items-center justify-between border-b border-zinc-100 pb-3 mb-4">
                <h3 className="text-sm font-extrabold text-zinc-900">Müşteri Yanıtları</h3>
                <span className="text-[10px] font-black text-zinc-400 font-mono">Toplam {responses.length} Sonuç</span>
              </div>

              {loading ? (
                <div className="flex flex-col items-center justify-center py-20">
                  <div className="w-8 h-8 border-4 border-zinc-200 border-t-[#df0000] rounded-full animate-spin mb-3" />
                  <span className="text-xs text-zinc-400 font-medium">Cevaplar yükleniyor...</span>
                </div>
              ) : responses.length === 0 ? (
                <div className="text-center py-16 text-zinc-400 italic text-xs border border-dashed border-zinc-200 rounded-2xl">
                  Henüz anket dolduran bir kullanıcı olmamış.
                </div>
              ) : (
                <div className="space-y-4">
                  {responses.map((resp) => {
                    const isExpanded = expandedResponseId === resp.id
                    const date = new Date(resp.submittedAt).toLocaleDateString('tr-TR', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })

                    return (
                      <div
                        key={resp.id}
                        className={`border rounded-3xl transition-all ${
                          isExpanded ? 'border-zinc-300 bg-zinc-50/30' : 'border-zinc-200 hover:border-zinc-300 bg-white'
                        }`}
                      >
                        {/* Summary Header */}
                        <div
                          onClick={() => setExpandedResponseId(isExpanded ? null : resp.id)}
                          className="p-5 flex items-center justify-between gap-4 cursor-pointer select-none"
                        >
                          <div className="min-w-0 flex-1 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6">
                            <div>
                              <div className="text-xs font-black text-zinc-900">{resp.name}</div>
                              <div className="text-[10px] text-zinc-500 font-medium font-mono mt-0.5">{resp.email}</div>
                            </div>
                            <div className="hidden sm:block w-px h-6 bg-zinc-200" />
                            <div>
                              <div className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider">Telefon</div>
                              <div className="text-xs font-extrabold text-zinc-700 font-mono mt-0.5">{resp.phone}</div>
                            </div>
                          </div>

                          <div className="flex items-center gap-4">
                            <span className="text-[10px] text-zinc-400 font-semibold font-mono">{date}</span>
                            <span className="material-symbols-outlined text-zinc-400 text-[18px]">
                              {isExpanded ? 'expand_less' : 'expand_more'}
                            </span>
                          </div>
                        </div>

                        {/* Expanded Details */}
                        {isExpanded && (
                          <div className="px-5 pb-5 pt-1 border-t border-zinc-150/60 space-y-4 animate-fade-in">
                            <h4 className="text-[9px] font-black text-zinc-400 uppercase tracking-widest mb-2">
                              Verilen Cevaplar
                            </h4>
                            <div className="space-y-3">
                              {(() => {
                                let parsedJson: any = {}
                                try {
                                  parsedJson = JSON.parse(resp.answersJson)
                                } catch {}

                                const list: Array<{ id: string; text: string; type: string; value: string }> = []

                                // 1. Current active questions first
                                questions.forEach((q) => {
                                  const entry = parsedJson[q.id]
                                  let val = ''
                                  if (entry && typeof entry === 'object' && 'value' in entry) {
                                    val = String(entry.value || '')
                                  } else if (entry !== undefined) {
                                    val = String(entry)
                                  }
                                  list.push({
                                    id: q.id,
                                    text: q.text,
                                    type: q.type,
                                    value: val,
                                  })
                                })

                                // 2. Questions deleted from designer but present in response
                                Object.keys(parsedJson).forEach((key) => {
                                  const alreadyAdded = list.some((item) => item.id === key)
                                  if (!alreadyAdded) {
                                    const entry = parsedJson[key]
                                    const matchedQ = allQuestions.find((q) => q.id === key)
                                    if (entry && typeof entry === 'object') {
                                      list.push({
                                        id: key,
                                        text: entry.text || matchedQ?.text || 'Silinmiş Soru',
                                        type: entry.type || matchedQ?.type || 'text',
                                        value: String(entry.value || ''),
                                      })
                                    } else if (entry !== undefined) {
                                      list.push({
                                        id: key,
                                        text: matchedQ?.text || 'Silinmiş Soru',
                                        type: matchedQ?.type || 'text',
                                        value: String(entry),
                                      })
                                    }
                                  }
                                })

                                return list.map((item, idx) => (
                                  <div key={item.id} className="p-3.5 bg-white border border-zinc-200/60 rounded-xl space-y-1.5">
                                    <div className="flex gap-2">
                                      <span className="text-[10px] font-extrabold text-zinc-400 font-mono mt-0.5">#{idx + 1}</span>
                                      <div className="text-xs font-extrabold text-zinc-800 leading-normal">{item.text}</div>
                                    </div>
                                    <div className="pl-6">
                                      {item.type === 'star' ? (
                                        <div className="flex items-center gap-0.5">
                                          {[1, 2, 3, 4, 5].map((star) => (
                                            <span
                                              key={star}
                                              className="material-symbols-outlined text-[18px] text-amber-400"
                                              style={{ fontVariationSettings: star <= parseInt(item.value) ? "'FILL' 1" : undefined }}
                                            >
                                              star
                                            </span>
                                          ))}
                                          <span className="text-[10px] font-bold text-zinc-500 font-mono ml-2">({item.value || '0'} / 5)</span>
                                        </div>
                                      ) : (
                                        <p className="text-xs text-zinc-650 font-medium leading-relaxed bg-zinc-50 p-2.5 rounded-lg border border-zinc-100">
                                          {item.value || <span className="italic text-zinc-400">Cevap verilmedi.</span>}
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                ))
                              })()}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  )
}
