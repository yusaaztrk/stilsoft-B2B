import { apiJson } from '../../shared/api/client';

export type DayPlanServiceItem = {
  id: string;
  serviceNumber: string;
  type: string;
  status: string;
  plannedDateUtc?: string;
  customerName?: string;
  customerPhone?: string;
  customerAddress?: string;
  productName?: string;
  regionId?: string;
  technicianId?: string;
  technicianName?: string;
};

export type DayPlanRouteItem = {
  id: string;
  routeNumber: string;
  name: string;
  plannedDateUtc?: string;
  status: string;
  technicianId?: string;
  technicianName?: string;
  regionId?: string;
  regionName?: string;
  stops?: number;
};

export type DayPlanResponse = {
  date: string;
  plannedServices: number;
  plannedRoutes: number;
  services: DayPlanServiceItem[];
  routes: DayPlanRouteItem[];
};

export async function fetchPlanningDay(dateUtcIso: string, signal?: AbortSignal): Promise<DayPlanResponse> {
  const qs = new URLSearchParams({ dateUtc: dateUtcIso });
  return await apiJson<DayPlanResponse>(`/api/planning/day?${qs.toString()}`, { signal });
}

export async function bulkPlan(serviceIds: string[], plannedDateUtcIso: string, signal?: AbortSignal): Promise<{ updated: number }> {
  const res = await apiJson<{ success?: boolean; updated?: number }>(`/api/planning/bulk-plan`, {
    method: 'POST',
    body: JSON.stringify({ serviceIds, plannedDateUtc: plannedDateUtcIso }),
    signal,
  });
  return { updated: Number(res?.updated ?? 0) };
}

export async function bulkAssign(serviceIds: string[], technicianId: string, signal?: AbortSignal): Promise<{ updated: number }> {
  const res = await apiJson<{ success?: boolean; updated?: number }>(`/api/planning/bulk-assign`, {
    method: 'POST',
    body: JSON.stringify({ serviceIds, technicianId }),
    signal,
  });
  return { updated: Number(res?.updated ?? 0) };
}

export async function smartAssign(payload: {
  plannedDateUtc?: string | null;
  regionId?: string | null;
  type?: string | null;
  status?: string | null;
  maxToAssign?: number;
}): Promise<{ updated: number; message?: string }> {
  const res = await apiJson<{ success?: boolean; updated?: number; message?: string }>(`/api/planning/smart-assign`, {
    method: 'POST',
    body: JSON.stringify({
      plannedDateUtc: payload.plannedDateUtc ?? null,
      regionId: payload.regionId ?? null,
      type: payload.type ?? null,
      status: payload.status ?? null,
      maxToAssign: payload.maxToAssign ?? 50,
    }),
  });
  return { updated: Number(res?.updated ?? 0), message: res?.message };
}

export type TechnicianDto = {
  id: string;
  fullName: string;
  status: string;
  regionName?: string;
  dailyTasks?: number;
  plannedServicesToday?: number;
  routeStopsToday?: number;
  primaryRegionId?: string;
  maxDailyTasks?: number;
};

export async function fetchAvailableTechnicians(date?: string, signal?: AbortSignal): Promise<TechnicianDto[]> {
  const url = date ? `/api/technicians/available?date=${encodeURIComponent(date)}` : `/api/technicians/available`;
  return await apiJson<TechnicianDto[]>(url, { signal });
}

export type RegionOption = { id: string; name: string };

export async function fetchRegions(signal?: AbortSignal): Promise<RegionOption[]> {
  return await apiJson<RegionOption[]>('/api/regions', { signal });
}
