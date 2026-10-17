'use client'

import { useState } from 'react'
import { defaultFaqs, type FaqItem } from '@/lib/faqs'
export type { FaqItem }

export default function FaqAccordion({ items = defaultFaqs }: { items?: FaqItem[] }) {
  const [openIdx, setOpenIdx] = useState<number | null>(0)

  const toggle = (idx: number) => {
    setOpenIdx((prev) => (prev === idx ? null : idx))
  }

  return (
    <section className="faq-section" aria-label="Sıkça Sorulan Sorular">
      <div className="wrap">
        <div className="faq-head">
          <span className="section-badge">MERAK EDİLENLER</span>
          <h2>Sıkça Sorulan Sorular</h2>
          <p className="section-sub">
            KKTC teslimatı, kurulum, garanti ve ödeme süreçleri hakkında en çok sorulan soruların yanıtları.
          </p>
        </div>

        <div className="faq-list">
          {items.map((item, idx) => {
            const isOpen = openIdx === idx

            return (
              <div key={idx} className={`faq-item ${isOpen ? 'open' : ''}`}>
                <button
                  type="button"
                  className="faq-question"
                  aria-expanded={isOpen}
                  onClick={() => toggle(idx)}
                >
                  <span className="faq-q-text">{item.question}</span>
                  <span className="faq-toggle-icon" aria-hidden="true">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      {isOpen ? (
                        <line x1="5" y1="12" x2="19" y2="12" />
                      ) : (
                        <>
                          <line x1="12" y1="5" x2="12" y2="19" />
                          <line x1="5" y1="12" x2="19" y2="12" />
                        </>
                      )}
                    </svg>
                  </span>
                </button>

                <div className="faq-answer-wrap">
                  <div className="faq-answer-inner">
                    <p>{item.answer}</p>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
