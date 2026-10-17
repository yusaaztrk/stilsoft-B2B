import { apiJson } from '../../shared/api/client';

export type RouteListItemDto = {
  id: string;
  routeNumber: string;
  name: string;
  status: string;
  statusLabel?: string;
  technicianName?: string | null;
  totalStops: number;
  completedStops: number;
  regionName?: string | null;
  plannedDate: string;
  estimatedDuration?: string | null;
};

export async function fetchRoutes(filter: {
  dateFrom?: string;
  dateTo?: string;
  technicianId?: string;
  regionId?: string;
  status?: string;
}, signal?: AbortSignal): Promise<RouteListItemDto[]> {
  const qs = new URLSearchParams();
  if (filter.dateFrom) qs.set('dateFrom', filter.dateFrom);
  if (filter.dateTo) qs.set('dateTo', filter.dateTo);
  if (filter.technicianId) qs.set('technicianId', filter.technicianId);
  if (filter.regionId) qs.set('regionId', filter.regionId);
  if (filter.status) qs.set('status', filter.status);

  const q = qs.toString();
  return await apiJson<RouteListItemDto[]>(`/api/routes${q ? `?${q}` : ''}`, { signal });
}

export type RegionOption = {
  id: string;
  name: string;
  centerLatitude?: number | null;
  centerLongitude?: number | null;
};

export async function fetchRegions(signal?: AbortSignal): Promise<RegionOption[]> {
  return await apiJson<RegionOption[]>('/api/regions', { signal });
}
