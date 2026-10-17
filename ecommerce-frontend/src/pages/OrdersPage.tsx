import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

export function OrdersPage() {
  const navigate = useNavigate()

  useEffect(() => {
    navigate('/hesabim?tab=orders', { replace: true })
  }, [navigate])

  return null
}
