import { Suspense, lazy } from 'react'
import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import StilsoftShell from './components/StilsoftShell'
import SharedSessionGuard from './components/SharedSessionGuard'
import RequireAuth from './components/RequireAuth'
import RequirePage from './components/RequirePage'
import { PermissionsProvider } from './auth/PermissionsContext'
import { StatusChangeConfirmProvider } from './components/StatusChangeConfirm'
import LandingRedirect from './components/LandingRedirect'
import { Toaster } from './components/ui/sonner'
import LoginPage from './pages/LoginPage'
import { useSignalR } from './hooks/useSignalR'

/**
 * Everything past the entry screens is loaded on demand.
 *
 * All 24 pages used to be imported eagerly into a single 1.4 MB bundle, so opening the login
 * form downloaded the workshop, stock and reporting screens as well. Login and the dashboard
 * stay eager because they are what the first paint needs; the rest arrive when routed to.
 */
const UrunKabulPage = lazy(() => import('./pages/UrunKabulPage'))
const SahaArizaPage = lazy(() => import('./pages/SahaArizaPage'))
const AtolyeArizaPage = lazy(() => import('./pages/AtolyeArizaPage'))
const MontajYonetimiPage = lazy(() => import('./pages/MontajYonetimiPage'))
const MontajGecmisiPage = lazy(() => import('./pages/MontajGecmisiPage'))
const MontajKabulPage = lazy(() => import('./pages/MontajKabulPage'))
const KargoKabulPage = lazy(() => import('./pages/KargoKabulPage'))
const KargoTakibiPage = lazy(() => import('./pages/KargoTakibiPage'))
const TeknisyenlerPage = lazy(() => import('./pages/TeknisyenlerPage'))
const TeknisyenDepoPage = lazy(() => import('./pages/TeknisyenDepoPage'))
const TahsilatPage = lazy(() => import('./pages/TahsilatPage'))
const HizliServisPage = lazy(() => import('./pages/HizliServisPage'))
const GunlukTahsilatlarPage = lazy(() => import('./pages/GunlukTahsilatlarPage'))
const MusterilerPage = lazy(() => import('./pages/MusterilerPage'))
const StokPage = lazy(() => import('./pages/StokPage'))
const RaporlarPage = lazy(() => import('./pages/RaporlarPage'))
const RaporlarLayout = lazy(() => import('./pages/raporlar/RaporlarLayout'))
const GenelOzetPage = lazy(() => import('./pages/raporlar/GenelOzetPage'))
const DrillDownPage = lazy(() => import('./pages/raporlar/DrillDownPage'))
const MontajRaporPage = lazy(() => import('./pages/raporlar/MontajRaporPage'))
const ArizaRaporPage = lazy(() => import('./pages/raporlar/ArizaRaporPage'))
const KargoRaporPage = lazy(() => import('./pages/raporlar/KargoRaporPage'))
const BayiRaporPage = lazy(() => import('./pages/raporlar/BayiRaporPage'))
const BayiDetayPage = lazy(() => import('./pages/raporlar/BayiDetayPage'))
const TeknisyenRaporPage = lazy(() => import('./pages/raporlar/TeknisyenRaporPage'))
const TeknisyenDetayPage = lazy(() => import('./pages/raporlar/TeknisyenDetayPage'))
const UrunRaporPage = lazy(() => import('./pages/raporlar/UrunRaporPage'))
const UrunDetayPage = lazy(() => import('./pages/raporlar/UrunDetayPage'))
const SureAnaliziPage = lazy(() => import('./pages/raporlar/SureAnaliziPage'))
const IptalAnaliziPage = lazy(() => import('./pages/raporlar/IptalAnaliziPage'))
const YedekParcaRaporPage = lazy(() => import('./pages/raporlar/YedekParcaRaporPage'))
const TrendRaporPage = lazy(() => import('./pages/raporlar/TrendRaporPage'))
const AnalizPage = lazy(() => import('./pages/AnalizPage'))
const AyarlarPage = lazy(() => import('./pages/AyarlarPage'))
const PlanlamaPage = lazy(() => import('./pages/PlanlamaPage'))
const TeknisyenTakipPage = lazy(() => import('./pages/TeknisyenTakipPage'))
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'))
const SilinenKayitlarPage = lazy(() => import('./pages/SilinenKayitlarPage'))
const KullaniciHareketleriPage = lazy(() => import('./pages/KullaniciHareketleriPage'))
const HakedisPage = lazy(() => import('./pages/HakedisPage'))
const FaturaTakipPage = lazy(() => import('./pages/FaturaTakipPage'))
const PersonelEkstrePage = lazy(() => import('./pages/PersonelEkstrePage'))
const DashboardPage = lazy(() => import('./pages/DashboardPage'))

