import { apiJson } from '../../shared/api/client';

export type RegionOption = { id: string; name: string };
export type ErpProductDto = { id: string; name: string; stockCode?: string; isInstallable?: boolean };
export type ErpDealerDto = { customerCode: string; name: string };

export async function fetchRegions(signal?: AbortSignal): Promise<RegionOption[]> {
  return await apiJson<RegionOption[]>('/api/regions', { signal });
}

export async function fetchErpProducts(signal?: AbortSignal): Promise<ErpProductDto[]> {
  const allItems: any[] = [];
  let page = 1;
  const pageSize = 200;

  while (true) {
    const json = await apiJson<{ success?: boolean; data?: { items?: any[]; totalPages?: number } | any[] }>(
      `/api/erp/products?pageSize=${pageSize}&page=${page}`,
      { signal }
    );
    const items: any[] = (json as any)?.data?.items ?? (json as any)?.items ?? (json as any)?.data ?? [];
    if (!Array.isArray(items) || items.length === 0) break;
    allItems.push(...items);
    const totalPages: number = (json as any)?.data?.totalPages ?? 1;
    if (page >= totalPages) break;
    page++;
    if (page > 20) break; // güvenlik limiti
  }

  const seen = new Set<string>();
  return allItems
    .map((p: any) => ({
      id: String(p.id ?? ''),
      name: String(p.name ?? '').trim(),
      stockCode: p.stockCode,
      isInstallable: Boolean(p.isInstallable),
    }))
    .filter((p: any) => {
      if (!p.name || !p.id) return false;
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });
}

export async function fetchErpCustomerDealers(signal?: AbortSignal): Promise<ErpDealerDto[]> {
  const json = await apiJson<any>(`/api/erp/dealers?pageSize=500`, { signal });
  const items: any[] = json?.data?.items ?? json?.data ?? json?.items ?? json ?? [];
  if (!Array.isArray(items)) return [];
  const seen = new Set<string>();
  return items
    .map((c: any, i: number) => ({
      customerCode: String(c.customerCode ?? c.code ?? c.id ?? i),
      name: String(c.name ?? c.title ?? '').trim(),
    }))
    .filter((d: any) => {
      if (!d.name) return false;
      if (seen.has(d.customerCode)) return false;
      seen.add(d.customerCode);
      return true;
    });
}
