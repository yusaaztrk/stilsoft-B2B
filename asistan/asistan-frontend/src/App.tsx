import React from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import LoginPage from './pages/LoginPage'
import MesajlarPage from './pages/MesajlarPage'
import AyarlarPage from './pages/AyarlarPage'
import Shell from './components/Shell'
import { getToken } from './lib/session'

function RequireAuth({ children }: { children: React.ReactElement }) {
  const location = useLocation()
  if (!getToken()) {
    // Devir parametreleri giriş ekranına taşınır; orada takas edilir.
    return <Navigate to={`/login${location.search}`} replace />
  }
  return children
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Shell>
              <MesajlarPage />
            </Shell>
          </RequireAuth>
        }
      />
      <Route
        path="/ayarlar"
        element={
          <RequireAuth>
            <Shell>
              <AyarlarPage />
            </Shell>
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
