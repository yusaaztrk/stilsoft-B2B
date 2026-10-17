import { apiFetch, apiJson } from '../../shared/api/client';

export type StockItemDto = {
  type: 'Product' | 'SparePart';
  id: string;
  productId: string;   // for Products: stockCode; for SpareParts: parent stockCode (kod4)
  productName: string;
  name: string;
  partNumber?: string | null;
  quantity?: number | null;
  minStockLevel?: number | null;
  explodedViewPartNumber?: string | null;
  imageUrl?: string | null;
  explodedDiagramUrl?: string | null;
};

const SPARE_PART_GROUP = 'servis yedek parca malzeme';
function normalizeGroup(g: string) {
  return g.trim().toLowerCase().replace(/_/g, ' ');
}
function looksLikeUrl(v: string) {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return false;
  return s.startsWith('http://') || s.startsWith('https://') || s.startsWith('data:') || s.startsWith('blob:') || s.startsWith('/');
}

export async function fetchStockItems(q?: string, signal?: AbortSignal): Promise<StockItemDto[]> {
  const qs = new URLSearchParams({ pageSize: '500', page: '1' });
  if (q) qs.set('q', q);

  let res: Response;
  try {
    res = await apiFetch(`/api/erp/products?${qs.toString()}`, { signal } as any);
  } catch {
    return [];
  }

  if (!res.ok) return [];

  try {
    const json = await res.json();
    const raw: any[] = json?.data?.items ?? json?.items ?? [];
    if (!Array.isArray(raw)) return [];

    const seen = new Set<string>();
    const items: StockItemDto[] = [];

    for (const p of raw) {
      const id = String(p.id ?? '');
      if (!id || seen.has(id)) continue;
      seen.add(id);

      const name = String(p.name ?? '').trim();
      const stockCode = String(p.stockCode ?? '').trim();
      const kod4 = p.kod4 ? String(p.kod4).trim() : null; // parent stock code for spare parts
      const kod5 = p.kod5 ? String(p.kod5).trim() : null; // exploded view part number

      const isSparePartByGroup = normalizeGroup(String(p.groupCode ?? '')) === SPARE_PART_GROUP;
      const isSparePartByKod4 = Boolean(kod4 && !looksLikeUrl(kod4));
      const isSparePart = isSparePartByGroup || isSparePartByKod4;

      if (isSparePart) {
        items.push({
          type: 'SparePart',
          id,
          productId: kod4 ?? '', // parent product stock code used for grouping
          productName: kod4 ?? '',
          name,
          partNumber: stockCode || null,
          quantity: typeof p.stock === 'number' ? p.stock : null,
          minStockLevel: typeof p.minStock === 'number' ? p.minStock : null,
          explodedViewPartNumber: kod5,
          imageUrl: p.imageUrl ?? null,
          explodedDiagramUrl: p.explodedDiagramUrl ?? null,
        });
      } else {
        items.push({
          type: 'Product',
          id,
          productId: stockCode || id, // use stock code as productId for grouping
          productName: name,
          name,
          partNumber: stockCode || null,
          quantity: null,
          minStockLevel: null,
          explodedViewPartNumber: kod5,
          imageUrl: p.imageUrl ?? null,
          explodedDiagramUrl: p.explodedDiagramUrl ?? null,
        });
      }
    }

    return items;
  } catch {
    return [];
  }
}

export type SparePartOrderRequestDto = {
  id: string;
  tenantCode?: string;
  technicianName: string;
  erpProductId: string;
  stockCode: string;
  partName: string;
  quantityRequested: number;
  status: string;
  createdAt: string;
  completedAt?: string | null;
};

export async function fetchSparePartOrderRequests(status?: string, signal?: AbortSignal): Promise<SparePartOrderRequestDto[]> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  const res = await apiJson<{ success: boolean; data: SparePartOrderRequestDto[] }>(`/api/SparePartOrderRequests${qs}`, { signal } as any);
  const list = (res as any)?.data ?? [];
  return Array.isArray(list) ? list : [];
}

