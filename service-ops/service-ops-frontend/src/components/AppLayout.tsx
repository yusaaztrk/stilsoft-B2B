import { Outlet } from 'react-router-dom'
import ErrorBoundary from './ErrorBoundary'

export default function AppLayout() {
  return (
    <div style={{ minHeight: '100vh', background: '#f7f7fb' }}>
      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '18px 16px' }}>
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </main>
    </div>
  )
}
