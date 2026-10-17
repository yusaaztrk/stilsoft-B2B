import { useEffect } from 'react'
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { Shell } from './components/Shell'
import { AdminLoginPage } from './pages/AdminLoginPage'
import { getAdminToken } from './lib/api'

function AdminProtectedRoute() {
  const token = getAdminToken()
  if (!token) {
    return <Navigate to="/admin/login" replace />
  }
  return <Outlet />
}

// 16 Admin Page Imports
import { AdminDashboardPage } from './pages/AdminDashboardPage'
import { AdminPage } from './pages/AdminPage'
import { AdminCategoriesPage } from './pages/AdminCategoriesPage'
import { AdminBrandsPage } from './pages/AdminBrandsPage'
import { AdminOrdersPage } from './pages/AdminOrdersPage'
import { AdminCustomersPage } from './pages/AdminCustomersPage'
import { AdminCampaignsPage } from './pages/AdminCampaignsPage'
import { AdminCampaignsManagementPage } from './pages/AdminCampaignsManagementPage'
import { AdminCouponsPage } from './pages/AdminCouponsPage'
import { AdminSlidersPage } from './pages/AdminSlidersPage'
import { AdminAnnouncementPage } from './pages/AdminAnnouncementPage'
import { AdminBannersPage } from './pages/AdminBannersPage'
import { AdminGridImagesPage } from './pages/AdminGridImagesPage'
import { AdminPdfCatalogsPage } from './pages/AdminPdfCatalogsPage'
import { AdminManualsPage } from './pages/AdminManualsPage'
import { AdminNewsletterPage } from './pages/AdminNewsletterPage'
import { AdminRegisteredProductsPage } from './pages/AdminRegisteredProductsPage'
import { AdminMediaPage } from './pages/AdminMediaPage'
import { AdminPagesPage } from './pages/AdminPagesPage'
import { AdminSettingsPage } from './pages/AdminSettingsPage'
import { AdminContactPage } from './pages/AdminContactPage'
import { AdminBlogPage } from './pages/AdminBlogPage'



import { AdminInventoryPage } from './pages/AdminInventoryPage'
import { AdminOrderDetailPage } from './pages/AdminOrderDetailPage'
import { AdminShippingPage } from './pages/AdminShippingPage'
import { AdminReturnsPage } from './pages/AdminReturnsPage'
import { AdminReviewsPage } from './pages/AdminReviewsPage'
import { AdminAffiliatePage } from './pages/AdminAffiliatePage'
import { AdminInvoicesPage } from './pages/AdminInvoicesPage'
import { AdminPaymentsPage } from './pages/AdminPaymentsPage'
import { AdminIntegrationsPage } from './pages/AdminIntegrationsPage'
import { AdminNotificationsPage } from './pages/AdminNotificationsPage'
import { AdminServiceRequestsPage } from './pages/AdminServiceRequestsPage'
import { AdminWarrantiesPage } from './pages/AdminWarrantiesPage'
import { AdminSurveyPage } from './pages/AdminSurveyPage'
import { AdminKargoTakipPage } from './pages/AdminKargoTakipPage'

import { SurveyPage } from './pages/SurveyPage'
import { CategoryPage } from './pages/CategoryPage'
import { HomePage } from './pages/HomePage'
import { ProductDetailPage } from './pages/ProductDetailPage'
import { TechnicalServicePage } from './pages/TechnicalServicePage'
import { CampaignsPublicPage } from './pages/CampaignsPublicPage'
import { CampaignProductsPage } from './pages/CampaignProductsPage'
import { ContactPage } from './pages/ContactPage'
import { WarrantyPage } from './pages/WarrantyPage'
import { AllCategoriesPage } from './pages/AllCategoriesPage'
import { LoginPage } from './pages/LoginPage'
import { AccountPage } from './pages/AccountPage'
import { SearchResultsPage } from './pages/SearchResultsPage'
import { CheckoutPage } from './pages/CheckoutPage'
import { OrdersPage } from './pages/OrdersPage'
import { OdemePage } from './pages/OdemePage'
import { FavorilerPage } from './pages/FavorilerPage'
import { KarsilastirPage } from './pages/KarsilastirPage'
import { AboutUsPage } from './pages/AboutUsPage'
import { KvkkPage } from './pages/KvkkPage'
import { PrivacyPage } from './pages/PrivacyPage'
import { DistanceSellingPage } from './pages/DistanceSellingPage'
import { ReturnsPage } from './pages/ReturnsPage'
import { HelpPage } from './pages/HelpPage'
import { BlogListPage } from './pages/BlogListPage'
import { BlogDetailPage } from './pages/BlogDetailPage'
import KargoSorgulaPage from './pages/KargoSorgulaPage'


function ScrollToTop() {
  const { pathname, search } = useLocation()

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }, [pathname, search])

  return null
}

function StorefrontLayout() {
  return (
    <Shell>
      <ScrollToTop />
      <Outlet />
    </Shell>
  )
}

import { ToastProvider } from './components/ui/ToastContext'
import { ConfirmProvider } from './components/ui/ConfirmContext'

