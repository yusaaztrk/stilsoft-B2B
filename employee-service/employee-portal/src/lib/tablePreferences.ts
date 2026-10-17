import { useCallback, useEffect, useState } from 'react'
import { API_BASE_URL } from '../config/api'

/*
  PERSONEL PROGRAMI EŞİ (2026-10-14 kullanıcı isteği). Servis'teki `lib/tablePreferences.ts` ile
  mantık AYNI; yalnız oturum bilgisi burada localStorage'dan ve token'ın kendisinden okunuyor.
  Sunucu ucu personel API'sinde (`/api/user-table-preferences`, satırlar "p:" önekli).
*/
function getAccessToken(): string | null {
  try {
    return localStorage.getItem('accessToken')
  } catch {
    return null
  }
}

function getTenantCode(): string | null {
  try {
    return localStorage.getItem('tenantCode')
  } catch {
    return null
  }
}

/** Kullanıcı adı token'dan: sunucu da anahtarı aynı iddiadan (name) kuruyor. */
function getUsername(): string | null {
  const token = getAccessToken()
  if (!token) return null
  try {
    const part = token.split('.')[1] ?? ''
    const json = decodeURIComponent(
      atob(part.replace(/-/g, '+').replace(/_/g, '/'))
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    )
    const p = JSON.parse(json)
    const name =
      p['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name'] ?? p.unique_name ?? p.name ?? p.sub ?? null
    return name ? String(name) : null
  } catch {
    return null
  }
}

/*
  TABLO AYARLARI — KULLANICI BAZLI (2026-10-11, kullanıcı isteği). B2B arayüzündeki
  `frontend/src/lib/tablePreferences.ts` dosyasının Servis eşi: mantık AYNI kalmalı, yalnız
  oturum bilgisinin okunduğu yer farklı (auth/storage).

  Her tablonun sol altındaki ayar düğmesinden yapılan seçimler burada tutulur: gizlenen sütunlar,
  sütun sırası, sütun genişlikleri. Kullanıcı sayfaya tekrar geldiğinde tablo aynı ayarla açılır.

  İKİ KATMAN:
   - Tarayıcı (localStorage): tablo İLK çizimde ayarlı açılsın, sunucu cevabı beklenip sütunlar
     gözün önünde yer değiştirmesin.
   - Sunucu (`/api/user-table-preferences`): başka bilgisayardan girince de aynı ayar gelsin.
     Girişten sonra bir kez çekilir ve tarayıcıdakinin ÜZERİNE yazar (sunucu esas).

  Kapsam kullanıcı + firma: aynı tarayıcıda başka kullanıcı girince öncekinin ayarı görünmez.
  Sunucuya ulaşılamazsa sessizce tarayıcıdaki ayarla devam edilir — görünüm tercihi, işi durdurmaz.
*/

export type TablePrefs = {
  /** Gizlenen sütun kimlikleri. */
  hidden?: string[]
  /** Sütunların kullanıcı sırası (kimlikler). Listede olmayan sütun varsayılan yerinde kalır. */
  order?: string[]
  /** Elle verilen genişlikler, piksel. */
  widths?: Record<string, number>
}

type Store = Record<string, TablePrefs>

const listeners = new Set<() => void>()
let scopeLoaded = ''
let store: Store = {}
let serverLoad: Promise<void> | null = null
const pendingSaves = new Map<string, number>()

function scope(): string {
  try {
    const tenant = String(getTenantCode() ?? '').trim()
    // Sunucu da kullanıcı ADIYLA saklıyor (devirle gelen ve yerel kullanıcıda ortak tek kimlik).
    const user = String(getUsername() ?? '').trim().toLowerCase()
    return user ? `${tenant}|${user}` : ''
  } catch {
    return ''
  }
}

const storageKey = (s: string) => `tablePrefs:v1:${s}`

function readLocal(s: string): Store {
  try {
    const raw = localStorage.getItem(storageKey(s))
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === 'object' ? (parsed as Store) : {}
  } catch {
    return {}
  }
}

function writeLocal() {
  if (!scopeLoaded) return
  try {
    localStorage.setItem(storageKey(scopeLoaded), JSON.stringify(store))
  } catch {
    /* kota dolu ya da gizli sekme: sunucu kaydı yine çalışır */
  }
}

function notify() {
  listeners.forEach((fn) => fn())
}

