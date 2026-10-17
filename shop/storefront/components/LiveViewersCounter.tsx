'use client'

import { useEffect, useState } from 'react'

export default function LiveViewersCounter({ stockCode }: { stockCode: string }) {
  // Deterministic initial number based on product stockCode hash (between 9 and 24)
  const getInitialCount = (code: string) => {
    let hash = 0
    for (let i = 0; i < code.length; i++) {
      hash = (hash << 5) - hash + code.charCodeAt(i)
      hash |= 0
    }
    return 9 + (Math.abs(hash) % 16)
  }

  const [count, setCount] = useState<number>(() => getInitialCount(stockCode))

  useEffect(() => {
    // Subtle realistic fluctuation every 7 to 12 seconds (-2 to +3)
    const interval = setInterval(() => {
      setCount((prev) => {
        const delta = Math.floor(Math.random() * 5) - 2 // -2, -1, 0, 1, 2
        let next = prev + delta
        if (next < 6) next = 7 + Math.floor(Math.random() * 4)
        if (next > 38) next = 32 - Math.floor(Math.random() * 4)
        return next
      })
    }, 8500)

    return () => clearInterval(interval)
  }, [stockCode])

  return (
    <div className="live-viewers-badge" aria-live="polite">
      <span className="live-pulse-ring">
        <span className="live-pulse-dot" />
      </span>
      <span className="live-viewers-text">
        Şu anda bu ürünü <strong>{count} kişi</strong> inceliyor
      </span>
    </div>
  )
}
