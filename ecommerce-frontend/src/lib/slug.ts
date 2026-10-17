export function generateSlug(text: string): string {
  if (!text) return ''
  let str = text.toLowerCase()
  // Replace Turkish characters
  str = str
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
  // Remove non-alphanumeric characters, spaces, and hyphens
  str = str.replace(/[^a-z0-9\s-]/g, '')
  // Replace multiple spaces or hyphens with a single hyphen
  str = str.replace(/[\s-]+/g, '-')
  // Trim hyphens from ends
  str = str.replace(/^-+|-+$/g, '')
  return str
}
