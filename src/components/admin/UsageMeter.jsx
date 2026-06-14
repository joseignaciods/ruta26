export default function UsageMeter({ label, value, max, detail, tone = 'purple', compact = false, format = String }) {
  const numericValue = Math.max(0, Number(value || 0))
  const numericMax = Math.max(0, Number(max || 0))
  const percent = numericMax > 0 ? Math.min(100, (numericValue / numericMax) * 100) : 0
  return (
    <div className={`usage-meter ${tone} ${compact ? 'compact' : ''}`}>
      <div className="usage-meter-heading"><span>{label}</span><b>{numericMax > 0 ? `${percent.toFixed(percent < 10 ? 1 : 0)}%` : ''}</b></div>
      <strong>{format(numericValue)}{numericMax > 0 ? ` / ${format(numericMax)}` : ''}</strong>
      <div className="usage-meter-track"><i style={{ width:`${percent}%` }} /></div>
      {detail && <small>{detail}</small>}
    </div>
  )
}
