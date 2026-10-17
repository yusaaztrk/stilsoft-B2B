import { apiJson } from '../../shared/api/client';
import { getAccessToken, getStoredSession } from '../../shared/session/storage';
import { API_BASE_URL } from '../../shared/config';

export type ServiceRecord = {
  id: string;
  serviceNumber: string;
  status: string;
  statusLabel?: string;
  type: string;
  typeLabel?: string;
  createdAt: string;
  plannedAt?: string;
  customerName?: string;
  customerPhone?: string;
  customerAddress?: string;
  productName?: string;
  serialNumber?: string;
  assignedTechnicianId?: string;
  assignedTechnicianName?: string;
  regionName?: string;
  priority?: string;
  priorityLabel?: string;
  dealerName?: string;
  isUnderWarranty?: boolean;
  latitude?: number | null;
  longitude?: number | null;
  userRouteTick?: boolean;
  userRouteHour?: string | null;
  userRouteSortOrder?: number;
  routeDate?: string;
  routeOrder?: number | null;
  plannedStartTime?: string | null;
  plannedEndTime?: string | null;
};

export type ServiceTimelineItem = {
  id: string;
  createdAt: string;
  action: string;
  notes?: string;
  performedBy?: string;
  type?: string;
  payload?: any;
  technicianId?: string;
  actor?: string;
  photoUrl?: string | null;
};

export type PagedResult<T> = {
  items: T[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
};

export type ServiceRecordPagedQuery = {
  q?: string;
  status?: string;
  statuses?: string;
  type?: string;
  technicianId?: string;
  regionId?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
};

export type CreateServiceRecordInput = {
  type: string;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  customerAddress?: string;
  customerId?: string;
  productName: string;
  productModel?: string;
  serialNumber?: string;
  isUnderWarranty: boolean;
  dealerId?: string;
  dealerName?: string;
  problemDescription?: string;
  receivingNote?: string;
  priority?: string;
  regionId?: string;
  plannedDate?: string;
  estimatedDeliveryDate?: string;
  technicianId?: string;
};

export async function fetchServiceRecordsPaged(
  query: ServiceRecordPagedQuery,
  signal?: AbortSignal
): Promise<PagedResult<ServiceRecord>> {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.status) params.set('status', query.status);
  if (query.statuses) params.set('statuses', query.statuses);
  if (query.type) params.set('type', query.type);
  if (query.technicianId) params.set('technicianId', query.technicianId);
  if (query.regionId) params.set('regionId', query.regionId);
  if (query.dateFrom) params.set('dateFrom', query.dateFrom);
  if (query.dateTo) params.set('dateTo', query.dateTo);
  params.set('page', String(query.page ?? 1));
  params.set('pageSize', String(query.pageSize ?? 20));

  return await apiJson<PagedResult<ServiceRecord>>(`/api/servicerecords/paged?${params}`, { signal });
}

export async function fetchServiceRecords(
  query: {
    status?: string;
    technicianId?: string;
    regionId?: string;
    plannedFrom?: string;
    plannedTo?: string;
  },
  signal?: AbortSignal
): Promise<ServiceRecord[]> {
  const params = new URLSearchParams();
  if (query.status) params.set('status', query.status);
  if (query.technicianId) params.set('technicianId', query.technicianId);
  if (query.regionId) params.set('regionId', query.regionId);
  if (query.plannedFrom) params.set('plannedFrom', query.plannedFrom);
  if (query.plannedTo) params.set('plannedTo', query.plannedTo);

  return await apiJson<ServiceRecord[]>(`/api/servicerecords?${params}`, { signal });
}

export async function fetchStatusCounts(signal?: AbortSignal): Promise<Record<string, number>> {
  return await apiJson<Record<string, number>>('/api/servicerecords/status-counts', { signal });
}

export async function fetchTodayServices(signal?: AbortSignal): Promise<ServiceRecord[]> {
  return await apiJson<ServiceRecord[]>('/api/servicerecords/today', { signal });
}

