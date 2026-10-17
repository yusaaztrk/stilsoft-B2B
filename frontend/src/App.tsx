import { Navigate, Route, Routes } from 'react-router-dom'
import RequireAuth from './components/RequireAuth'
import AppLayout from './components/layout/AppLayout'
import BankPage from './pages/BankPage'
import LoansPage from './pages/LoansPage'
import BankExpensesPage from './pages/BankExpensesPage'
import LoanScheduleReport from './pages/LoanScheduleReport'
import HizmetHarcamaRaporu from './pages/HizmetHarcamaRaporu'
import CashPage from './pages/CashPage'
import CheckPage from './pages/CheckPage'
import InvoiceListPage from './pages/InvoiceListPage'
import InvoicePage from './pages/InvoicePage'
import CustomerOfferPage from './pages/CustomerOfferPage'
import CariOfferPage from './pages/CariOfferPage'
import BayiTeklifleriPage from './pages/BayiTeklifleriPage'
import HomePage from './pages/HomePage'
import LoginPage from './pages/LoginPage'
import PrintPreviewPage from './pages/PrintPreviewPage'
import NotFoundPage from './pages/NotFoundPage'
import PosPage from './pages/PosPage'
import ProfilePage from './pages/ProfilePage'
import ReportsLayoutPage from './pages/ReportsLayoutPage'
import OrderReportPage from './pages/OrderReportPage'
import ReportsPage from './pages/ReportsPage'
import CustomerAgeingReportPage from './pages/CustomerAgeingReportPage'
import UsersPage from './pages/UsersPage'
import EticaretPage from './pages/EticaretPage'
import NotificationsPage from './pages/NotificationsPage'
import QrCheckInPage from './pages/QrCheckInPage'
import FaceCheckInPage from './pages/FaceCheckInPage'
import QrTestPage from './pages/QrTestPage'
import CashReportDetailPage from './pages/CashReportDetailPage'
import CashReportPage from './pages/CashReportPage'
import ProductSalesReportDetailed from './pages/ProductSalesReportDetailed'
import ProductSalesReportMonthly from './pages/ProductSalesReportMonthly'
import PriceList from './pages/PriceList'
import CustomerDebitCreditPage from './pages/CustomerDebitCreditPage'
import CariEkstreReport from './pages/CariEkstreReport'
import YonetimEkstreReport from './pages/YonetimEkstreReport'
import BankaRaporlariReport from './pages/BankaRaporlariReport'
import AktifSepetRaporuReport from './pages/AktifSepetRaporuReport'
import LimitRiskSatisRaporuReport from './pages/LimitRiskSatisRaporuReport'
import StockInOutReport from './pages/StockInOutReport'
import AccountingSalesReport from './pages/AccountingSalesReport'
import GarantiFormuPage from './pages/GarantiFormuPage'
import GarantiKayitlariPage from './pages/GarantiKayitlariPage'
import GarantiDegisimRaporuPage from './pages/GarantiDegisimRaporuPage'
import VirmanPage from './pages/VirmanPage'
import VirmanReportPage from './pages/VirmanReportPage'
import VirmanReportDetailPage from './pages/VirmanReportDetailPage'
import VirtualPosReportPage from './pages/VirtualPosReportPage'
import { useDocumentTitle } from './hooks/useDocumentTitle'

// Forced cache refresh comment
console.log('App initialization - PriceList:', PriceList)

