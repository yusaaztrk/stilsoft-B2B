import React from 'react'
import ActionDropdown from '../ActionDropdown'
import type { DataTableRowAction } from './types'

export function DataTableRowActions<TData>({
  actions,
  row
}: {
  actions: DataTableRowAction<TData>[]
  row: TData
}) {
  const visibleActions = actions.filter((a) => !a.hidden)
  if (visibleActions.length === 0) return null

  const items = visibleActions.map((a, idx) => ({
    key: a.key || `action_${idx}`,
    label: a.label,
    icon: a.icon,
    onClick: () => a.onClick(row),
    danger: a.danger,
    disabled: a.disabled,
    disabledReason: a.disabledReason
  }))

  return <ActionDropdown items={items} />
}