function PageFallback() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/15 border-t-white/70" />
    </div>
  )
}

/**
 * The shell as a layout route.
 *
 * Every route used to wrap its own copy of the shell, so each navigation unmounted and rebuilt
 * the entire chrome — sidebar, session lookup, splash timer and the permission request with it.
 * Mounted once here, it survives navigation and the permission fetch happens a single time per
 * session instead of once per click.
 */
function ShellLayout() {
  // Live sync belongs to the signed-in app. Started from the root component it also ran on the
  // login screen, where there is no session to sync, and retried the handshake on a backoff
  // loop for as long as the user sat on that page.
  useSignalR()

  return (
    <StilsoftShell>
      {/* Bayi ile ortak oturum: geri sayım, uzatma ekranı ve karşı taraftaki çıkışın burada da
          uygulanması. Kabuğun içinde, yani teknisyen görünümü dahil her ekranda çalışır. */}
      <SharedSessionGuard />
      {/*
        Bildirim şeridi. Kabukta TEK BİR KEZ duruyor: ekranlar `toast.success/error` çağırıyor,
        kendi bildirim durumlarını taşımak zorunda kalmıyorlar.

        Buraya kadar sayfalar tarayıcının yerleşik uyarı kutusunu kullanıyordu. Üç sorunu vardı:
        sayfayı kilitliyor, mobilde tasarımın tamamen dışına düşüyor ve uzun metni taşıyamıyor.
        Bileşen zaten projede duruyordu (components/ui/sonner.tsx) ama hiçbir yere monte
        edilmemişti; `toast()` çağrıları sessizce hiçbir şey göstermezdi.
      */}
      <Toaster />
      <Suspense fallback={<PageFallback />}>
        <Outlet />
      </Suspense>
    </StilsoftShell>
  )
}

