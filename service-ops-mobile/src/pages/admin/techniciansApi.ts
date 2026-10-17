import { apiJson } from '../../shared/api/client';

export type TechnicianDto = {
  id: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  fullName: string;
  initials?: string;
  username?: string | null;
  email?: string | null;
  phone: string;
  avatarUrl?: string | null;
  status: string;
  statusLabel?: string;
  statusColor?: string;
  expertiseAreas?: string[];
  roles?: string[];
  primaryRegionId?: string | null;
  regionName?: string | null;
  dailyTasks?: number;
  maxDailyTasks?: number;
  plannedServicesToday?: number;
  routeStopsToday?: number;
  isCapacityAvailable?: boolean;
  completedTasks?: number;
  totalTasks?: number;
  cancelledTasks?: number;
  successRate?: number;
  totalWorkDuration?: string;
  rating?: number;
  currentLatitude?: number | null;
  currentLongitude?: number | null;
  lastLocationUpdate?: string | null;
  isActive?: boolean;
  isOnline?: boolean;
  warehouseCode?: number | null;
  warehouseName?: string | null;
  cashAccountId?: number | null;
  cashAccountName?: string | null;
  bankAccountId?: number | null;
  bankAccountName?: string | null;
  posAccountId?: number | null;
  posAccountName?: string | null;
  tenantCode?: string | null;
};

export type ErpWarehouseDto = {
  warehouseCode: number;
  name: string;
  isVehicle?: boolean;
};

export type ErpCashAccountDto = {
  id: number;
  name: string;
};

export type ErpBankAccountDto = {
  id: number;
  accountName: string;
};

export async function fetchErpWarehouses(tenantCode?: string, signal?: AbortSignal): Promise<ErpWarehouseDto[]> {
  const qs = tenantCode ? `?tenantCode=${encodeURIComponent(tenantCode)}` : '';
  const res = await apiJson<{ success: boolean; data: ErpWarehouseDto[] }>(`/api/erp/warehouses${qs}`, { signal });
  return res?.data ?? [];
}

export async function fetchErpCashAccounts(tenantCode?: string, signal?: AbortSignal): Promise<ErpCashAccountDto[]> {
  const qs = tenantCode ? `?tenantCode=${encodeURIComponent(tenantCode)}` : '';
  const res = await apiJson<{ success: boolean; data: ErpCashAccountDto[] }>(`/api/erp/cash-accounts${qs}`, { signal });
  return res?.data ?? [];
}

export async function fetchErpBankAccounts(tenantCode?: string, signal?: AbortSignal): Promise<ErpBankAccountDto[]> {
  const qs = tenantCode ? `?tenantCode=${encodeURIComponent(tenantCode)}` : '';
  const res = await apiJson<{ success: boolean; data: ErpBankAccountDto[] }>(`/api/erp/bank-accounts${qs}`, { signal });
  return res?.data ?? [];
}

export async function assignWarehouseAndAccounts(id: string, payload: {
  warehouseCode: number | null;
  warehouseName: string | null;
  cashAccountId: number | null;
  cashAccountName: string | null;
  bankAccountId: number | null;
  bankAccountName: string | null;
  posAccountId: number | null;
  posAccountName: string | null;
}): Promise<void> {
  return await apiJson<void>(`/api/technicians/${id}/warehouse`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function fetchTechnicians(status?: string, signal?: AbortSignal): Promise<TechnicianDto[]> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  return await apiJson<TechnicianDto[]>(`/api/technicians${qs}`, { signal });
}

export async function fetchTechnicianById(id: string, signal?: AbortSignal): Promise<TechnicianDto> {
  return await apiJson<TechnicianDto>(`/api/technicians/${id}`, { signal });
}

export async function updateTechnicianStatus(id: string, status: string): Promise<TechnicianDto> {
  return await apiJson<TechnicianDto>(`/api/technicians/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export async function updateTechnicianPassword(id: string, password: string): Promise<void> {
  return await apiJson<void>(`/api/technicians/${id}/password`, {
    method: 'PUT',
    body: JSON.stringify({ password }),
  });
}

export async function updateTechnicianInfo(id: string, data: {
  firstName: string;
  lastName: string;
  phone: string;
  email?: string | null;
  expertiseAreas?: string[];
  roles?: string[];
  primaryRegionId?: string | null;
  maxDailyTasks?: number;
}): Promise<TechnicianDto> {
  return await apiJson<TechnicianDto>(`/api/technicians/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function createTechnician(data: {
  firstName: string;
  lastName: string;
  phone: string;
  email?: string | null;
  expertiseAreas?: string[];
  roles?: string[];
  primaryRegionId?: string | null;
  maxDailyTasks?: number;
  username?: string;
  password?: string;
}): Promise<TechnicianDto> {
  return await apiJson<TechnicianDto>(`/api/technicians`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export type RegionOption = { id: string; name: string };
export async function fetchRegions(signal?: AbortSignal): Promise<RegionOption[]> {
  return await apiJson<RegionOption[]>('/api/regions', { signal });
}
