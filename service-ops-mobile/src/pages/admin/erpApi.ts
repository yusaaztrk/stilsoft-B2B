import { apiJson } from '../../shared/api/client';

export type ErpProduct = {
  id?: string;
  name: string;
  isInstallable: boolean;
};

let _cache: ErpProduct[] | null = null;

export async function fetchErpProducts(signal?: AbortSignal): Promise<ErpProduct[]> {
  if (_cache) return _cache;
  try {
    const json = await apiJson<any>('/api/erp/products?pageSize=1000', { signal });
    const items: any[] = json?.data?.items ?? json?.items ?? json?.data ?? json ?? [];
    if (!Array.isArray(items)) return [];
    _cache = items.map((p: any) => ({
      id: String(p.id ?? ''),
      name: String(p.name ?? '').trim(),
      isInstallable: Boolean(p.isInstallable)
    })).filter(p => p.name);
    return _cache;
  } catch {
    return [];
  }
}

/** Invalidate cache (call after any ERP product change) */
export function invalidateErpCache() {
  _cache = null;
}

export function getInstallableNames(products: ErpProduct[]): Set<string> {
  return new Set(
    products.filter((p) => p.isInstallable).map((p) => p.name.trim().toLowerCase())
  );
}