export default function App() {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <Routes>
          <Route path="/admin/login" element={<AdminLoginPage />} />
          <Route element={<AdminProtectedRoute />}>
            {/* 16 Admin Routes */}
            <Route path="/admin/dashboard" element={<AdminDashboardPage />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/admin/categories" element={<AdminCategoriesPage />} />
            <Route path="/admin/brands" element={<AdminBrandsPage />} />
            <Route path="/admin/orders" element={<AdminOrdersPage />} />
            <Route path="/admin/customers" element={<AdminCustomersPage />} />
            <Route path="/admin/campaigns" element={<AdminCampaignsManagementPage />} />
            <Route path="/admin/bento-campaigns" element={<AdminCampaignsPage />} />
            <Route path="/admin/coupons" element={<AdminCouponsPage />} />
            <Route path="/admin/sliders" element={<AdminSlidersPage />} />
            <Route path="/admin/announcement" element={<AdminAnnouncementPage />} />
            <Route path="/admin/banners" element={<AdminBannersPage />} />
            <Route path="/admin/grid-images" element={<AdminGridImagesPage />} />
            <Route path="/admin/catalogs" element={<AdminPdfCatalogsPage />} />
            <Route path="/admin/manuals" element={<AdminManualsPage />} />
            <Route path="/admin/newsletter" element={<AdminNewsletterPage />} />
            <Route path="/admin/registered-products" element={<AdminRegisteredProductsPage />} />
            <Route path="/admin/media" element={<AdminMediaPage />} />
            <Route path="/admin/pages" element={<AdminPagesPage />} />
            <Route path="/admin/settings" element={<AdminSettingsPage />} />
            <Route path="/admin/contact-messages" element={<AdminContactPage />} />
            <Route path="/admin/blog" element={<AdminBlogPage />} />


            {/* 14 New Admin Routes */}
            <Route path="/admin/inventory" element={<AdminInventoryPage />} />
            <Route path="/admin/orders/:id" element={<AdminOrderDetailPage />} />
            <Route path="/admin/shipping" element={<AdminShippingPage />} />
            <Route path="/admin/returns" element={<AdminReturnsPage />} />
            <Route path="/admin/reviews" element={<AdminReviewsPage />} />
            <Route path="/admin/affiliate" element={<AdminAffiliatePage />} />
            <Route path="/admin/invoices" element={<AdminInvoicesPage />} />
            <Route path="/admin/payments" element={<AdminPaymentsPage />} />
            <Route path="/admin/integrations" element={<AdminIntegrationsPage />} />
            <Route path="/admin/notifications" element={<AdminNotificationsPage />} />
            <Route path="/admin/service-requests" element={<AdminServiceRequestsPage />} />
            <Route path="/admin/warranties" element={<AdminWarrantiesPage />} />
            <Route path="/admin/survey" element={<AdminSurveyPage />} />
            <Route path="/admin/kargo-takibi" element={<AdminKargoTakipPage />} />
          </Route>

          <Route element={<StorefrontLayout />}>
             <Route path="/" element={<HomePage />} />
            <Route path="/category/:slug" element={<CategoryPage />} />
            <Route path="/kategori/:slug" element={<CategoryPage />} />
            <Route path="/products/:id" element={<ProductDetailPage />} />
            <Route path="/urun/:slug/:id" element={<ProductDetailPage />} />
            <Route path="/blog" element={<BlogListPage />} />
            <Route path="/blog/:slug" element={<BlogDetailPage />} />
            <Route path="/teknik-servis" element={<TechnicalServicePage />} />
            <Route path="/kampanyalar" element={<CampaignsPublicPage />} />
            <Route path="/kampanya/:id" element={<CampaignProductsPage />} />
            <Route path="/iletisim" element={<ContactPage />} />
            <Route path="/garanti" element={<WarrantyPage />} />
            <Route path="/kategoriler" element={<AllCategoriesPage />} />
            <Route path="/giris" element={<LoginPage />} />
            <Route path="/hesabim" element={<AccountPage />} />
            <Route path="/siparislerim" element={<OrdersPage />} />
            <Route path="/arama" element={<SearchResultsPage />} />
            <Route path="/checkout" element={<CheckoutPage />} />
            <Route path="/odeme" element={<OdemePage />} />
            <Route path="/favoriler" element={<FavorilerPage />} />
            <Route path="/karsilastir" element={<KarsilastirPage />} />
            <Route path="/survey" element={<SurveyPage />} />
            <Route path="/hakkimizda" element={<AboutUsPage />} />
            <Route path="/kvkk" element={<KvkkPage />} />
            <Route path="/gizlilik-politikasi" element={<PrivacyPage />} />
            <Route path="/mesafeli-satis-sozlesmesi" element={<DistanceSellingPage />} />
            <Route path="/iade-ve-degisim-kosullari" element={<ReturnsPage />} />
            <Route path="/destek-sss" element={<HelpPage />} />
            <Route path="/kargo-takip-sorgula" element={<KargoSorgulaPage />} />
          </Route>
        </Routes>
      </ConfirmProvider>
    </ToastProvider>
  )
}
