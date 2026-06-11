export function suggestNextTime(activities = []) {
  const timed = activities.filter(item => item.time).sort((a, b) => a.time.localeCompare(b.time))
  if (!timed.length) return '09:30'
  const last = timed[timed.length - 1]
  const [hours, minutes] = last.time.split(':').map(Number)
  if (Number.isNaN(hours)) return '09:30'
  const gap = last.category === 'food' ? 90 : 120
  const total = Math.min(hours * 60 + (minutes || 0) + gap, 21 * 60)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}