function ProtectedArea() {
  return (
    <PermissionsProvider>
      {/*
        Durum onay ekranı kökte duruyor: her sayfa kendi kopyasını kurmak zorunda kalmasın ve
        onay penceresi hangi modalın içinden çağrılırsa çağrılsın en üstte açılsın.
      */}
      <StatusChangeConfirmProvider>
        <Outlet />
      </StatusChangeConfirmProvider>
    </PermissionsProvider>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      {/* Management sign-in lives on its own address; see LoginPage for why. */}
      <Route path="/yonetim" element={<LoginPage managementEntry />} />

      <Route element={<RequireAuth />}>
        <Route element={<ProtectedArea />}>
          <Route element={<ShellLayout />}>
            {/* Initial Landing Dashboard Page ('/' greeting & module cards) */}
            <Route path="/" element={<DashboardPage />} />
            <Route path="/bildirimler" element={<NotificationsPage />} />

            {/* Everything below is gated by the route's key in ROUTE_PAGE_KEYS. */}
            <Route element={<RequirePage />}>
              <Route path="/buyuk-urun-kabul" element={<UrunKabulPage categoryFilter="large" />} />
              <Route path="/buyuk-urun-kabul/yeni" element={<UrunKabulPage categoryFilter="large" />} />
              <Route path="/kucuk-urun-kabul" element={<UrunKabulPage categoryFilter="small" />} />
              <Route path="/kucuk-urun-kabul/yeni" element={<UrunKabulPage categoryFilter="small" />} />
              <Route path="/urun-kabul" element={<Navigate to="/buyuk-urun-kabul" replace />} />
              <Route path="/saha-ariza" element={<SahaArizaPage />} />
              <Route path="/atolye-ariza" element={<AtolyeArizaPage />} />
              <Route path="/montaj-yonetimi" element={<MontajYonetimiPage />} />
              <Route path="/montaj-gecmisi" element={<MontajGecmisiPage />} />
              <Route path="/montaj-yonetimi/yeni" element={<MontajKabulPage />} />
              <Route path="/montaj-kabul" element={<MontajKabulPage />} />
              <Route path="/montaj-kabul/yeni" element={<MontajKabulPage />} />
              <Route path="/kargo-kabul" element={<KargoKabulPage />} />
              <Route path="/kargo-kabul/yeni" element={<KargoKabulPage />} />
              <Route path="/kargo-takibi" element={<KargoTakibiPage />} />
              <Route path="/kargo-takibi/yeni" element={<KargoKabulPage />} />
              <Route path="/teknisyenler" element={<TeknisyenlerPage />} />
              <Route path="/musteriler" element={<MusterilerPage />} />
              <Route path="/stok" element={<StokPage />} />
              <Route path="/arac-depolari" element={<TeknisyenDepoPage />} />
              <Route path="/tahsilat" element={<TahsilatPage />} />
              <Route path="/hizli-servis" element={<HizliServisPage />} />
              <Route path="/gunluk-tahsilatlar" element={<GunlukTahsilatlarPage />} />
              {/*
                Yeni raporlama merkezi. Eski ekran /raporlar/klasik altında bir süre daha
                duruyor: yenisi sahada doğrulanana kadar geri dönülebilir bir yol kalsın.
              */}
              <Route path="/raporlar" element={<RaporlarLayout />}>
                <Route index element={<GenelOzetPage />} />
                <Route path="montaj" element={<MontajRaporPage />} />
                {/* Büyük ve küçük ürün aynı analiz; ayrım yalnızca ürün grubunda. */}
                <Route path="buyuk-urun" element={<ArizaRaporPage productCategory="Large" />} />
                <Route path="kucuk-urun" element={<ArizaRaporPage productCategory="Small" />} />
                <Route path="kargo" element={<KargoRaporPage />} />
                <Route path="bayi" element={<BayiRaporPage />} />
                <Route path="bayi/:dealerCode" element={<BayiDetayPage />} />
                <Route path="teknisyen" element={<TeknisyenRaporPage />} />
                <Route path="teknisyen/:technicianId" element={<TeknisyenDetayPage />} />
                <Route path="urun" element={<UrunRaporPage />} />
                <Route path="urun/:stockCode" element={<UrunDetayPage />} />
                <Route path="sureler" element={<SureAnaliziPage />} />
                <Route path="iptal" element={<IptalAnaliziPage />} />
                <Route path="yedek-parca" element={<YedekParcaRaporPage />} />
                <Route path="trend" element={<TrendRaporPage />} />
                <Route path="kayitlar" element={<DrillDownPage />} />
                <Route path="klasik" element={<RaporlarPage />} />
              </Route>
              <Route path="/analiz" element={<AnalizPage />} />
              <Route path="/ayarlar" element={<AyarlarPage />} />
              <Route path="/planlama" element={<PlanlamaPage planningKind="repair" categoryFilter="small" />} />
              <Route path="/saha-ariza-planlama" element={<Navigate to="/saha-ariza" replace />} />
              <Route path="/urun-ariza-planlama" element={<Navigate to="/atolye-ariza" replace />} />
              <Route path="/montaj-planlama" element={<Navigate to="/montaj-yonetimi" replace />} />
              <Route path="/kargo-planlama" element={<Navigate to="/kargo-takibi" replace />} />
              <Route path="/teknisyen-takip" element={<TeknisyenTakipPage />} />
              <Route path="/hakedis" element={<HakedisPage />} />
              <Route path="/fatura-takip" element={<FaturaTakipPage />} />
              <Route path="/personel-ekstre" element={<PersonelEkstrePage />} />
              <Route path="/silinen-kayitlar" element={<SilinenKayitlarPage />} />
              <Route path="/kullanici-hareketleri" element={<KullaniciHareketleriPage />} />
            </Route>
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
