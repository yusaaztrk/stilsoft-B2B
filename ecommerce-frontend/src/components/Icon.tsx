export function Icon({
  name,
  className,
}: {
  name: 'search' | 'user' | 'heart' | 'bag' | 'box' | 'tag'
  className?: string
}) {
  const cls = className ?? 'h-5 w-5'
  if (name === 'search') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={cls} aria-hidden="true">
        <path
          d="M10.5 18.5a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm6.4-1.6 4.1 4.1"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    )
  }

  if (name === 'user') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={cls} aria-hidden="true">
        <path d="M20 21a8 8 0 0 0-16 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z" stroke="currentColor" strokeWidth="2" />
      </svg>
    )
  }

  if (name === 'heart') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={cls} aria-hidden="true">
        <path
          d="M12 21s-7-4.6-9.3-9A5.6 5.6 0 0 1 12 6a5.6 5.6 0 0 1 9.3 6c-2.3 4.4-9.3 9-9.3 9Z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </svg>
    )
  }

  if (name === 'box') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={cls} aria-hidden="true">
        <path
          d="M3.5 7.5 12 3l8.5 4.5L12 12 3.5 7.5Z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path d="M3.5 7.5V16.5L12 21l8.5-4.5V7.5" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        <path d="M12 12v9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    )
  }

  if (name === 'tag') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={cls} aria-hidden="true">
        <path
          d="M20 13.5 13.5 20a2 2 0 0 1-2.8 0L3 12.3V4h8.3L20 11.7a2 2 0 0 1 0 2.8Z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path d="M7.5 7.5h.01" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 24 24" fill="none" className={cls} aria-hidden="true">
      <path
        d="M6 7h15l-1.5 8.5a2 2 0 0 1-2 1.7H9a2 2 0 0 1-2-1.7L6 7Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M9 7a3 3 0 0 1 6 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}
