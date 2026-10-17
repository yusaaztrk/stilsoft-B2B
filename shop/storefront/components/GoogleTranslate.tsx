'use client'

import React, { useEffect, useState, useRef } from 'react'

declare global {
  interface Window {
    google?: any
    googleTranslateElementInit?: () => void
  }
}

const LANGUAGES = [
  { code: 'tr', name: 'Türkçe', flag: '🇹🇷', label: 'TR' },
  { code: 'en', name: 'English', flag: '🇬🇧', label: 'EN' },
  { code: 'ru', name: 'Русский', flag: '🇷🇺', label: 'RU' },
  { code: 'ar', name: 'العربية', flag: '🇸🇦', label: 'AR' },
  { code: 'de', name: 'Deutsch', flag: '🇩🇪', label: 'DE' },
  { code: 'el', name: 'Ελληνικά', flag: '🇬🇷', label: 'EL' },
  { code: 'fa', name: 'فارسی', flag: '🇮🇷', label: 'FA' },
]

export default function GoogleTranslate() {
  const [currentLang, setCurrentLang] = useState('tr')
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Check existing cookie
    const match = document.cookie.match(/googtrans=\/tr\/([a-zA-Z]+)/)
    if (match && match[1]) {
      setCurrentLang(match[1].toLowerCase())
    }

    // Initialize Google Translate script if not already added
    if (!document.getElementById('google-translate-script')) {
      window.googleTranslateElementInit = () => {
        if (window.google?.translate?.TranslateElement) {
          new window.google.translate.TranslateElement(
            {
              pageLanguage: 'tr',
              includedLanguages: 'tr,en,ru,ar,de,el,fa,fr',
              layout: window.google.translate.TranslateElement.InlineLayout.SIMPLE,
              autoDisplay: false,
            },
            'google_translate_element'
          )
        }
      }

      const script = document.createElement('script')
      script.id = 'google-translate-script'
      script.src = '//translate.google.com/translate_a/element.js?cb=googleTranslateElementInit'
      script.async = true
      document.body.appendChild(script)
    }
  }, [])

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const changeLanguage = (langCode: string) => {
    setCurrentLang(langCode)
    setIsOpen(false)

    // Set Google Translate cookie for domain and path
    const domain = window.location.hostname
    document.cookie = `googtrans=/tr/${langCode}; path=/; domain=${domain}`
    document.cookie = `googtrans=/tr/${langCode}; path=/;`

    // Trigger Google select combo if present
    const select = document.querySelector<HTMLSelectElement>('.goog-te-combo')
    if (select) {
      select.value = langCode
      select.dispatchEvent(new Event('change'))
    } else {
      window.location.reload()
    }
  }

  const activeLangObj = LANGUAGES.find((l) => l.code === currentLang) || LANGUAGES[0]

  return (
    <div className="google-translate-wrapper" ref={dropdownRef}>
      {/* Gizli Google Translate Elementi */}
      <div id="google_translate_element" style={{ display: 'none' }} />

      {/* Şık Dil Seçici Butonu */}
      <button
        type="button"
        className="lang-switcher-btn"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-label="Dil Seçimi / Select Language"
      >
        <span className="lang-flag">{activeLangObj.flag}</span>
        <span className="lang-code">{activeLangObj.label}</span>
        <svg
          width="10"
          height="6"
          viewBox="0 0 10 6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className={`lang-chevron ${isOpen ? 'open' : ''}`}
        >
          <path d="M1 1L5 5L9 1" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* Dil Seçenekleri Menüsü */}
      {isOpen && (
        <div className="lang-dropdown-menu">
          <div className="lang-dropdown-header">
            <span>Dili Değiştir / Language</span>
          </div>
          <div className="lang-options-list">
            {LANGUAGES.map((lang) => (
              <button
                key={lang.code}
                type="button"
                className={`lang-option-item ${currentLang === lang.code ? 'active' : ''}`}
                onClick={() => changeLanguage(lang.code)}
              >
                <span className="lang-item-flag">{lang.flag}</span>
                <span className="lang-item-name">{lang.name}</span>
                {currentLang === lang.code && <span className="lang-check">✓</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
