import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'

export type Dealer = {
  code: string
  label: string
}

type DealerContextValue = {
  dealer: Dealer | null
  setDealer: (dealer: Dealer | null) => void
}

const STORAGE_KEY = 'selected_dealer_v1'

const DealerContext = createContext<DealerContextValue | null>(null)

function safeParse(json: string | null): Dealer | null {
  if (!json) return null
  try {
    const parsed = JSON.parse(json)
    const code = String(parsed?.code ?? '').trim()
    const label = String(parsed?.label ?? '').trim()
    if (!code) return null
    return { code, label }
  } catch {
    return null
  }
}

export function DealerProvider({ children }: { children: React.ReactNode }) {
  const [dealer, setDealerState] = useState<Dealer | null>(() => safeParse(localStorage.getItem(STORAGE_KEY)))

  useEffect(() => {
    if (!dealer) {
      localStorage.removeItem(STORAGE_KEY)
      return
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(dealer))
  }, [dealer])

  const value = useMemo<DealerContextValue>(() => ({ dealer, setDealer: setDealerState }), [dealer])

  return <DealerContext.Provider value={value}>{children}</DealerContext.Provider>
}

export function useDealer() {
  const ctx = useContext(DealerContext)
  if (!ctx) throw new Error('useDealer must be used within DealerProvider')
  return ctx
}
