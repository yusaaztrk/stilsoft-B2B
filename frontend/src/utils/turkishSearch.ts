/**
 * Turkish-aware search and string normalization utilities.
 * Ensures bidirectional matching between Turkish and English/Latin characters:
 * - 'i', 'I', 'ı', 'İ', 'î', 'ï' -> 'i'
 * - 'g', 'G', 'ğ', 'Ğ' -> 'g'
 * - 'u', 'U', 'ü', 'Ü', 'û', 'Û' -> 'u'
 * - 's', 'S', 'ş', 'Ş' -> 's'
 * - 'o', 'O', 'ö', 'Ö', 'ô', 'Ô' -> 'o'
 * - 'c', 'C', 'ç', 'Ç' -> 'c'
 * - 'a', 'A', 'â', 'Â' -> 'a'
 * - 'e', 'E', 'ê', 'Ê' -> 'e'
 */

/**
 * Normalizes text to lowercase ASCII by converting Turkish & special characters.
 */
export function normalizeTurkishForSearch(str: any): string {
  if (str == null) return ''
  let s = String(str)

  // 1. Explicit character replacement for Turkish uppercase & special letters
  s = s
    .replace(/İ/g, 'i')
    .replace(/I/g, 'i')
    .replace(/ı/g, 'i')
    .replace(/i/g, 'i')
    .replace(/Ğ/g, 'g')
    .replace(/ğ/g, 'g')
    .replace(/Ü/g, 'u')
    .replace(/ü/g, 'u')
    .replace(/Ş/g, 's')
    .replace(/ş/g, 's')
    .replace(/Ö/g, 'o')
    .replace(/ö/g, 'o')
    .replace(/Ç/g, 'c')
    .replace(/ç/g, 'c')
    .replace(/Â/g, 'a')
    .replace(/â/g, 'a')
    .replace(/Î/g, 'i')
    .replace(/î/g, 'i')
    .replace(/Û/g, 'u')
    .replace(/û/g, 'u')
    .replace(/Ê/g, 'e')
    .replace(/ê/g, 'e')

  // 2. Standard lowercase conversion
  s = s.toLowerCase()

  // 3. Second pass for any remaining Turkish characters or characters from lowercasing
  s = s
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/â/g, 'a')
    .replace(/î/g, 'i')
    .replace(/û/g, 'u')
    .replace(/ê/g, 'e')

  // 4. Strip combining diacritical marks (e.g. \u0307 combining dot above produced from 'İ' on some engines)
  s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')

  return s
}

/**
 * Returns structured search tokens for full, compact (alphanumeric only), and individual words matching.
 */
export function normalizeForSearch(str: any): { full: string; compact: string; words: string[] } {
  if (str == null) return { full: '', compact: '', words: [] }

  const full = normalizeTurkishForSearch(str).trim()
  const compact = full.replace(/[^a-z0-9]/g, '')
  const words = full.split(/[^a-z0-9]+/).filter(Boolean)

  return { full, compact, words }
}

/**
 * Compares two strings using Turkish-aware, case-insensitive, punctuation-flexible matching.
 */
export function matchTurkishString(cellStr: string, searchVal: string, operator: string = 'contains'): boolean {
  if (!searchVal) return true

  const cell = normalizeForSearch(cellStr)
  const search = normalizeForSearch(searchVal)

  if (!search.full) return true

  // Check for boolean / select synonyms (true / evet / 1 vs false / hayir / 0)
  const isSearchTrue = search.full === 'true' || search.full === 'evet' || search.full === '1' || search.full === 'yes'
  const isSearchFalse = search.full === 'false' || search.full === 'hayir' || search.full === '0' || search.full === 'no'
  const isCellTrue = cell.full === 'true' || cell.full === 'evet' || cell.full === '1' || cell.full.includes('true') || cell.full.includes('evet')
  const isCellFalse = cell.full === 'false' || cell.full === 'hayir' || cell.full === '0' || cell.full.includes('false') || cell.full.includes('hayir')

  if ((isSearchTrue || isSearchFalse) && (isCellTrue || isCellFalse)) {
    if (operator === 'neq' || operator === 'not_contains') {
      return (isSearchTrue && isCellFalse) || (isSearchFalse && isCellTrue)
    }
    return (isSearchTrue && isCellTrue) || (isSearchFalse && isCellFalse)
  }

  // Exact or not-equal operators
  if (operator === 'eq') {
    return cell.full === search.full || (Boolean(cell.compact) && cell.compact === search.compact)
  }
  if (operator === 'neq') {
    return cell.full !== search.full && (!cell.compact || cell.compact !== search.compact)
  }
  if (operator === 'starts_with') {
    return cell.full.startsWith(search.full) || (Boolean(cell.compact) && cell.compact.startsWith(search.compact))
  }
  if (operator === 'ends_with') {
    return cell.full.endsWith(search.full) || (Boolean(cell.compact) && cell.compact.endsWith(search.compact))
  }
  if (operator === 'not_contains') {
    return !cell.full.includes(search.full) && (!cell.compact || !cell.compact.includes(search.compact))
  }

  // Default / 'contains' / flexible matching:

  // 1. Direct full substring match
  if (cell.full.includes(search.full)) return true

  // 2. Compact match (ignores spaces, dashes, dots, slashes, etc. e.g. phone numbers or formatted codes)
  if (search.compact && cell.compact.includes(search.compact)) return true

  // 3. Multi-word search matching: all search words must be found in cell
  if (search.words.length > 0) {
    const allWordsFound = search.words.every((sw) => {
      return cell.full.includes(sw) || (Boolean(cell.compact) && cell.compact.includes(sw))
    })
    if (allWordsFound) return true
  }

  return false
}

/**
 * Simple helper to check if a text contains search term with Turkish normalization.
 */
export function turkishIncludes(text: any, search: any): boolean {
  if (!search) return true
  const normText = normalizeTurkishForSearch(text)
  const normSearch = normalizeTurkishForSearch(search).trim()
  if (!normSearch) return true
  return normText.includes(normSearch)
}
