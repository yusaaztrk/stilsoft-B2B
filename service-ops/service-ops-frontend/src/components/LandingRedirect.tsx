import { Navigate } from 'react-router-dom'
import { ShieldOff } from 'lucide-react'
import { usePermissions } from '../auth/PermissionsContext'
import { firstAccessibleRoute } from '../auth/pagePermissions'

/**
 * What '/' does now that there is no dashboard.
 *
 * Rather than pointing everyone at one fixed page — which would land half the roles on a screen
 * they are not allowed to open — this resolves to the first route the session can actually
 * reach, in menu order.
 *
 * It waits for permissions before deciding. An earlier version of this idea redirected off the
 * menu's first entry while the permission list was still empty, so everyone was sent to the
 * same page for a moment and some sessions never recovered from it.
 */
export default function LandingRedirect() {
  const { loaded, allowedPageKeys, isSuperAdmin } = usePermissions()

  if (!loaded) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/15 border-t-white/70" />
      </div>
    )
  }

  const target = firstAccessibleRoute(allowedPageKeys, isSuperAdmin)

  if (target) return <Navigate to={target} replace />

  // No page at all. Shown rather than redirected, because every candidate redirect would come
  // straight back here and spin.
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-amber-400/20 bg-amber-400/10">
          <ShieldOff className="text-amber-300" size={26} />
        </div>
        <h2 className="mb-2 text-lg font-bold text-white">Görüntüleyebileceğiniz sayfa yok</h2>
        <p className="text-sm leading-relaxed text-white/50">
          Rolünüze henüz hiçbir servis ekranı tanımlanmamış. Yöneticinizden yetki talep edin.
        </p>
      </div>
    </div>
  )
}
