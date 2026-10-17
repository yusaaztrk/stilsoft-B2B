import { apiJson } from '../../shared/api/client';

export type ErpCustomerDto = {
  id: string;
  customerNumber?: string | null;
  fullName?: string | null;
  type?: string | null;
  typeLabel?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  district?: string | null;
  regionName?: string | null;
  totalServices?: number;
  lastServiceDate?: string | null;
  totalRevenue?: number;
  isActive?: boolean;
  invoiceType?: string | null;
  parentCustomerCode?: string | null;
  creditLimit?: number;
};

export async function fetchErpCustomers(filter: { q?: string; type?: string }, signal?: AbortSignal): Promise<ErpCustomerDto[]> {
  const qs = new URLSearchParams();
  if (filter.q) qs.set('q', filter.q);
  if (filter.type) qs.set('type', filter.type);
  const res = await apiJson<ErpCustomerDto[]>(`/api/erp/customers?${qs.toString()}`, { signal });
  return Array.isArray(res) ? res : [];
}

export type CreateErpCustomerPayload = {
  customerType: string;
  invoiceType: string;
  isActive: boolean;
  discountRate?: number;
  creditLimit?: number;
  currencyTypeId?: number;
  productCategoryIds?: number[];
  name: string;
  phone: string;
  customerCode?: string;
  taxOffice?: string;
  taxNumber?: string;
  priceGroupId?: string;
  city?: string;
  district?: string;
  address?: string;
};

export async function createErpCustomer(payload: CreateErpCustomerPayload): Promise<ErpCustomerDto> {
  const res = await apiJson<{ success: boolean; data?: ErpCustomerDto; message?: string }>('/api/erp/customers', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (res && res.success && res.data) {
    return res.data;
  }
  throw new Error(res?.message || 'Cari kart oluşturulamadı.');
}

export async function fetchNextCustomerCode(customerType: string = 'Müşteri'): Promise<{ customerCode: string }> {
  return await apiJson<{ customerCode: string }>(`/api/erp/customers/next-code?customerType=${encodeURIComponent(customerType)}`);
}

export async function fetchPriceGroups(): Promise<any[]> {
  const res = await apiJson<any>('/api/erp/price-groups');
  return Array.isArray(res) ? res : res?.data ?? [];
}


