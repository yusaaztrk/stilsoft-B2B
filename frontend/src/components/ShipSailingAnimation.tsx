import React from 'react'

interface ShipSailingAnimationProps {
  size?: 'sm' | 'md' | 'lg' | 'full'
  showText?: boolean
}

export const ShipSailingAnimation: React.FC<ShipSailingAnimationProps> = ({
  size = 'md',
  showText = true
}) => {
  let shipSize = 'w-[90%] h-[70%]'
  let textSize = 'text-[9px]'
  let textMargin = 'mt-0.5'

  if (size === 'sm') {
    shipSize = 'w-[60%] h-[70%]'
    textSize = 'text-[6px]'
    textMargin = 'mt-0'
  } else if (size === 'lg') {
    shipSize = 'w-[80%] h-[70%]'
    textSize = 'text-[10px]'
    textMargin = 'mt-1'
  } else if (size === 'full') {
    shipSize = 'w-[80%] h-[70%]'
    textSize = 'text-xs'
    textMargin = 'mt-2'
  }

  return (
    <div className="relative w-full h-full overflow-hidden bg-sky-50 flex flex-col items-center justify-center">
      {/* Inline styles for keyframe animations */}
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes bsy-wave-motion {
          0% { transform: translateX(0); }
          50% { transform: translateX(-12px) translateY(0.5px); }
          100% { transform: translateX(0); }
        }
        @keyframes bsy-ship-bob {
          0% { transform: translateY(0) rotate(0deg); }
          25% { transform: translateY(-1.5px) rotate(1deg); }
          50% { transform: translateY(0) rotate(-1deg); }
          75% { transform: translateY(1.5px) rotate(0.5deg); }
          100% { transform: translateY(0) rotate(0deg); }
        }
        @keyframes bsy-smoke-rise {
          0% { transform: translateY(0) scale(0.8); opacity: 0; }
          50% { opacity: 0.8; }
          100% { transform: translateY(-6px) scale(1.4); opacity: 0; }
        }
        .bsy-animate-wave-1 {
          animation: bsy-wave-motion 4s infinite ease-in-out;
        }
        .bsy-animate-wave-2 {
          animation: bsy-wave-motion 3s infinite ease-in-out;
        }
        .bsy-animate-ship {
          animation: bsy-ship-bob 2.5s infinite ease-in-out;
        }
        .bsy-animate-smoke-1 {
          animation: bsy-smoke-rise 1.5s infinite ease-out;
        }
        .bsy-animate-smoke-2 {
          animation: bsy-smoke-rise 1.5s infinite ease-out 0.75s;
        }
      `}} />

      {/* Sea & Sky Background SVG */}
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
        <defs>
          <linearGradient id="bsySkyGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#bae6fd" />
            <stop offset="100%" stopColor="#f0f9ff" />
          </linearGradient>
        </defs>
        <rect width="100" height="100" fill="url(#bsySkyGrad)" />
        
        {/* Sun in the background */}
        <circle cx="85" cy="25" r="8" fill="#fef08a" opacity="0.9" />
        
        {/* Distant mountains/hills */}
        <path d="M 0,65 Q 25,50 50,65 T 100,65 L 100,100 L 0,100 Z" fill="#bae6fd" opacity="0.5" />
        
        {/* Waves */}
        <path
          d="M -20,70 Q 15,62 50,70 T 120,70 L 120,105 L -20,105 Z"
          fill="#38bdf8"
          className="bsy-animate-wave-1"
        />
        <path
          d="M -20,76 Q 15,70 50,76 T 120,76 L 120,105 L -20,105 Z"
          fill="#0284c7"
          className="bsy-animate-wave-2"
        />
      </svg>

      {/* Ship & Text overlay */}
      <div className={`relative z-10 flex flex-col items-center justify-center w-full h-full ${size === 'sm' ? 'pt-0.5' : 'pt-1'}`}>
        {/* Ship container */}
        <div className={`${shipSize} bsy-animate-ship mb-0.5`}>
          <svg viewBox="0 0 64 64" className="w-full h-full text-slate-800 drop-shadow-sm">
            {/* Ocean ship hull */}
            <path d="M6,44 L58,44 L52,56 L14,56 Z" fill="#334155" stroke="#1e293b" strokeWidth="2.2" strokeLinejoin="round" />
            {/* White stilsoft brand logo on the ship hull */}
            <image href="/s-logo-white.png" x="18" y="45.5" width="28" height="9" preserveAspectRatio="xMidYMid meet" />
            
            {/* Deck cargo line */}
            <line x1="12" y1="44" x2="52" y2="44" stroke="#1e293b" strokeWidth="2" />
            
            {/* Cargo containers (stacked) */}
            {/* Bottom Row */}
            <rect x="14" y="34" width="10" height="9" fill="#ef4444" stroke="#1e293b" strokeWidth="1.5" rx="0.5" />
            <rect x="25" y="34" width="12" height="9" fill="#f59e0b" stroke="#1e293b" strokeWidth="1.5" rx="0.5" />
            <rect x="38" y="34" width="11" height="9" fill="#3b82f6" stroke="#1e293b" strokeWidth="1.5" rx="0.5" />

            {/* Bottom Row details */}
            <line x1="19" y1="34" x2="19" y2="43" stroke="#1e293b" strokeWidth="1" opacity="0.3" />
            <line x1="31" y1="34" x2="31" y2="43" stroke="#1e293b" strokeWidth="1" opacity="0.3" />
            <line x1="43.5" y1="34" x2="43.5" y2="43" stroke="#1e293b" strokeWidth="1" opacity="0.3" />

            {/* Top Row */}
            <rect x="18" y="25" width="11" height="9" fill="#10b981" stroke="#1e293b" strokeWidth="1.5" rx="0.5" />
            {/* The Container with Logo */}
            <g>
              <rect x="30" y="25" width="15" height="9" fill="#dc2626" stroke="#1e293b" strokeWidth="1.5" rx="0.5" />
              {/* Stilsoft brand logo image inside the container */}
              <image href="/s-logo-white.png" x="31" y="26" width="13" height="7" preserveAspectRatio="xMidYMid meet" />
            </g>

            {/* Top Row details */}
            <line x1="23.5" y1="25" x2="23.5" y2="34" stroke="#1e293b" strokeWidth="1" opacity="0.3" />

            {/* Ship Cabin / Bridge (at the back/stern) */}
            <path d="M48,28 L54,28 L54,44 L48,44 Z" fill="#f1f5f9" stroke="#1e293b" strokeWidth="1.5" />
            <rect x="49" y="31" width="4" height="3" fill="#38bdf8" stroke="#1e293b" strokeWidth="1" />

            {/* Chimney / Funnel */}
            <rect x="50" y="18" width="3" height="10" fill="#475569" stroke="#1e293b" strokeWidth="1.5" />
            <rect x="49.5" y="16" width="4" height="2" fill="#ef4444" />
            
            {/* Smoke particles */}
            <circle cx="51.5" cy="11" r="2" fill="#cbd5e1" className="bsy-animate-smoke-1" />
            <circle cx="51.5" cy="11" r="2" fill="#94a3b8" className="bsy-animate-smoke-2" />
          </svg>
        </div>

        {/* Text */}
        {showText && (
          <span className={`${textSize} ${textMargin} font-extrabold text-sky-700 tracking-wider uppercase drop-shadow-xs select-none animate-pulse`}>
            YOLDA
          </span>
        )}
      </div>
    </div>
  )
}
