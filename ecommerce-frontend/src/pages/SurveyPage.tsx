import React, { useState, useEffect } from 'react'
import { useToast } from '../components/ui/ToastContext'

interface Question {
  id: string
  text: string
  type: string // "star" or "text"
  orderNo: number
}

export function SurveyPage() {
  const { showToast } = useToast()
  const [questions, setQuestions] = useState<Question[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  // Form states
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [hoveredStars, setHoveredStars] = useState<Record<string, number>>({})

  useEffect(() => {
    async function fetchQuestions() {
      try {
        const res = await fetch('/api/survey/questions')
        if (res.ok) {
          const json = await res.json()
          if (json?.success) {
            setQuestions(json.data || [])
            // Initialize answers
            const initialAnswers: Record<string, string> = {}
            json.data.forEach((q: Question) => {
              initialAnswers[q.id] = q.type === 'star' ? '5' : ''
            })
            setAnswers(initialAnswers)
          }
        }
      } catch (err) {
        showToast('Sorular yüklenemedi. Lütfen sayfayı yenileyin.', 'error')
      } finally {
        setLoading(false)
      }
    }
    fetchQuestions()
  }, [])

  const handleStarClick = (questionId: string, rating: number) => {
    setAnswers((prev) => ({ ...prev, [questionId]: String(rating) }))
  }

  const handleTextChange = (questionId: string, text: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: text }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !email.trim() || !phone.trim()) {
      showToast('Lütfen isim, e-posta ve telefon bilgilerinizi doldurun.', 'warning')
      return
    }

    setSubmitting(true)
    try {
      const detailedAnswers: Record<string, { text: string; type: string; value: string }> = {}
      questions.forEach((q) => {
        detailedAnswers[q.id] = {
          text: q.text,
          type: q.type,
          value: answers[q.id] || (q.type === 'star' ? '5' : '')
        }
      })

      const responsePayload = {
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
        answersJson: JSON.stringify(detailedAnswers),
      }

      const res = await fetch('/api/survey/responses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(responsePayload),
      })

      const json = await res.json()
      if (res.ok && json?.success) {
        setSubmitted(true)
        showToast(json.message || 'Anket başarıyla gönderildi.', 'success')
      } else {
        showToast(json?.message || 'Gönderilirken bir hata oluştu.', 'error')
      }
    } catch (err) {
      showToast('Bağlantı hatası oluştu.', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center">
        <div className="w-10 h-10 border-4 border-zinc-200 border-t-[#df0000] rounded-full animate-spin mb-4" />
        <span className="text-zinc-500 font-semibold text-xs">Memnuniyet Anketi Yükleniyor...</span>
      </div>
    )
  }

  if (submitted) {
    return (
      <div className="max-w-xl mx-auto my-12 px-6">
        <div className="bg-white rounded-3xl border border-zinc-200 shadow-2xl p-8 text-center space-y-6 animate-scale-in">
          <div className="inline-flex h-20 w-20 items-center justify-center rounded-full bg-emerald-50 text-emerald-500 animate-bounce">
            <span className="material-symbols-outlined text-[48px]">check_circle</span>
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-black text-zinc-900 uppercase tracking-wide">Katılımınız İçin Teşekkür Ederiz!</h2>
            <p className="text-sm text-zinc-550 leading-relaxed">
              Memnuniyet anketini başarıyla doldurdunuz. Değerli görüşleriniz, hizmet kalitemizi artırmak için özenle değerlendirilecektir.
            </p>
          </div>
          <div className="pt-4">
            <a
              href="/"
              className="inline-flex items-center justify-center px-6 py-3 rounded-2xl bg-zinc-900 hover:bg-zinc-800 text-white font-bold text-xs uppercase tracking-wider transition-all duration-200 active:scale-95"
            >
              Ana Sayfaya Dön
            </a>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto my-12 px-6">
      <div className="bg-white rounded-[32px] border border-zinc-200 shadow-2xl overflow-hidden flex flex-col">
        {/* Header decoration banner */}
        <div className="bg-gradient-to-r from-[#df0000] to-[#b00000] p-8 text-white relative">
          <div className="relative z-10 space-y-1.5">
            <div className="text-[10px] font-black tracking-widest uppercase text-white/80">Stilsoft Müşteri İlişkileri</div>
            <h2 className="text-2xl font-black uppercase tracking-tight">Memnuniyet Anketi</h2>
            <p className="text-xs text-white/70 font-semibold leading-relaxed max-w-lg">
              Sizlere daha iyi hizmet sunabilmemiz için lütfen aşağıdaki kısa anket sorularını cevaplandırın. Görüşleriniz bizim için çok değerlidir.
            </p>
          </div>
          <div className="absolute right-8 bottom-0 opacity-10 pointer-events-none select-none translate-y-4">
            <span className="material-symbols-outlined text-[140px]">rate_review</span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-8 space-y-8">
          {questions.length === 0 ? (
            <div className="text-center py-12 text-zinc-400 italic text-xs border border-dashed border-zinc-200 rounded-2xl">
              Aktif memnuniyet anketi sorusu bulunmamaktadır.
            </div>
          ) : (
            <div className="space-y-6">
              {questions.map((q, idx) => (
                <div key={q.id} className="p-5 bg-zinc-50 border border-zinc-200/60 rounded-2xl space-y-3">
                  <div className="flex gap-2">
                    <span className="text-xs font-black text-zinc-400 font-mono mt-0.5">Q{idx + 1}.</span>
                    <label className="text-xs font-bold text-zinc-800 leading-relaxed">{q.text}</label>
                  </div>

                  {q.type === 'star' ? (
                    <div className="flex items-center gap-1.5 pl-6">
                      {[1, 2, 3, 4, 5].map((star) => {
                        const currentVal = parseInt(answers[q.id] || '5')
                        const hoverVal = hoveredStars[q.id] ?? 0
                        const isFilled = star <= (hoverVal || currentVal)
                        return (
                          <button
                            key={star}
                            type="button"
                            onMouseEnter={() => setHoveredStars((prev) => ({ ...prev, [q.id]: star }))}
                            onMouseLeave={() => setHoveredStars((prev) => ({ ...prev, [q.id]: 0 }))}
                            onClick={() => handleStarClick(q.id, star)}
                            className="text-zinc-300 hover:scale-110 active:scale-90 transition-transform duration-100 flex items-center justify-center p-0.5"
                          >
                            <span
                              className="material-symbols-outlined text-[28px] text-amber-400"
                              style={{ fontVariationSettings: isFilled ? "'FILL' 1" : undefined }}
                            >
                              star
                            </span>
                          </button>
                        )
                      })}
                      <span className="text-[10px] font-black text-zinc-400 font-mono ml-2">
                        {answers[q.id] || '5'} / 5
                      </span>
                    </div>
                  ) : (
                    <div className="pl-6">
                      <textarea
                        required
                        value={answers[q.id] || ''}
                        onChange={(e) => handleTextChange(q.id, e.target.value)}
                        placeholder="Görüşünüzü buraya yazın..."
                        className="w-full min-h-[70px] p-3 text-xs border border-zinc-200 rounded-xl outline-none focus:ring-4 focus:ring-[#df0000]/10 focus:border-[#df0000] bg-white transition-all duration-200"
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* User details (Required) */}
          <div className="pt-6 border-t border-zinc-150 space-y-4">
            <h3 className="text-xs font-black text-zinc-400 uppercase tracking-widest flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px] text-zinc-400 font-black">person</span>
              İletişim & Kimlik Bilgileri
            </h3>
            
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wide">Ad Soyad *</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Örn: Ahmet Yılmaz"
                className="w-full rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5 text-xs text-zinc-800 placeholder-zinc-400 outline-none focus:ring-4 focus:ring-[#df0000]/10 focus:border-[#df0000] transition-all duration-200"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wide">E-posta Adresi *</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="ahmet@example.com"
                  className="w-full rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5 text-xs text-zinc-800 placeholder-zinc-400 outline-none focus:ring-4 focus:ring-[#df0000]/10 focus:border-[#df0000] transition-all duration-200"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wide">Telefon Numarası *</label>
                <input
                  type="tel"
                  required
                  maxLength={11}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 11))}
                  placeholder="05XXXXXXXXX"
                  className="w-full rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5 text-xs text-zinc-800 placeholder-zinc-400 outline-none focus:ring-4 focus:ring-[#df0000]/10 focus:border-[#df0000] transition-all duration-200"
                />
              </div>
            </div>
          </div>

          {/* Submit button */}
          <div className="pt-2">
            <button
              type="submit"
              disabled={submitting || questions.length === 0}
              className="w-full flex items-center justify-center gap-2 rounded-2xl bg-[#df0000] hover:bg-[#c00000] active:scale-[0.98] text-white font-bold text-xs uppercase tracking-wider py-3.5 shadow-lg shadow-[#df0000]/25 transition-all duration-200 disabled:opacity-50 disabled:pointer-events-none"
            >
              {submitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Gönderiliyor...
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-base font-black">send</span>
                  Anketi Gönder
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
