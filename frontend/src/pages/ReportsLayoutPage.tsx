import React from 'react'
import { Outlet, useOutletContext } from 'react-router-dom'

type LayoutContext = {
  activeMenuId: string
  activeTabId?: string
  setActiveTabId?: (id?: string) => void
}

export default function ReportsLayoutPage() {
  const ctx = useOutletContext<LayoutContext | undefined>()
  return <Outlet context={ctx} />
}
