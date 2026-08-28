import { formatTime, windowsForDay, type DayOfWeek, type ServiceWindow } from '@/lib/hours'

/** Displayed labels, Monday first — the week order our `DayOfWeek` uses. */
const DAY_NAMES = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche']

const SCALE_START_MIN = 6 * 60
/** 2 a.m. the next day: late closes are stored past 1440 and must stay visible. */
const SCALE_END_MIN = 26 * 60
const SCALE_SPAN_MIN = SCALE_END_MIN - SCALE_START_MIN

/**
 * The week as bars. This is the centrepiece of the card: a split shift shows up as a
 * HOLE in the middle of the day, without the reader parsing a single time.
 */
export function WeekGrid({ windows }: { windows: ServiceWindow[] }) {
  if (!windows.length) {
    return <p className="text-sm text-stone-500">Aucun horaire connu pour cet établissement.</p>
  }

  return (
    <div className="space-y-1">
      {DAY_NAMES.map((name, i) => {
        const dayWindows = windowsForDay(windows, (i + 1) as DayOfWeek)
        return (
          <div key={name} className="flex items-center gap-2 text-xs">
            <span className="w-20 shrink-0 text-stone-500">{name}</span>
            <div className="relative h-5 flex-1 rounded bg-stone-100">
              {dayWindows.map((w, k) => {
                // Clamped to the scale: a 5 a.m. open or a 3 a.m. close would otherwise
                // render outside the bar.
                const left = ((Math.max(w.opensAt, SCALE_START_MIN) - SCALE_START_MIN) / SCALE_SPAN_MIN) * 100
                const width = ((Math.min(w.closesAt, SCALE_END_MIN) - Math.max(w.opensAt, SCALE_START_MIN)) / SCALE_SPAN_MIN) * 100
                return (
                  <div
                    key={k}
                    className="absolute top-0 h-5 rounded bg-stone-700"
                    style={{ left: `${left}%`, width: `${Math.max(width, 1)}%` }}
                    title={`${formatTime(w.opensAt)} – ${formatTime(w.closesAt)}`}
                  />
                )
              })}
              {dayWindows.length === 0 && (
                <span className="absolute inset-0 flex items-center justify-center text-stone-400">fermé</span>
              )}
            </div>
            <span className="w-32 shrink-0 text-right text-stone-600">
              {dayWindows.map((w) => `${formatTime(w.opensAt)}-${formatTime(w.closesAt)}`).join(' · ') || '—'}
            </span>
          </div>
        )
      })}
      <div className="flex justify-between pl-22 pr-32 pt-1 text-[10px] text-stone-400">
        <span>6h</span><span>12h</span><span>18h</span><span>0h</span>
      </div>
    </div>
  )
}
