import { useEffect } from 'react'

interface SEOProps {
  title?: string
  description?: string
  image?: string
  url?: string
  type?: 'website' | 'product' | 'article'
  schema?: any // JSON-LD schema object
}

export function useSEO({ title, description, image, url, type = 'website', schema }: SEOProps) {
  useEffect(() => {
    const saved = localStorage.getItem('ecom_store_design')
    const design = saved ? JSON.parse(saved) : null
    const brandName = design?.brandName || 'Stilsoft KKTC'
    const seoTitle = design?.seoTitle || 'Stilsoft KKTC | Ev Aletleri ve Mutfak Teknolojileri'
    const defaultDesc = design?.seoDescription || 'En kaliteli ev aletleri, mutfak robotları, süpürgeler ve ev teknolojisi ürünleri en iyi fiyatlarla Stilsoft KKTC\'de!'

    // 1. Title
    if (title) {
      document.title = `${title} | ${brandName}`
    } else {
      document.title = seoTitle
    }

    // Helper to get or create meta tag
    const setMetaTag = (attributeName: string, attributeValue: string, content: string) => {
      let element = document.querySelector(`meta[${attributeName}="${attributeValue}"]`)
      if (!element) {
        element = document.createElement('meta')
        element.setAttribute(attributeName, attributeValue)
        document.head.appendChild(element)
      }
      element.setAttribute('content', content)
    }

    // Helper to get or create link canonical tag
    const setCanonicalTag = (href: string) => {
      let element = document.querySelector('link[rel="canonical"]')
      if (!element) {
        element = document.createElement('link')
        element.setAttribute('rel', 'canonical')
        document.head.appendChild(element)
      }
      element.setAttribute('href', href)
    }

    // 2. Description
    const desc = description || defaultDesc
    setMetaTag('name', 'description', desc)
    setMetaTag('property', 'og:description', desc)
    setMetaTag('name', 'twitter:description', desc)

    // 3. OpenGraph / Twitter Title
    const ogTitle = title ? `${title} | ${brandName}` : seoTitle
    setMetaTag('property', 'og:title', ogTitle)
    setMetaTag('name', 'twitter:title', ogTitle)

    // 4. OpenGraph / Twitter Image
    if (image) {
      setMetaTag('property', 'og:image', image)
      setMetaTag('name', 'twitter:image', image)
    }

    // 5. URL
    const currentUrl = url || window.location.href
    setCanonicalTag(currentUrl)
    setMetaTag('property', 'og:url', currentUrl)

    // 6. OpenGraph Type
    setMetaTag('property', 'og:type', type)

    // 7. Schema (JSON-LD)
    let schemaScript = document.getElementById('jsonld-schema') as HTMLScriptElement
    if (schema) {
      if (!schemaScript) {
        schemaScript = document.createElement('script')
        schemaScript.id = 'jsonld-schema'
        schemaScript.type = 'application/ld+json'
        document.head.appendChild(schemaScript)
      }
      schemaScript.text = JSON.stringify(schema)
    } else {
      if (schemaScript) {
        schemaScript.remove()
      }
    }
  }, [title, description, image, url, type, schema])
}