export async function createSparePartOrderRequest(payload: {
  erpProductId: string;
  stockCode: string;
  partName: string;
  quantityRequested: number;
}): Promise<{ id: string } | null> {
  const res = await apiJson<{ success: boolean; data?: { id: string } }>(`/api/SparePartOrderRequests`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return res?.data?.id ? { id: res.data.id } : null;
}

export async function fetchTechnicianStockItems(q?: string, signal?: AbortSignal): Promise<StockItemDto[]> {
  const qs = q ? `?q=${encodeURIComponent(q)}` : '';
  const res = await apiJson<{ success: boolean; data: any[] }>(`/api/erp/technician-stock${qs}`, { signal } as any);
  const raw = res?.data ?? [];
  if (!Array.isArray(raw)) return [];
  return raw.map((p) => ({
    type: p.type ?? 'Product',
    id: String(p.id ?? ''),
    productId: String(p.productId ?? ''),
    productName: String(p.productName ?? ''),
    name: String(p.name ?? ''),
    partNumber: String(p.partNumber ?? ''),
    quantity: typeof p.quantity === 'number' ? p.quantity : null,
    minStockLevel: typeof p.minStockLevel === 'number' ? p.minStockLevel : null,
  }));
}

export type TechnicianSalePayload = {
  customerCode: string;
  paymentMethod: string; // 'Cash' | 'Bank' | 'OpenAccount'
  usePos?: boolean;
  cashAmount?: number;
  lines: {
    stockCode: string;
    quantity: number;
  }[];
};

export async function createTechnicianSale(payload: TechnicianSalePayload): Promise<{ success: boolean; message?: string }> {
  return await apiJson<{ success: boolean; message?: string }>('/api/erp/technician-sale', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export type CalculatePricesPayload = {
  customerCode: string;
  stockCodes: string[];
};

export type CalculatePricesResponseDto = {
  stockCode: string;
  unitPrice: number;
  currency: string;
  unitPriceTry: number;
  taxRate: number;
};

export async function calculateTechnicianSalePrices(
  payload: CalculatePricesPayload,
  signal?: AbortSignal
): Promise<{ success: boolean; data: CalculatePricesResponseDto[] }> {
  return await apiJson<{ success: boolean; data: CalculatePricesResponseDto[] }>(
    '/api/erp/technician-sale/calculate-prices',
    {
      method: 'POST',
      body: JSON.stringify(payload),
      signal,
    } as any
  );
}

export async function fetchTechnicianStockItemsAdmin(
  technicianId: string,
  q?: string,
  signal?: AbortSignal
): Promise<StockItemDto[]> {
  const qs = q ? `?q=${encodeURIComponent(q)}` : '';
  const res = await apiJson<{ success: boolean; data: any[] }>(
    `/api/erp/admin/technician-stock/${technicianId}${qs}`,
    { signal } as any
  );
  const raw = res?.data ?? [];
  if (!Array.isArray(raw)) return [];
  return raw.map((p) => ({
    type: p.type ?? 'Product',
    id: String(p.id ?? ''),
    productId: String(p.productId ?? ''),
    productName: String(p.productName ?? ''),
    name: String(p.name ?? ''),
    partNumber: String(p.partNumber ?? ''),
    quantity: typeof p.quantity === 'number' ? p.quantity : null,
    minStockLevel: typeof p.minStockLevel === 'number' ? p.minStockLevel : null,
  }));
}

export async function createTechnicianSaleAdmin(
  technicianId: string,
  payload: TechnicianSalePayload
): Promise<{ success: boolean; message?: string }> {
  return await apiJson<{ success: boolean; message?: string }>(
    `/api/erp/admin/technician-sale/${technicianId}`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    }
  );
}

export async function calculateTechnicianSalePricesAdmin(
  technicianId: string,
  payload: CalculatePricesPayload,
  signal?: AbortSignal
): Promise<{ success: boolean; data: CalculatePricesResponseDto[] }> {
  return await apiJson<{ success: boolean; data: CalculatePricesResponseDto[] }>(
    `/api/erp/admin/technician-sale/calculate-prices/${technicianId}`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
      signal,
    } as any
  );
}

