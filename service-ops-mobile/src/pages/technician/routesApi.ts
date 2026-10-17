import { apiJson } from '../../shared/api/client';

export type RouteDto = {
  id: string;
  routeNumber: string;
  name: string;
  description?: string;
  status: string;
  statusLabel?: string;
  technicianId?: string;
  technicianName?: string;
  totalStops?: number;
  completedStops?: number;
  regionName?: string;
  plannedDate?: string;
  estimatedDuration?: string;
  stops?: Array<{
    id: string;
    sequence: number;
    serviceId?: string;
    address?: string;
    latitude?: number;
    longitude?: number;
    status: string;
    statusLabel?: string;
    estimatedArrival?: string;
    serviceType?: string;
    customerName?: string;
    notes?: string;
  }>;
};

export async function fetchRoutes(
  query: {
    dateFrom?: string;
    dateTo?: string;
    technicianId?: string;
    regionId?: string;
    status?: string;
  },
  signal?: AbortSignal
): Promise<RouteDto[]> {
  const params = new URLSearchParams();
  if (query.dateFrom) params.set('dateFrom', query.dateFrom);
  if (query.dateTo) params.set('dateTo', query.dateTo);
  if (query.technicianId) params.set('technicianId', query.technicianId);
  if (query.regionId) params.set('regionId', query.regionId);
  if (query.status) params.set('status', query.status);

  const qs = params.toString();
  return await apiJson<RouteDto[]>(`/api/routes${qs ? `?${qs}` : ''}`, { signal });
}

export async function fetchRouteById(id: string, signal?: AbortSignal): Promise<RouteDto> {
  return await apiJson<RouteDto>(`/api/routes/${encodeURIComponent(id)}`, { signal });
}
