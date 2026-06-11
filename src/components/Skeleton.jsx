export default function Skeleton({ variant = 'card', count = 3 }) {
  return <div className={`skeleton-list ${variant}`}>{Array.from({ length:count }, (_, index) => <div className="skeleton-card" key={index}><i /><span /><span /></div>)}</div>
}
