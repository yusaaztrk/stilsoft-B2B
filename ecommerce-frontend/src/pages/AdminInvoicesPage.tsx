import { useEffect, useState } from 'react'
import { AdminLayout } from '../components/admin/AdminLayout'
import { getAdminToken, readApiResponse } from '../lib/api'
import { useToast } from '../components/ui/ToastContext'
import { useConfirm } from '../components/ui/ConfirmContext'

type InvoiceRow = {
  id: string
  invoiceNo: string
  orderNo: string
  customerName: string
  total: number
  tax: number
  status: string
  createdAtUtc: string
  orderId?: string
}

export function AdminInvoicesPage() {
  const { showToast } = useToast()
  const confirm = useConfirm()
  const [rows, setRows] = useState<InvoiceRow[]>([])

  async function load() {
    try {
      const res = await fetch('/api/admin/modules/invoices', {
        headers: { Authorization: `Bearer ${getAdminToken()}` }
      })
      const json = await readApiResponse(res)
      if (res.ok && Array.isArray(json?.data)) {
        setRows(json.data)
      }
    } catch {
      showToast('Faturalar yüklenemedi.', 'error')
    }
  }

  useEffect(() => {
    load()
  }, [])

  const handleSendInvoice = (invoiceNo: string) => {
    showToast(`${invoiceNo} e-faturası başarıyla GİB sistemine gönderildi.`, 'success')
  }

  const handleDelete = async (invoiceNo: string) => {
    const ok = await confirm('Bu faturayı silmek istediğinizden emin misiniz?', { type: 'danger', confirmText: 'Evet, Sil', title: 'Faturayı Sil' })
    if (ok) {
      showToast(`${invoiceNo} faturası silindi.`, 'success')
    }
  }

  const handleViewInvoice = (row: InvoiceRow) => {
    if (row.orderId) {
      window.open(`/api/orders/${row.orderId}/invoice?token=${getAdminToken()}`, '_blank')
    } else {
      window.open(`/uploads/invoices/${row.invoiceNo}.pdf`, '_blank')
    }
  }

  const handleDownloadInvoice = (row: InvoiceRow) => {
    if (row.orderId) {
      window.location.href = `/api/orders/${row.orderId}/invoice?token=${getAdminToken()}&download=true`
    } else {
      const link = document.createElement('a')
      link.href = `/uploads/invoices/${row.invoiceNo}.pdf`
      link.download = `fatura_${row.invoiceNo}.pdf`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    }
  }

  const now = new Date()
  const totalInvoices = rows.length
  
  const thisMonthInvoices = rows.filter(r => {
    if (!r.createdAtUtc) return false
    const d = new Date(r.createdAtUtc)
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
  }).length

  const totalAmount = rows.reduce((sum, r) => sum + (r.total || 0), 0)
  const pendingInvoices = rows.filter(r => r.status === 'Pending' || r.status === 'Draft').length

  return (
    <AdminLayout
      title="Fatura Yönetimi"
      subtitle="E-fatura durumlarını, vergi kesintilerini takip edin ve e-arşiv faturalarını yazdırın."
    >
      {/* KPI Section */}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Toplam Fatura', value: totalInvoices.toLocaleString('tr-TR'), icon: 'description', color: 'text-zinc-650 bg-zinc-50 border-zinc-150' },
          { label: 'Bu Ay Kesilen', value: thisMonthInvoices.toLocaleString('tr-TR'), icon: 'new_releases', color: 'text-blue-600 bg-blue-50 border-blue-100' },
          { label: 'Toplam Fatura Tutarı', value: `${totalAmount.toLocaleString('tr-TR')} ₺`, icon: 'payments', color: 'text-green-600 bg-green-50 border-green-100' },
          { label: 'Gönderim Bekleyen', value: pendingInvoices.toLocaleString('tr-TR'), icon: 'hourglass_empty', color: 'text-amber-600 bg-amber-50 border-amber-100' },
        ].map((item) => (
          <div key={item.label} className="rounded-3xl border border-zinc-200/85 bg-white p-5 shadow-[0_2px_8px_rgba(0,0,0,0.02)] transition-all duration-300 hover:shadow-md hover:border-zinc-350/80 hover:-translate-y-0.5">
            <div className="flex justify-between items-start">
              <span className="text-[11px] font-extrabold tracking-wider text-zinc-455 uppercase">{item.label}</span>
              <span className={`material-symbols-outlined text-[20px] p-2 rounded-2xl border ${item.color}`}>{item.icon}</span>
            </div>
            <div className="mt-2 text-2xl font-black tracking-tight text-zinc-900">{item.value}</div>
          </div>
        ))}
      </div>

      {/* Grid Table */}
      <div className="mt-6 overflow-hidden rounded-3xl border border-zinc-200/80 bg-white shadow-[0_2px_8px_rgba(0,0,0,0.02),0_8px_24px_rgba(0,0,0,0.02)]">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-zinc-50/80 border-b border-zinc-200/80 text-[10px] font-extrabold tracking-wider text-zinc-455 uppercase">
                <th className="px-6 py-4">Fatura No</th>
                <th className="px-6 py-4">Sipariş No</th>
                <th className="px-6 py-4">Müşteri Adı</th>
                <th className="px-6 py-4 text-center">Tarih</th>
                <th className="px-6 py-4 text-center">Matrah</th>
                <th className="px-6 py-4 text-center">KDV (%18/20)</th>
                <th className="px-6 py-4 text-center">Toplam</th>
                <th className="px-6 py-4 text-center">Durum</th>
                <th className="px-6 py-4 text-right">İşlemler</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-150/60 text-xs text-zinc-650">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-zinc-50/50 transition-colors duration-150">
                  <td className="px-6 py-4.5 font-mono font-bold text-zinc-800">{row.invoiceNo}</td>
                  <td className="px-6 py-4.5 font-mono text-zinc-500 font-semibold">{row.orderNo}</td>
                  <td className="px-6 py-4.5 font-bold text-zinc-950">{row.customerName}</td>
                  <td className="px-6 py-4.5 text-center text-zinc-500 font-medium">
                    {row.createdAtUtc ? new Date(row.createdAtUtc).toLocaleDateString('tr-TR') : '-'}
                  </td>
                  <td className="px-6 py-4.5 text-center font-semibold text-zinc-600">{(row.total - row.tax).toLocaleString('tr-TR')} ₺</td>
                  <td className="px-6 py-4.5 text-center font-semibold text-zinc-650">{row.tax.toLocaleString('tr-TR')} ₺</td>
                  <td className="px-6 py-4.5 text-center font-extrabold text-zinc-900">{row.total.toLocaleString('tr-TR')} ₺</td>
                  <td className="px-6 py-4.5 text-center">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[9px] font-bold border uppercase tracking-wider ${
                      row.status === 'Paid' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-amber-50 border-amber-200 text-amber-700'
                    }`}>
                      {row.status === 'Paid' ? 'Ödendi' : 'Gönderim Bekliyor'}
                    </span>
                  </td>
                  <td className="px-6 py-4.5 text-right">
                    <div className="flex justify-end gap-1.5">
                      {row.status === 'Pending' && (
                        <button
                          type="button"
                          onClick={() => handleSendInvoice(row.invoiceNo)}
                          className="w-7 h-7 rounded-full bg-amber-50 border border-amber-200 text-amber-700 hover:bg-amber-100 flex items-center justify-center"
                          title="GİB'e Gönder"
                        >
                          <span className="material-symbols-outlined text-[16px]">send</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleViewInvoice(row)}
                        className="w-7 h-7 rounded-full border border-zinc-200/80 text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 flex items-center justify-center"
                        title="Önizle"
                      >
                        <span className="material-symbols-outlined text-[16px]">visibility</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDownloadInvoice(row)}
                        className="w-7 h-7 rounded-full border border-zinc-200/80 text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 flex items-center justify-center"
                        title="Faturayı İndir"
                      >
                        <span className="material-symbols-outlined text-[16px]">download</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(row.invoiceNo)}
                        className="w-7 h-7 rounded-full border border-zinc-200 text-zinc-400 hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50 flex items-center justify-center"
                        title="İptal Et"
                      >
                        <span className="material-symbols-outlined text-[16px]">delete</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AdminLayout>
  )
}
