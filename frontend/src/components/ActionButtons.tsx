import React from 'react'

type Props = {
  status: 'teminat' | 'beklemede' | 'none'
}

export default function ActionButtons({ status }: Props) {
  if (status === 'teminat') {
    return <button className="btn-success text-xs px-3 py-1">Teminat</button>
  }

  if (status === 'beklemede') {
    return <button className="btn-warning text-xs px-3 py-1">Beklemede</button>
  }

  return (
    <div className="flex items-center gap-3">
      <button type="button" className="text-red-600 hover:text-red-700 hover:underline text-sm font-medium">
        Sil
      </button>
    </div>
  )
}