export default function App() {
  useDocumentTitle()

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/ssa" element={<LoginPage />} />
      <Route path="/ssalogin" element={<LoginPage />} />
      <Route path="/ssa-login" element={<LoginPage />} />
      <Route path="/admin" element={<LoginPage />} />
      <Route path="/admin-login" element={<LoginPage />} />
      <Route path="/hsa" element={<LoginPage />} />
      <Route path="/hsalogin" element={<LoginPage />} />
      <Route path="/hsa-login" element={<LoginPage />} />
      <Route path="/login/hsalogin" element={<LoginPage />} />
      <Route path="/qr-checkin" element={<QrCheckInPage />} />
      <Route path="/face-checkin" element={<FaceCheckInPage />} />
      <Route path="/404" element={<NotFoundPage />} />
      <Route path="/print/preview" element={<PrintPreviewPage />} />
      <Route
        path="/"
        element={<Navigate to="/home" replace />}
      />
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route path="/login" element={<LoginPage />} />
        <Route path="/ssa" element={<LoginPage />} />
        <Route path="/ssalogin" element={<LoginPage />} />
        <Route path="/ssa-login" element={<LoginPage />} />
        <Route path="/admin" element={<LoginPage />} />
        <Route path="/admin-login" element={<LoginPage />} />
        <Route path="/hsa" element={<LoginPage />} />
        <Route path="/hsalogin" element={<LoginPage />} />
        <Route path="/hsa-login" element={<LoginPage />} />
        <Route path="/login/hsalogin" element={<LoginPage />} />
        <Route path="/" element={<Navigate to="/home" replace />} />
        <Route path="/home" element={<HomePage />} />
        <Route path="/service" element={<div className="p-12 text-center text-gray-500 text-sm font-semibold max-w-md mx-auto mt-10 bg-white/5 border border-white/10 rounded-2xl backdrop-blur-md shadow-2xl">Lütfen üst menüden gitmek istediğiniz Servis modülünü seçin.</div>} />
        <Route path="/siparis" element={<Navigate to="/invoice/siparis" replace />} />
        <Route path="/satis-faturasi" element={<Navigate to="/invoice/satis-faturasi" replace />} />
        <Route path="/kampanya-tanim" element={<Navigate to="/users/kampanya" replace />} />
        <Route path="/fatura-dokumu" element={<Navigate to="/invoice/fatura-dokumu" replace />} />
        <Route path="/etiket-basim-fiyatli" element={<Navigate to="/invoice/etiket-basim-fiyatli" replace />} />
        <Route path="/etiket-basim-fiyatsiz" element={<Navigate to="/invoice/etiket-basim-fiyatsiz" replace />} />
        <Route path="/proforma" element={<Navigate to="/invoice/proforma" replace />} />
        <Route path="/magaza-siparis" element={<Navigate to="/invoice/magaza-siparis" replace />} />
        <Route path="/alis-faturalari" element={<Navigate to="/invoice/alis-faturalari" replace />} />
        <Route path="/depo-transfer" element={<Navigate to="/invoice/depo-transfer" replace />} />
        <Route path="/stok-hareket" element={<Navigate to="/invoice/stok-hareket" replace />} />
        <Route path="/satis-faturalari" element={<Navigate to="/invoice/satis-faturari" replace />} />
        <Route path="/depo-bakiye" element={<Navigate to="/invoice/depo-bakiye" replace />} />
        <Route path="/fatura-dokumu-2024" element={<Navigate to="/404" replace />} />
        <Route path="/satis-faturari" element={<Navigate to="/404" replace />} />
        <Route path="/invoice/satis-faturari" element={<Navigate to="/404" replace />} />
        <Route path="/invoice/depo-bakiye" element={<Navigate to="/404" replace />} />
        <Route path="/users/stokListesi" element={<Navigate to="/404" replace />} />
        <Route path="/musteri-teklifi" element={<Navigate to="/invoice/musteri-teklifi" replace />} />
        <Route path="/cari-teklifleri" element={<Navigate to="/invoice/cari-teklifleri" replace />} />
        <Route path="/bayi-teklifleri" element={<Navigate to="/invoice/bayi-teklifleri" replace />} />
        <Route path="/fatura-listesi" element={<Navigate to="/invoice/fatura-dokumu" replace />} />
        <Route path="/invoice/fatura-listesi" element={<Navigate to="/invoice/fatura-dokumu" replace />} />
        <Route path="/invoice/musteri-teklifi" element={<CustomerOfferPage />} />
        <Route path="/invoice/cari-teklifleri" element={<CariOfferPage />} />
        <Route path="/invoice/bayi-teklifleri" element={<BayiTeklifleriPage />} />
        <Route path="/invoice/fatura-dokumu" element={<InvoiceListPage />} />
        <Route path="/invoice/fatura-dokumu/:id" element={<Navigate to="/invoice/fatura-dokumu" replace />} />
        <Route path="/invoice/fatura-dokumu-2024" element={<Navigate to="/404" replace />} />
        <Route path="/invoice/list" element={<Navigate to="/invoice/fatura-dokumu" replace />} />
        <Route path="/invoice/detail/:id" element={<Navigate to="/invoice/fatura-dokumu" replace />} />
        <Route path="/invoice/*" element={<InvoicePage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/pos" element={<PosPage />} />
        <Route path="/pos/:tabId" element={<PosPage />} />
        <Route path="/virtual-pos/raporlar" element={<VirtualPosReportPage />} />
        <Route path="/cash/virmanListesi" element={<VirmanPage />} />
        <Route path="/cash" element={<CashPage />} />
        <Route path="/cash/:tabId" element={<CashPage />} />
        <Route path="/check" element={<CheckPage />} />
        <Route path="/check/:tabId" element={<CheckPage />} />
        <Route path="/bank" element={<BankPage />} />
        {/* Krediler kendi sayfası; sabit yol param rotasından önce eşleşir (bkz. /cash/virmanListesi). */}
        <Route path="/bank/krediler" element={<LoansPage />} />
        {/*
          ESKİ POS MASRAFLARI EKRANI KALDIRILDI (2026-08-20).
          Bütün bankaların masrafını TL çapası üzerinden topluyordu; dolar hesabın 10 $
          masrafı ile TL hesabın 10 ₺ masrafı aynı sütunda toplanıyordu. Yerini banka
          bazlı ve kendi para biriminde çalışan Banka Masrafları aldı. Eski yer imleri
          bozulmasın diye yol yönlendiriliyor.
        */}
        <Route path="/bank/posMasraflari" element={<Navigate to="/bank/bankaMasraflari" replace />} />
        {/*
          Banka Masrafları — POS + kredi kullanım masraflarının banka bazlı yeni ekranı.
          Sabit yol, /bank/:tabId'den ÖNCE eşleşmeli.
        */}
        <Route path="/bank/bankaMasraflari" element={<BankExpensesPage />} />
        <Route path="/bank/:tabId" element={<BankPage />} />
        <Route path="/qr-test" element={<QrTestPage />} />
        <Route path="/reports" element={<ReportsLayoutPage />}>
          <Route path="order-report" element={<OrderReportPage />} />
          <Route path="kasaRaporlari" element={<CashReportPage />} />
          <Route path="kasaRaporlari/:cashAccountId" element={<CashReportDetailPage />} />
          <Route path="yaslandirma" element={<CustomerAgeingReportPage />} />
          <Route path="urunSatisRaporuDetayli" element={<ProductSalesReportDetailed />} />
          <Route path="urunSatisRaporuAylik" element={<ProductSalesReportMonthly />} />
          <Route path="fiyatListesi" element={<PriceList />} />
          <Route path="cariBorcAlacak" element={<CustomerDebitCreditPage />} />
          <Route path="cariEkstre" element={<CariEkstreReport />} />
          <Route path="yonetimEkstre" element={<YonetimEkstreReport />} />
          <Route path="bankaRaporlari" element={<BankaRaporlariReport />} />
          <Route path="krediVadeTakvimi" element={<LoanScheduleReport />} />
          <Route path="hizmetHarcamaRaporu" element={<HizmetHarcamaRaporu />} />
          <Route path="aktifSepetRaporu" element={<AktifSepetRaporuReport />} />
          <Route path="limitRiskSatisRaporu" element={<LimitRiskSatisRaporuReport />} />
          <Route path="muhasebeStokGirisCikisRaporu" element={<StockInOutReport />} />
          <Route path="accountingSalesReport" element={<AccountingSalesReport />} />
          <Route path="garantiFormu" element={<GarantiFormuPage />} />
          <Route path="garantiKayitlari" element={<GarantiKayitlariPage />} />
          <Route path="garantiDegisimRaporu" element={<GarantiDegisimRaporuPage />} />
          <Route path="virmanRaporlari" element={<VirmanReportPage />} />
          <Route path="virmanRaporlari/:customerCode" element={<VirmanReportDetailPage />} />
          <Route path=":reportId" element={<ReportsPage />} />
        </Route>

        <Route path="/urunYonetimi" element={<Navigate to="/users/urunYonetimi" replace />} />

        <Route path="/users/*" element={<UsersPage />} />
        {/* Bildirimler Ayarlar'dan ayrıldı: kendi menüsü, kendi rotası, kendi yetki modülü. */}
        <Route path="/bildirimler" element={<NotificationsPage />} />
        <Route path="/eticaret/*" element={<EticaretPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/404" replace />} />
    </Routes>
  )
}
