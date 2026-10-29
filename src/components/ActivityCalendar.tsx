import type { Day } from '../services/activity';
import '../styles/home.css';

const level = (n: number) => (n === 0 ? 0 : n <= 2 ? 1 : n <= 5 ? 2 : n <= 9 ? 3 : 4);
const fmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

/** Days as a week-by-week grid (a column per week, Monday at the top), shaded by how much you studied. */
export function ActivityCalendar({ days }: { days: Day[] }) {
  if (!days.length) return null;
  const lead = (days[0].date.getDay() + 6) % 7; // Monday = 0
  const active = days.filter((d) => d.total > 0).length;
  return (
    <div className="actcal">
      <div
        className="actcal-grid"
        style={{ '--weeks': Math.ceil((lead + days.length) / 7) } as React.CSSProperties}
        role="img"
        aria-label={`Study activity over the last ${Math.round(days.length / 7)} weeks: ${active} active days`}
      >
        {Array.from({ length: lead }, (_, i) => (
          <span key={`pad${i}`} className="actcal-pad" />
        ))}
        {days.map((d) => (
          <span
            key={d.key}
            className={`actcal-day l${level(d.total)}`}
            title={`${fmt.format(d.date)}: ${d.total ? [d.answers ? `${d.answers} answer${d.answers > 1 ? 's' : ''}` : '', d.drills ? `${d.drills} drill answer${d.drills > 1 ? 's' : ''}` : ''].filter(Boolean).join(', ') : 'no study'}`}
          />
        ))}
      </div>
      <div className="actcal-legend" aria-hidden="true">
        Less
        {[0, 1, 2, 3, 4].map((l) => (
          <span key={l} className={`actcal-day l${l}`} />
        ))}
        More
      </div>
    </div>
  );
}
