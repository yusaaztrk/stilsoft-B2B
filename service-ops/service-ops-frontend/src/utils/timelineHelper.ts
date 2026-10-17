export function groupTimelineEvents(timeline: any[] | undefined | null): any[] {
  if (!timeline || !Array.isArray(timeline)) return []
  
  // Sort oldest first for chronological grouping
  const sorted = [...timeline].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
  
  const result: any[] = []
  const visited = new Set<string>()

  for (let i = 0; i < sorted.length; i++) {
    if (visited.has(String(i))) continue
    
    const current = sorted[i]
    visited.add(String(i))

    if (['StatusChanged', 'PhotoUploaded', 'NoteAdded'].includes(current.type)) {
      const group = [current]

      for (let j = i + 1; j < sorted.length; j++) {
        if (visited.has(String(j))) continue
        
        const next = sorted[j]
        if (!['StatusChanged', 'PhotoUploaded', 'NoteAdded'].includes(next.type)) continue

        // Check if same technician or one is null/undefined
        const isSameTech = !current.technicianId || !next.technicianId || current.technicianId === next.technicianId;
        const timeDiff = Math.abs(new Date(next.timestamp).getTime() - new Date(current.timestamp).getTime()) / 1000
        
        if (isSameTech && timeDiff <= 65) {
          group.push(next)
          visited.add(String(j))
        }
      }

      // Convert the group (even if length is 1) into a single FaultUpdate event
      const photoUrls: string[] = []
      let statusChange: any = null
      let note: string | null = null
      let compositeActor = current.actor

      for (const ev of group) {
        let payload: any = {}
        try {
          payload = typeof ev.payload === 'string' ? JSON.parse(ev.payload) : (ev.payload || {})
        } catch {}

        // Prefer actual human name for actor if current actor is a username
        if (ev.actor && ev.actor !== 'Sistem' && (!compositeActor || compositeActor === 'Sistem' || compositeActor.includes('_') || !compositeActor.includes(' '))) {
          compositeActor = ev.actor
        }

        if (ev.type === 'PhotoUploaded') {
          const val = payload.newValue || payload.NewValue
          if (val) {
            val.split(',').forEach((u: string) => {
              if (u.trim()) photoUrls.push(u.trim())
            })
          }
        } else if (ev.type === 'StatusChanged') {
          statusChange = {
            oldValue: payload.oldValue,
            newValue: payload.newValue,
            performedBy: payload.performedBy
          }
          if (payload.reason) {
            note = payload.reason
          }
        } else if (ev.type === 'NoteAdded') {
          note = payload.newValue || note
        }
      }

      result.push({
        id: current.id || String(i),
        type: 'FaultUpdate',
        timestamp: current.timestamp,
        actor: compositeActor || 'Sistem',
        photoUrl: photoUrls[0] || null,
        photoUrls,
        statusChange,
        note,
        originalEvents: group
      })
    } else {
      result.push(current)
    }
  }

  // Sort back to descending (newest first)
  return result.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
}