export async function fetchDelayedServices(signal?: AbortSignal): Promise<ServiceRecord[]> {
  return await apiJson<ServiceRecord[]>('/api/servicerecords/delayed', { signal });
}

export async function fetchServiceRecordById(id: string, signal?: AbortSignal): Promise<ServiceRecord> {
  return await apiJson<ServiceRecord>(`/api/servicerecords/${encodeURIComponent(id)}`, { signal });
}

function mapTimelineEvent(ev: any): ServiceTimelineItem {
  let payload: any = {};
  try {
    payload = typeof ev.payload === 'string' ? JSON.parse(ev.payload) : (ev.payload || {});
  } catch {}

  if (payload.reason === 'Manual installation allocation') {
    payload.reason = 'Manuel montaj planlaması/ataması';
  } else if (payload.reason === 'Installation task planned and assigned') {
    payload.reason = 'Montaj görevi planlandı ve atandı';
  }

  const typeLabels: Record<string, string> = {
    StatusChanged: 'Durum Değişikliği',
    Assigned: 'Teknisyen Atandı',
    NoteAdded: 'Not Eklendi',
    WorkLogged: 'İş Kaydı',
    Created: 'Oluşturuldu',
    PhotoUploaded: 'Fotoğraf Yüklendi',
  };

  const statusLabels: Record<string, string> = {
    New: 'Yeni',
    Planned: 'Planlandı',
    Workshop: 'Aktif / Sahada',
    InRepair: 'Arıza Tamirinde',
    WaitingForParts: 'Parça Bekliyor',
    Ready: 'Hazır',
    Delivered: 'Teslim Edildi',
    Completed: 'Gerçekleşti',
    Cancelled: 'İptal',
    Deferred: 'Ertelendi',
  };

  const statusLabel = (val: string) => statusLabels[val] || val;

  let notes = '';
  if (ev.type === 'StatusChanged') {
    notes = `${statusLabel(payload.oldValue)} → ${statusLabel(payload.newValue)}`;
    if (payload.reason) {
      notes += `\n"${payload.reason}"`;
    }
  } else if (ev.type === 'Assigned') {
    notes = `Teknisyen: ${payload.newValue || ev.technicianName || '-'}`;
    if (payload.reason) {
      notes += `\n"${payload.reason}"`;
    }
  } else if (ev.type === 'NoteAdded') {
    notes = `"${payload.newValue || '-'}"`;
  } else if (ev.type === 'WorkLogged') {
    notes = payload.reason || '-';
    if (payload.metadata?.Duration) {
      notes += ` (${payload.metadata.Duration} dk)`;
    }
  } else if (ev.type === 'Created') {
    notes = 'Kayıt sisteme eklendi.';
  } else if (ev.type === 'PhotoUploaded') {
    notes = 'Saha fotoğrafı yüklendi.';
    if (payload.metadata?.fileName) {
      notes += ` (${payload.metadata.fileName})`;
    }
  } else {
    notes = payload.reason || payload.newValue || '';
  }

  let photoUrl: string | null = null;
  const isPhotoUpload = (ev.type || '').toLowerCase() === 'photouploaded';
  if (isPhotoUpload) {
    photoUrl = payload.newValue || payload.NewValue || null;
  }

  return {
    id: ev.id,
    createdAt: ev.timestamp,
    action: typeLabels[ev.type] || ev.type,
    notes: notes,
    performedBy: ev.actor || 'Sistem',
    type: ev.type,
    payload: payload,
    technicianId: ev.technicianId,
    actor: ev.actor,
    photoUrl: photoUrl
  };
}

