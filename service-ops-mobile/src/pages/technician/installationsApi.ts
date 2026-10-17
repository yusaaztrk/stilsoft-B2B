import { apiJson } from '../../shared/api/client';

export type InstallationTaskDto = {
  id: string;
  serviceId: string;
  title?: string;
  description?: string;
  status: string;
  statusLabel?: string;
  assignedTechnicianId?: string;
  technicianName?: string | null;
  plannedAt?: string;
  completedAt?: string;
  notes?: string | null;
  customAddress?: string | null;
  quantity?: number | null;
  photoUrl?: string | null;
};

export async function fetchInstallationTasks(serviceId: string, signal?: AbortSignal): Promise<InstallationTaskDto[]> {
  const qs = new URLSearchParams({ serviceId }).toString();
  return await apiJson<InstallationTaskDto[]>(`/api/installations/tasks?${qs}`, { signal });
}

export async function updateInstallationTaskStatus(
  taskId: string,
  payload: {
    status: string;
    reason?: string | null;
    assignedTechnicianId?: string | null;
    plannedAt?: string | null;
    customAddress?: string | null;
  }
) {
  return await apiJson<InstallationTaskDto>(`/api/installations/tasks/${encodeURIComponent(taskId)}/status`, {
    method: 'PATCH',
    body: JSON.stringify({
      status: payload.status,
      reason: payload.reason ?? null,
      assignedTechnicianId: payload.assignedTechnicianId ?? undefined,
      plannedAt: payload.plannedAt ?? undefined,
      customAddress: payload.customAddress ?? undefined,
    }),
  });
}
