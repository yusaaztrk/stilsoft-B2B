import React from 'react'
import ReportPrintViewer from './report-viewer/ReportPrintViewer'

interface ReceiptPreviewModalProps {
  isOpen: boolean
  onClose: () => void
  record: any | null
  tasks?: any[]
  forcePrintBeforeClose?: boolean
}

export default function ReceiptPreviewModal({
  isOpen,
  onClose,
  record,
  forcePrintBeforeClose,
}: ReceiptPreviewModalProps) {
  return (
    <ReportPrintViewer
      isOpen={isOpen}
      onClose={onClose}
      record={record}
      forcePrintBeforeClose={forcePrintBeforeClose}
    />
  )
}
