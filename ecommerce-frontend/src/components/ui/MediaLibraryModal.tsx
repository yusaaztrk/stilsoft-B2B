import React, { useState, useEffect, useRef } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import { Input } from './Input';
import { useToast } from './ToastContext';
import { useConfirm } from './ConfirmContext';

interface MediaItem {
  id: string;
  name: string;
  url: string;
  type: string;
  size: number;
  uploadedAt: string;
  folder: string;
}

interface MediaLibraryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (url: string) => void;
  title?: string;
  activeFolder?: string;
}

export function MediaLibraryModal({
  isOpen,
  onClose,
  onSelect,
  title = 'Medya Kütüphanesi',
  activeFolder = 'Genel',
}: MediaLibraryModalProps) {
  const { showToast, dismissToast } = useToast();
  const confirm = useConfirm();
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedFolder, setSelectedFolder] = useState(activeFolder);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  // Load items from API
  const fetchMedia = async () => {
    setIsLoading(true);
    try {
      const token = localStorage.getItem('ecom_admin_token');
      const response = await fetch('/api/admin/media', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const res = await response.json();
      if (res.success) {
        setMediaItems(res.data || []);
      } else {
        showToast(res.message || 'Medyalar yüklenemedi', 'error');
      }
    } catch (e) {
      showToast('Bağlantı hatası oluştu', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchMedia();
    }
  }, [isOpen]);

  const handleUpload = async (files: FileList) => {
    if (files.length === 0) return;
    setUploading(true);
    const toastId = showToast('Dosya yükleniyor...', 'loading', 0);
    try {
      const token = localStorage.getItem('ecom_admin_token');
      const formData = new FormData();
      formData.append('file', files[0]);
      formData.append('folder', selectedFolder);

      const response = await fetch('/api/admin/media', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      });
      const res = await response.json();
      if (res.success) {
        setMediaItems((prev) => [res.data, ...prev]);
        showToast('Dosya başarıyla yüklendi.', 'success');
      } else {
        showToast(res.message || 'Yükleme başarısız', 'error');
      }
    } catch (e) {
      showToast('Bağlantı hatası', 'error');
    } finally {
      setUploading(false);
      dismissToast(toastId);
      fetchMedia(); // Refresh list to get all items
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const ok = await confirm('Bu medyayı kalıcı olarak silmek istediğinizden emin misiniz?', { type: 'danger', confirmText: 'Evet, Sil', title: 'Medyayı Sil' });
    if (!ok) return;

    try {
      const token = localStorage.getItem('ecom_admin_token');
      const response = await fetch(`/api/admin/media/${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const res = await response.json();
      if (res.success) {
        setMediaItems((prev) => prev.filter((item) => item.id !== id));
        showToast('Medya silindi.', 'success');
      } else {
        showToast(res.message || 'Silme işlemi başarısız', 'error');
      }
    } catch (e) {
      showToast('Bağlantı hatası', 'error');
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files) {
      handleUpload(e.dataTransfer.files);
    }
  };

  // Directories list
  const folders = ['Genel', 'Slider', 'Banners', 'Ürünler', 'PDF Dokümanları'];

  const filteredItems = mediaItems.filter((item) => {
    const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFolder = item.folder === selectedFolder;
    return matchesSearch && matchesFolder;
  });

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="xl">
      <div className="flex flex-col gap-4 h-[65vh]">
        {/* Top bar controls */}
        <div className="flex flex-col sm:flex-row gap-2 items-center justify-between">
          {/* Folders tabs */}
          <div className="flex border-b border-outline-variant w-full sm:w-auto">
            {folders.map((f) => (
              <button
                key={f}
                onClick={() => setSelectedFolder(f)}
                className={`px-4 py-2 text-xs font-bold uppercase transition-all border-b-2 ${
                  selectedFolder === f
                    ? 'border-primary text-primary'
                    : 'border-transparent text-tertiary hover:text-on-surface'
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Input
              placeholder="Görsel ara..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              icon="search"
              className="max-w-xs"
            />
            <Button
              variant="primary"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              icon="upload"
            >
              Yükle
            </Button>
            <input
              type="file"
              ref={fileInputRef}
              onChange={(e) => e.target.files && handleUpload(e.target.files)}
              accept="image/*,application/pdf"
              className="hidden"
            />
          </div>
        </div>

        {/* Drag & Drop Upload Overlay */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`flex-1 flex flex-col border-2 border-dashed rounded-lg overflow-y-auto custom-scrollbar transition-all p-4 ${
            isDragOver ? 'border-primary bg-primary/5' : 'border-outline-variant bg-surface-container-low'
          }`}
        >
          {isDragOver ? (
            <div className="flex-1 flex flex-col items-center justify-center pointer-events-none select-none text-primary">
              <span className="material-symbols-outlined text-[64px] animate-bounce">cloud_upload</span>
              <p className="text-sm font-bold">Yüklemek için buraya bırakın</p>
            </div>
          ) : isLoading ? (
            <div className="flex-1 flex flex-col items-center justify-center text-tertiary select-none">
              <svg className="animate-spin h-10 w-10 text-primary mb-2" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <p className="text-xs font-semibold">Görseller yükleniyor...</p>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-tertiary select-none p-8">
              <span className="material-symbols-outlined text-[48px] mb-2">image</span>
              <p className="text-sm font-bold">Burada görsel bulunmuyor.</p>
              <p className="text-xs text-on-surface-variant">Sürükle-bırak yaparak veya yükle butonuyla ekleyin.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3">
              {filteredItems.map((item) => (
                <div
                  key={item.id}
                  onClick={() => onSelect(item.url)}
                  className="group relative border border-outline-variant bg-surface rounded-md overflow-hidden shadow-xs hover:border-primary hover:shadow-md cursor-pointer transition-all duration-200"
                >
                  {/* Aspect Ratio Box */}
                  <div className="aspect-square w-full bg-surface-container flex items-center justify-center overflow-hidden">
                    {item.url.toLowerCase().endsWith('.pdf') || item.type === 'application/pdf' ? (
                      <div className="flex flex-col items-center justify-center text-red-650 h-full w-full bg-red-50/20">
                        <span className="material-symbols-outlined text-[40px]">picture_as_pdf</span>
                        <span className="text-[9px] font-black mt-1 uppercase tracking-wider">PDF BELGESİ</span>
                      </div>
                    ) : (
                      <img
                        src={item.url}
                        alt={item.name}
                        loading="lazy"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                      />
                    )}
                  </div>

                  {/* Card overlay info */}
                  <div className="p-2 border-t border-outline-variant">
                    <p className="text-xs font-bold text-on-surface truncate" title={item.name}>
                      {item.name}
                    </p>
                    <p className="text-[10px] text-tertiary font-medium">
                      {formatSize(item.size)}
                    </p>
                  </div>

                  {/* Deletion hover overlay */}
                  <button
                    onClick={(e) => handleDelete(item.id, e)}
                    className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity bg-error text-on-error p-1 rounded-full hover:bg-error/95 shadow-md flex items-center justify-center"
                    title="Kalıcı Olarak Sil"
                  >
                    <span className="material-symbols-outlined text-[16px]">delete</span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
