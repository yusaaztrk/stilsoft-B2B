export function capitalizeFirst(value: string, locale: string = 'tr-TR') {
  const m = value.match(/^(\s*)(\S)([\s\S]*)$/)
  if (!m) return value
  return m[1] + m[2].toLocaleUpperCase(locale) + m[3]
}
