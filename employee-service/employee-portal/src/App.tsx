import { Navigate, Route, Routes } from 'react-router-dom'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import EmployeesPage from './pages/EmployeesPage'
import EmployeeMePage from './pages/EmployeeMePage'
import QrTestPage from './pages/QrTestPage'
import QrCheckInPage from './pages/QrCheckInPage'
import QrAttendancePage from './pages/QrAttendancePage'
import FaceCheckInPage from './pages/FaceCheckInPage'
import FaceCheckOutPage from './pages/FaceCheckOutPage'
import LocationSettingsPage from './pages/LocationSettingsPage'
import WorkCalendarPage from './pages/WorkCalendarPage'
import AccrualsPage from './pages/AccrualsPage'
import WorkSchedulesPage from './pages/WorkSchedulesPage'
import PaymentsSalaryPage from './pages/PaymentsSalaryPage'
import PaymentsBonusPage from './pages/PaymentsBonusPage'
import PaymentsMealPage from './pages/PaymentsMealPage'
import PaymentsAdvancePage from './pages/PaymentsAdvancePage'
import EmployeeLedgerPage from './pages/EmployeeLedgerPage'
import CashTransactionsPage from './pages/CashTransactionsPage'
import FaceLinkPage from './pages/FaceLinkPage'
import LeavesPage from './pages/LeavesPage'
import { canViewPage, firstAllowedRoute, isErpManagerSession } from './utils/portalPermissions'

const STORAGE_KEY = 'accessToken'

function isAuthed(): boolean {
  try {
    return Boolean(String(localStorage.getItem(STORAGE_KEY) ?? '').trim())
  } catch {
    return false
  }
}

function loginAs(): 'employee' | 'admin' {
  try {
    const v = String(localStorage.getItem('portalLoginAs') ?? '').trim().toLowerCase()
    return v === 'employee' ? 'employee' : 'admin'
  } catch {
    return 'admin'
  }
}

function isRole(role: 'employee' | 'admin'): boolean {
  return isAuthed() && loginAs() === role
}

/**
 * Yonetici sayfasinin kapisi: once rol (`admin`), sonra ROLUN o sayfaya yetkisi.
 *
 * Yetkisi yoksa `/login`'e degil gorebildigi ILK sayfaya gonderilir — oturum gecerli,
 * eksik olan tek bir sayfanin yetkisi. Gorebildigi hicbir sayfa yoksa cikisa dusurulur.
 */
function adminPage(pageKey: string, element: JSX.Element): JSX.Element {
  if (!isAuthed()) return <Navigate to="/login" replace />
  if (isRole('employee')) return <Navigate to="/qr-checkin" replace />
  if (canViewPage(pageKey)) return element
  const fallback = firstAllowedRoute()
  return <Navigate to={fallback ?? '/login'} replace />
}

/**
 * Girisin varsayilan hedefi. ERP yoneticisinin personel kaydi YOK: self-servis sayfalari
 * (Bilgilerim, QR Okut) yer tutucu personelin verisini gosterirdi, oraya hic gonderilmez.
 */
function defaultRoute(): string {
  if (!isAuthed()) return '/login'
  if (loginAs() === 'employee') return '/qr-checkin'
  return firstAllowedRoute() ?? (isErpManagerSession() ? '/login' : '/dashboard')
}

export default function App() {
  return (
    <Routes>
      <Route path="/tenant" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/qr-attendance" element={<QrAttendancePage />} />
      <Route
        path="/qr-checkin"
        element={isRole('employee') ? <QrCheckInPage /> : isRole('admin') ? <Navigate to="/qr-checkin" replace /> : <Navigate to="/login" replace />}
      />
      <Route path="/face-checkin" element={<FaceCheckInPage />} />
      <Route path="/face-checkout" element={<FaceCheckOutPage />} />
      <Route
        path="/me"
        element={isRole('employee') ? <EmployeeMePage /> : isRole('admin') ? <Navigate to={defaultRoute()} replace /> : <Navigate to="/login" replace />}
      />
      <Route
        path="/dashboard"
        element={adminPage('personelPanel', <DashboardPage />)}
      />
      <Route
        path="/employees"
        element={adminPage('personelCalisanlar', <EmployeesPage />)}
      />
      <Route
        path="/qr-test"
        element={adminPage('personelQrTest', <QrTestPage />)}
      />
      <Route
        path="/work-schedules"
        element={adminPage('personelMesaiTanimlari', <WorkSchedulesPage />)}
      />
      <Route
        path="/work-calendar"
        element={adminPage('personelTatilTakvimi', <WorkCalendarPage />)}
      />
      <Route
        path="/accruals"
        element={adminPage('personelHakedis', <AccrualsPage />)}
      />
      <Route
        path="/payments/salary"
        element={adminPage('personelMaas', <PaymentsSalaryPage />)}
      />
      <Route
        path="/payments/bonus"
        element={adminPage('personelPrim', <PaymentsBonusPage />)}
      />
      <Route
        path="/payments/meal"
        element={adminPage('personelYemek', <PaymentsMealPage />)}
      />
      <Route
        path="/payments/advance"
        element={adminPage('personelAvans', <PaymentsAdvancePage />)}
      />
      <Route
        path="/ledger"
        element={adminPage('personelEkstre', <EmployeeLedgerPage />)}
      />
      <Route
        path="/leaves"
        element={adminPage('personelIzinler', <LeavesPage />)}
      />
      <Route
        path="/face-link"
        element={adminPage('personelYuzLink', <FaceLinkPage />)}
      />
      <Route
        path="/cash-transactions"
        element={adminPage('personelKasa', <CashTransactionsPage />)}
      />
      <Route
        path="/location-settings"
        element={adminPage('personelKonumAyarlari', <LocationSettingsPage />)}
      />
      <Route
        path="/"
        element={<Navigate to={defaultRoute()} replace />}
      />
    </Routes>
  )
}
