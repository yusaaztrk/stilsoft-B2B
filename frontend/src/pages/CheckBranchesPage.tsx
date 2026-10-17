import React, { useEffect, useMemo, useState } from 'react'
import { Plus, Pencil, Trash2, Building2 } from 'lucide-react'
import Modal from '../components/Modal'
import Table, { type TableColumn } from '../components/Table'
import FormInput from '../components/forms/FormInput'
import {
  fetchCheckBranches,
  createCheckBranch,
  updateCheckBranch,
  deleteCheckBranch,
  type CheckBranchDto
} from '../api/checkBranches'

export default function CheckBranchesPage() {
  const [branches, setBranches] = useState<CheckBranchDto[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [saving, setSaving] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)

  const loadBranches = async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await fetchCheckBranches()
      setBranches(data)
    } catch (err: any) {
      setError(err?.message || 'Şubeler yüklenemedi')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadBranches()
  }, [])

  const openCreateModal = () => {
    setEditId(null)
    setName('')
    setIsActive(true)
    setModalError(null)
    setModalOpen(true)
  }

  const openEditModal = (item: CheckBranchDto) => {
    setEditId(item.id)
    setName(item.name)
    setIsActive(item.isActive)
    setModalError(null)
    setModalOpen(true)
  }

  const handleSave = async () => {
    if (!name.trim()) {
      setModalError('Şube adı zorunludur')
      return
    }

    try {
      setSaving(true)
      setModalError(null)
      if (editId) {
        await updateCheckBranch(editId, { name: name.trim(), isActive })
      } else {
        await createCheckBranch({ name: name.trim(), isActive })
      }
      setModalOpen(false)
      await loadBranches()
    } catch (err: any) {
      setModalError(err?.message || 'Kaydedilemedi')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: number) => {
    if (!window.confirm('Bu şubeyi silmek istediğinize emin misiniz?')) return
    try {
      setLoading(true)
      await deleteCheckBranch(id)
      await loadBranches()
    } catch (err: any) {
      alert(err?.message || 'Silinemedi')
    } finally {
      setLoading(false)
    }
  }

  const columns = useMemo<TableColumn<CheckBranchDto>[]>(() => [
    {
      key: 'id',
      label: '# ID',
      render: (_v, b) => <span className="text-gray-400 font-mono">#{b.id}</span>
    },
    {
      key: 'name',
      label: 'Şube Adı',
      render: (_v, b) => <span className="font-bold text-gray-900">{b.name}</span>
    },
    {
      key: 'isActive',
      label: 'Durum',
      // Süzgeç ve sıralama METİN üzerinden: ham `true/false` ile kullanıcı "aktif" yazıp
      // arayamaz, sıralama da doğru/yanlış diye dizerdi.
      accessorFn: (b) => (b.isActive ? 'Aktif' : 'Pasif'),
      filter: { type: 'select', options: [{ label: 'Aktif', value: 'Aktif' }, { label: 'Pasif', value: 'Pasif' }] },
      render: (_v, b) =>
        b.isActive ? (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
            Aktif
          </span>
        ) : (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-gray-100 text-gray-500 border border-gray-200">
            Pasif
          </span>
        )
    },
    {
      key: 'actions',
      label: 'İşlemler',
      render: (_v, b) => (
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => openEditModal(b)}
            className="p-1.5 rounded-lg text-slate-500 hover:text-blue-600 hover:bg-blue-50 transition"
            title="Düzenle"
          >
            <Pencil size={15} />
          </button>
          <button
            type="button"
            onClick={() => handleDelete(b.id)}
            className="p-1.5 rounded-lg text-slate-500 hover:text-red-600 hover:bg-red-50 transition"
            title="Sil"
          >
            <Trash2 size={15} />
          </button>
        </div>
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [])

  const filteredBranches = branches.filter((b) =>
    b.name.toLocaleLowerCase('tr-TR').includes(search.toLocaleLowerCase('tr-TR'))
  )

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight flex items-center gap-2">
            <Building2 className="text-blue-600" size={22} />
            <span>Şube Tanımları (Çek / Senet)</span>
          </h1>
          <p className="text-xs text-gray-400 mt-0.5">Çek ve senet işlemlerinde kullanılan şube listesini buradan yönetebilirsiniz.</p>
        </div>

        <button
          type="button"
          onClick={openCreateModal}
          className="h-10 px-4 inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs transition"
        >
          <Plus size={16} />
          <span>Yeni Şube Ekle</span>
        </button>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-sm font-semibold text-red-600">
          {error}
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-2xl p-4 space-y-4 shadow-2xs">
        <div className="flex items-center justify-between">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Şube ara..."
            className="input-base h-9 text-xs w-72"
          />
          <span className="text-xs font-semibold text-gray-500">{filteredBranches.length} Şube</span>
        </div>

        <Table<CheckBranchDto>
          onRefresh={() => void loadBranches()}
          columns={columns}
          data={filteredBranches}
          rowKey={(b) => String(b.id)}
          loading={loading}
        />
      </div>

      <Modal
        isOpen={modalOpen}
        onClose={() => !saving && setModalOpen(false)}
        title={editId ? 'Şube Düzenle' : 'Yeni Şube Ekle'}
        footer={
          <div className="flex items-center justify-end gap-2 w-full">
            <button
              type="button"
              disabled={saving}
              onClick={() => setModalOpen(false)}
              className="h-9 px-4 text-xs font-bold rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 transition"
            >
              Vazgeç
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={handleSave}
              className="h-9 px-4 text-xs font-bold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition"
            >
              {saving ? 'Kaydediliyor...' : 'Kaydet'}
            </button>
          </div>
        }
      >
        <div className="space-y-4 py-2">
          {modalError && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs font-bold text-red-600">
              {modalError}
            </div>
          )}

          <FormInput
            label="Şube Adı"
            requiredMark
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Örn: Lefkoşa, Girne, Merkez Şube..."
          />

          <div className="flex items-center gap-2 pt-2">
            <label className="flex items-center gap-2 text-xs font-bold text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500"
              />
              <span>Aktif Şube</span>
            </label>
          </div>
        </div>
      </Modal>
    </div>
  )
}
