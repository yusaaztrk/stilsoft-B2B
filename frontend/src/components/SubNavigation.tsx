import React from 'react'
import type { LucideIcon } from 'lucide-react'
import { motion } from 'framer-motion'
import { NavLink } from 'react-router-dom'

type Tab = {
  id: string
  label: string
  icon?: LucideIcon
  href?: string
}

type Props = {
  tabs: Tab[]
  activeId?: string
  onSelect?: (id: string) => void
  rightSlot?: React.ReactNode
}

export default function SubNavigation({ tabs, activeId, onSelect, rightSlot }: Props) {
  return (
    <div className="hidden lg:block relative bg-white/80 font-outfit backdrop-blur-md h-auto sticky top-[64px] w-full z-[40] pointer-events-auto border-b border-gray-200/60 shadow-[0_1px_3px_rgba(0,0,0,0.02)] px-4 sm:px-6">
      <div className="flex items-center justify-between h-full py-1.5 gap-4">
        <div className="flex-1 min-w-0 overflow-x-auto no-scrollbar">
          <div className="flex items-center gap-1 min-w-max h-[44px] px-0.5">
            {tabs.map((tab) => {
              const isActive = tab.id === activeId
              const commonClassName = `group relative h-9 px-3 flex items-center rounded-xl transition-all duration-300 outline-none ${isActive
                ? 'text-black font-extrabold'
                : 'text-slate-800 hover:text-black hover:bg-slate-100/80'
                }`

              const content = (
                <>
                  {isActive && (
                    <motion.div
                      layoutId="subnav-pill"
                      className="absolute inset-0 bg-black/5 rounded-xl"
                      transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
                    />
                  )}

                  <span
                    className={`relative z-10 text-[11px] font-extrabold tracking-wide whitespace-nowrap capitalize leading-none transition-colors duration-300 ${
                      isActive ? 'text-black' : 'text-slate-800 group-hover:text-black'
                    }`}
                  >
                    {tab.label.replace('\n', ' ').toLowerCase()}
                  </span>

                  {isActive && (
                    <motion.div
                      layoutId="subnav-indicator"
                      className="absolute bottom-0 left-4 right-4 h-0.5 bg-black rounded-full"
                      transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
                    />
                  )}
                </>
              )
              const isExternal = tab.href && (tab.href.startsWith('http://') || tab.href.startsWith('https://'))
              return (
                isExternal ? (
                  <a key={tab.id} href={tab.href} onClick={() => onSelect?.(tab.id)} className={commonClassName}>
                    {content}
                  </a>
                ) : tab.href ? (
                  <NavLink key={tab.id} to={tab.href} onClick={() => onSelect?.(tab.id)} className={commonClassName}>
                    {content}
                  </NavLink>
                ) : (
                  <button key={tab.id} type="button" onClick={() => onSelect?.(tab.id)} className={commonClassName}>
                    {content}
                  </button>
                )
              )
            })}
          </div>
        </div>

        {/* rightSlot is here, but we will likely empty it from AppLayout.tsx as per user request */}
        {rightSlot && (
          <div className="flex-shrink-0">
            {rightSlot}
          </div>
        )}
      </div>

      <style dangerouslySetInnerHTML={{
        __html: `
        .no-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .no-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}} />
    </div>
  )
}