export function groupMobileTimelineEvents(timeline: any[] | undefined | null): any[] {
  if (!timeline || !Array.isArray(timeline)) return [];
  
  // Sort oldest first for chronological grouping
  const sorted = [...timeline].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  
  const result: any[] = [];
  const visited = new Set<string>();

  for (let i = 0; i < sorted.length; i++) {
    if (visited.has(String(i))) continue;
    
    const current = sorted[i];
    visited.add(String(i));

    const curTypeLower = (current.type || '').toLowerCase();
    if (['statuschanged', 'photouploaded', 'noteadded'].includes(curTypeLower)) {
      const group = [current];

      for (let j = i + 1; j < sorted.length; j++) {
        if (visited.has(String(j))) continue;
        
        const next = sorted[j];
        const nextTypeLower = (next.type || '').toLowerCase();
        if (!['statuschanged', 'photouploaded', 'noteadded'].includes(nextTypeLower)) continue;

        // Check if same technician or one is null/undefined
        const isSameTech = !current.technicianId || !next.technicianId || current.technicianId === next.technicianId;
        const timeDiff = Math.abs(new Date(next.createdAt).getTime() - new Date(current.createdAt).getTime()) / 1000;
        
        if (isSameTech && timeDiff <= 65) {
          group.push(next);
          visited.add(String(j));
        }
      }

      // Convert the group (even if length is 1) into a single FaultUpdate event
      const photoUrls: string[] = [];
      let statusText: string | null = null;
      let note: string | null = null;
      let compositeActor = current.performedBy;

      const statusLabels: Record<string, string> = {
        New: 'Yeni',
        Planned: 'Planlandı',
        Workshop: 'Aktif / Sahada',
        InRepair: 'Arıza Tamirinde',
        WaitingForParts: 'Parça Bekliyor',
        Ready: 'Hazır',
        Delivered: 'Teslim Edildi',
        Completed: 'Gerçekleşti',
        Cancelled: 'İptal',
        Deferred: 'Ertelendi',
      };
      const statusLabel = (val: string) => statusLabels[val] || val;

      for (const ev of group) {
        let payload: any = {};
        try {
          payload = typeof ev.payload === 'string' ? JSON.parse(ev.payload) : (ev.payload || {});
        } catch {}

        if (ev.performedBy && ev.performedBy !== 'Sistem' && (!compositeActor || compositeActor === 'Sistem' || compositeActor.includes('_') || !compositeActor.includes(' '))) {
          compositeActor = ev.performedBy;
        }

        const evTypeLower = (ev.type || '').toLowerCase();
        if (evTypeLower === 'photouploaded') {
          const val = payload.newValue || payload.NewValue;
          if (val) {
            val.split(',').forEach((u: string) => {
              if (u.trim()) photoUrls.push(u.trim());
            });
          }
        } else if (evTypeLower === 'statuschanged') {
          statusText = `Durum: ${statusLabel(payload.oldValue)} → ${statusLabel(payload.newValue)}`;
          if (payload.reason) {
            note = payload.reason;
          }
        } else if (ev.type === 'NoteAdded') {
          note = payload.newValue || note;
        }
      }

      result.push({
        id: current.id || String(i),
        type: 'FaultUpdate',
        createdAt: current.createdAt,
        action: 'Arıza Güncellemesi',
        performedBy: compositeActor || 'Sistem',
        photoUrl: photoUrls[0] || null,
        photoUrls,
        statusText,
        note,
        originalEvents: group
      });
    } else {
      result.push(current);
    }
  }

  // Sort back to descending (newest first)
  return result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function fetchServiceTimeline(id: string, signal?: AbortSignal): Promise<ServiceTimelineItem[]> {
  const data = await apiJson<any[]>(`/api/servicerecords/${encodeURIComponent(id)}/timeline`, { signal });
  return (data || []).map(mapTimelineEvent);
}

export async function updateServiceRecordStatus(
  id: string,
  payload: { status: string; notes?: string | null; performedByTechnicianId?: string | null }
): Promise<ServiceRecord> {
  return await apiJson<ServiceRecord>(`/api/servicerecords/${encodeURIComponent(id)}/status`, {
    method: 'PATCH',
    body: JSON.stringify({
      status: payload.status,
      notes: payload.notes ?? null,
      performedByTechnicianId: payload.performedByTechnicianId ?? undefined,
    }),
  });
}

export async function createServiceRecord(payload: CreateServiceRecordInput, signal?: AbortSignal): Promise<ServiceRecord> {
  return await apiJson<ServiceRecord>(`/api/servicerecords`, {
    method: 'POST',
    body: JSON.stringify(payload),
    signal,
  });
}

export async function uploadServiceRecordPhoto(
  serviceId: string,
  fileUri: string,
  fileName: string,
  fileType: string
): Promise<{ success: boolean; url?: string }> {
  const token = await getAccessToken();
  const session = await getStoredSession();

  const formData = new FormData();
  formData.append('file', {
    uri: fileUri,
    name: fileName || 'photo.jpg',
    type: fileType || 'image/jpeg',
  } as any);

  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (session?.tenantCode) headers['X-Tenant-Code'] = session.tenantCode;

  const res = await fetch(`${API_BASE_URL}/api/servicerecords/${encodeURIComponent(serviceId)}/photo`, {
    method: 'POST',
    headers,
    body: formData,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Yükleme başarısız (${res.status})`);
  }

  return await res.json().catch(() => ({}));
}

export async function uploadInstallationTaskPhoto(
  taskId: string,
  fileUri: string,
  fileName: string,
  fileType: string
): Promise<{ success: boolean; url?: string }> {
  const token = await getAccessToken();
  const session = await getStoredSession();

  const formData = new FormData();
  formData.append('file', {
    uri: fileUri,
    name: fileName || 'photo.jpg',
    type: fileType || 'image/jpeg',
  } as any);

  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (session?.tenantCode) headers['X-Tenant-Code'] = session.tenantCode;

  const res = await fetch(`${API_BASE_URL}/api/installations/tasks/${encodeURIComponent(taskId)}/photo`, {
    method: 'POST',
    headers,
    body: formData,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Yükleme başarısız (${res.status})`);
  }

  return await res.json().catch(() => ({}));
}

export async function updateUserRoutePlan(
  id: string,
  payload: { userRouteTick?: boolean; userRouteHour?: string | null; userRouteSortOrder?: number }
): Promise<ServiceRecord> {
  return await apiJson<ServiceRecord>(`/api/servicerecords/${encodeURIComponent(id)}/user-plan`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function bulkUpdateUserRoutePlan(
  items: { serviceRecordId: string; userRouteTick?: boolean; userRouteHour?: string | null; userRouteSortOrder?: number }[]
): Promise<{ success: boolean }> {
  return await apiJson<{ success: boolean }>('/api/servicerecords/user-plan/bulk', {
    method: 'POST',
    body: JSON.stringify({ items }),
  });
}

export async function deleteServiceRecord(id: string): Promise<any> {
  return await apiJson(`/api/servicerecords/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function restoreServiceRecord(id: string): Promise<any> {
  return await apiJson(`/api/servicerecords/${encodeURIComponent(id)}/restore`, {
    method: 'POST',
  });
}

export async function fetchDeletedServiceRecords(
  category: 'saha' | 'atolye' | 'montaj',
  page: number,
  pageSize: number
): Promise<{ items: any[]; page: number; pageSize: number; totalCount: number; totalPages: number }> {
  return await apiJson<{ items: any[]; page: number; pageSize: number; totalCount: number; totalPages: number }>(
    `/api/servicerecords/deleted?type=${category}&page=${page}&pageSize=${pageSize}`
  );
}

export async function assignTechnician(
  recordId: string,
  payload: { 
    technicianId: string; 
    routeDate: string; 
    routeOrder?: number | null; 
    plannedStartTime?: string | null; 
    plannedEndTime?: string | null; 
  }
): Promise<any> {
  return await apiJson(`/api/servicerecords/${encodeURIComponent(recordId)}/route-plan`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function bulkAssignTechnician(
  items: { 
    serviceRecordId: string; 
    technicianId: string; 
    routeDate: string; 
    routeOrder?: number | null; 
    plannedStartTime?: string | null; 
    plannedEndTime?: string | null; 
  }[]
): Promise<any> {
  return await apiJson(`/api/servicerecords/route-plan/bulk`, {
    method: 'POST',
    body: JSON.stringify({ items }),
  });
}

