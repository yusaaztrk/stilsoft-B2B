import React from 'react'
import { Link } from 'react-router-dom'

export default function NotFoundPage() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-xl shadow-md p-10 w-full max-w-md text-center">
        <div className="text-4xl font-bold text-gray-800">404</div>
        <div className="mt-2 text-gray-600">Sayfa bulunamadı</div>
        <div className="mt-6 flex items-center justify-center gap-3">
          <Link to="/" className="btn btn-secondary">
            Ana Sayfa
          </Link>
          <Link to="/login" className="btn btn-primary">
            Login
          </Link>
        </div>
      </div>
    </div>
  )
}
