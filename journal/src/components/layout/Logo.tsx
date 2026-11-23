import { useId } from 'react'

export function Logo({ size = 34 }: { size?: number }) {
  const id = `logo-${useId().replace(/:/g, '')}`
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f7e5bf" />
          <stop offset=".55" stopColor="#e3c48d" />
          <stop offset="1" stopColor="#9c7a45" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="18" fill="#0f1216" stroke="rgba(227,196,141,.25)" />
      <path d="M14 46 L32 14 L50 46" fill="none" stroke={`url(#${id})`} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M21 38 L28 31 L34 35 L44 24" fill="none" stroke={`url(#${id})`} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
