import { apiJson } from '../../shared/api/client';

export type TenantPublicDto = {
  code: string;
  name: string;
};

export async function fetchPublicTenants(signal?: AbortSignal): Promise<TenantPublicDto[]> {
  const json = await apiJson<{ data?: TenantPublicDto[] }>(`/api/tenants/public`, { signal });
  return (json?.data as TenantPublicDto[] | undefined) ?? [];
}

export type LoginUser = {
  id: string;
  name: string;
  role: string;
  technicianId?: string;
  roles?: string[];
  technicianRoles?: string[];
};

export type LoginResponse = {
  accessToken: string;
  expiresAt: string;
  user?: LoginUser;
  role?: string;
  technicianId?: string;
  tenantCode?: string;
  userId?: string;
  username?: string;
  technicianRoles?: string[];
};

export async function loginUser(payload: {
  username: string;
  password: string;
  tenantCode?: string;
}): Promise<LoginResponse> {
  return await apiJson<LoginResponse>(`/api/auth/login`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function loginTechnician(payload: {
  username: string;
  password: string;
  tenantCode?: string;
}): Promise<LoginResponse> {
  return await apiJson<LoginResponse>(`/api/auth/technician-login`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