async function request(method: 'GET' | 'PUT', body?: unknown): Promise<any> {
  const token = getAccessToken()
  if (!token) return null
  const tenantCode = String(getTenantCode() ?? '').trim()
  const res = await fetch(`${API_BASE_URL}/api/user-table-preferences`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(tenantCode ? { 'X-Tenant-Code': tenantCode } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  })
  if (!res.ok) return null
  return res.json().catch(() => null)
}

/** Kapsam (kullanıcı) değiştiyse belleği o kullanıcının kaydıyla yeniden kur ve sunucudan tazele. */
function ensureScope() {
  const s = scope()
  if (s === scopeLoaded) return
  scopeLoaded = s
  store = s ? readLocal(s) : {}
  serverLoad = null
  if (!s) return
  serverLoad = request('GET')
    .then((json) => {
      const data = json?.data
      if (!data || typeof data !== 'object' || scopeLoaded !== s) return
      // Sunucu esas; ama henüz gönderilmemiş (bekleyen) yerel değişiklik ezilmez.
      const next: Store = { ...(data as Store) }
      for (const key of pendingSaves.keys()) {
        if (store[key]) next[key] = store[key]
        else delete next[key]
      }
      store = next
      writeLocal()
      notify()
    })
    .catch(() => {
      /* sunucu yoksa tarayıcıdaki ayarla devam */
    })
}

function isEmpty(p: TablePrefs | null | undefined): boolean {
  if (!p) return true
  return !(p.hidden?.length || p.order?.length || (p.widths && Object.keys(p.widths).length))
}

export function getTablePrefs(key: string): TablePrefs {
  ensureScope()
  return store[key] ?? EMPTY
}

const EMPTY: TablePrefs = Object.freeze({})

export function setTablePrefs(key: string, prefs: TablePrefs | null) {
  ensureScope()
  if (!scopeLoaded) return
  const clean = isEmpty(prefs) ? null : (prefs as TablePrefs)
  if (clean) store = { ...store, [key]: clean }
  else {
    const { [key]: _removed, ...rest } = store
    store = rest
  }
  writeLocal()
  notify()

  // Sürükleyerek genişlik ayarlarken art arda onlarca değişiklik gelir: sonuncusu gönderilir.
  const prev = pendingSaves.get(key)
  if (prev) window.clearTimeout(prev)
  const savedScope = scopeLoaded
  pendingSaves.set(
    key,
    window.setTimeout(() => {
      pendingSaves.delete(key)
      if (scopeLoaded !== savedScope) return
      void request('PUT', { key, value: store[key] ?? null }).catch(() => undefined)
    }, 700)
  )
}

/** Bileşen için: [ayar, değiştir]. Ayar başka sekmede/sunucudan güncellenince yeniden çizer. */
export function useTablePrefs(key: string | null): [TablePrefs, (next: TablePrefs | null) => void] {
  const [, force] = useState(0)
  useEffect(() => {
    if (!key) return
    const fn = () => force((x) => x + 1)
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  }, [key])
  const set = useCallback((next: TablePrefs | null) => { if (key) setTablePrefs(key, next) }, [key])
  return [key ? getTablePrefs(key) : EMPTY, set]
}

/**
 * Tablonun anahtarı: sayfa yolu + ilk sütunların kimlikleri.
 *
 * Bütün sütunlar DEĞİL yalnız ilk dördü: tabloya yeni bir sütun eklendiğinde (her pakette olur)
 * anahtar değişmesin, kullanıcının ayarı kaybolmasın. Aynı sayfada aynı ilk sütunlarla açılan
 * iki tablo (ör. Bekleyen / Tamamlanan sekmeleri) ayarı paylaşır — istenen de bu.
 * Yoldaki kayıt numaraları (/cari/123) atılır: her kayıt için ayrı ayar tutulmaz.
 */
export function tablePrefsKey(columnIds: string[]): string {
  let path = '/'
  try {
    path = window.location.pathname || '/'
  } catch {
    /* sunucu tarafı çizim yok; yine de güvenli kal */
  }
  const normalized = path
    .split('/')
    .map((seg) => (/^\d+$/.test(seg) || /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(seg) ? ':id' : seg))
    .join('/')
    .toLowerCase()
  return `${normalized}|${columnIds.slice(0, 4).join(',')}`.slice(0, 280)
}
