import { Link, Outlet, useLocation } from 'react-router-dom'
import { ShieldOff } from 'lucide-react'
import { usePermissions } from '../auth/PermissionsContext'

/**
 * Route-level permission gate.
 *
 * Permissions only ever hid menu links, so every page stayed reachable by typing its address —
 * including the sub-pages a role was deliberately kept out of. This runs for the route itself,
 * which is the only place that cannot be walked around.
 *
 * It reads the key off the path via the shared map rather than taking one per route, so a route
 * cannot be added with the guard attached but no key decided.
 */
export default function RequirePage() {
  const { loaded, canOpen, isSuperAdmin } = usePermissions()
  const location = useLocation()

  // Nothing is granted until the answer is in. Rendering the page first and correcting after
  // would flash content the user may not open, and any write it fired on mount would already
  // have gone out.
  if (!loaded) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/15 border-t-white/70" />
          <div className="text-xs font-semibold text-white/50">Yetkiler kontrol ediliyor…</div>
        </div>
      </div>
    )
  }

  // Tek kapı rol yetkileri. Buradaki ikinci kapı (teknisyen rota listesi) kaldırıldı: rolde
  // açıkça verilmiş bir sayfayı da kapatıyordu ve reddedilme sebebi hiçbir ekranda görünmüyordu.
  if (!canOpen(location.pathname)) {
    // Shown rather than redirected: bouncing the user to the dashboard looked exactly like the
    // page failing to open, which is how a permission problem got reported as a broken screen.
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-6">
        <div className="w-full max-w-md rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1E293B] p-8 text-center shadow-lg">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/20">
            <ShieldOff className="text-amber-600 dark:text-amber-400" size={26} />
          </div>
          <h2 className="mb-2 text-lg font-bold text-slate-900 dark:text-white">Bu sayfaya erişim yetkiniz yok</h2>
          <p className="mb-6 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
            Sayfa açılmadı çünkü rolünüze bu ekran tanımlanmamış. Erişmeniz gerekiyorsa yöneticinizden
            yetki talep edin.
          </p>
          <Link
            to="/"
            className="inline-flex h-11 items-center justify-center rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-100 px-6 text-sm font-bold text-white dark:text-slate-900 transition-all active:scale-95 shadow-sm"
          >
            Ana sayfaya dön
          </Link>
        </div>
      </div>
    )
  }

  return <Outlet />
}
