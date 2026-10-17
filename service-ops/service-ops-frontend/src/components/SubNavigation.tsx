import React from 'react'
import { NavLink } from 'react-router-dom'

export type Tab = {
  id: string
  label: string
  href?: string
}

export type Group = {
  id: string
  label: string
  items: Tab[]
}

type Props = {
  groups: Group[]
  activeGroupId: string
  activeTabId: string
  rightSlot?: React.ReactNode
}

export default function SubNavigation({ groups, activeGroupId, activeTabId, rightSlot }: Props) {
  const activeGroup = groups.find((g) => g.id === activeGroupId) || groups[0]
  // Shown whenever the group has any page at all. Requiring more than one hid the row entirely
  // for a group the user can only reach one page of, so that page never appeared in the header
  // and there was nothing to show it was the open one.
  const hasSubTabs = activeGroup && activeGroup.items.length > 0

  return (
    <div className="hidden lg:block relative bg-white font-outfit sticky top-[64px] w-full z-[40] pointer-events-auto border-b border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
      {/* Row 1: Groups Bar */}
      <div className="bg-slate-50/60 border-b border-slate-150/50 px-4 sm:px-6">
        <div className="flex items-center justify-between h-[42px] gap-4">
          <div className="flex-1 min-w-0 overflow-x-auto no-scrollbar">
            <div className="flex items-center gap-1.5 py-1">
              {groups.map((group) => {
                const isActive = group.id === activeGroupId
                const firstItem = group.items[0]
                const href = firstItem?.href || '#'

                return (
                  <NavLink
                    key={group.id}
                    to={href}
                    className={`px-3 py-1.5 rounded-lg text-[13px] font-semibold transition-all duration-200 whitespace-nowrap outline-none ${
                      isActive
                        ? 'bg-[#a51c12] text-white shadow-sm shadow-[#a51c12]/20 font-bold'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
                    }`}
                  >
                    {group.label}
                  </NavLink>
                )
              })}
            </div>
          </div>

          {rightSlot && <div className="flex-shrink-0">{rightSlot}</div>}
        </div>
      </div>

      {/* Row 2: Sub-tabs Bar (Only shown if active group has multiple items) */}
      {hasSubTabs && (
        <div className="bg-white px-4 sm:px-6 border-t border-slate-100">
          <div className="flex items-center h-[38px] overflow-x-auto no-scrollbar">
            <div className="flex items-center gap-5 h-full">
              {activeGroup.items.map((tab) => {
                const isActive = tab.id === activeTabId
                const href = tab.href || '#'

                return (
                  <NavLink
                    key={tab.id}
                    to={href}
                    className={`relative h-full px-1 flex items-center text-[13px] font-medium transition-all duration-200 whitespace-nowrap outline-none border-b-2 ${
                      isActive
                        ? 'text-[#a51c12] border-[#a51c12] font-semibold'
                        : 'text-slate-500 hover:text-slate-800 border-transparent'
                    }`}
                  >
                    {tab.label}
                  </NavLink>
                )
              })}
            </div>
          </div>
        </div>
      )}

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
