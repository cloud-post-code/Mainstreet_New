import { useState, useEffect } from 'react'
import styles from './ShoppingCalendar.module.css'

interface CalendarDate {
  name: string
  date: Date
  isCustom?: boolean
  id?: string
}

interface CustomDate {
  id: string
  name: string
  date: string // ISO yyyy-mm-dd
}

const STORAGE_KEY = 'ms_custom_dates'
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DAY_LABELS = ['Su','Mo','Tu','We','Th','Fr','Sa']

function nthWeekday(year: number, month: number, weekday: number, nth: number): Date {
  const d = new Date(year, month - 1, 1)
  let count = 0
  while (true) {
    if (d.getDay() === weekday) { count++; if (count === nth) return new Date(d) }
    d.setDate(d.getDate() + 1)
  }
}

function lastWeekday(year: number, month: number, weekday: number): Date {
  const d = new Date(year, month, 0)
  while (d.getDay() !== weekday) d.setDate(d.getDate() - 1)
  return new Date(d)
}

function getNextOccurrence(fn: (year: number) => Date, today: Date): Date {
  const thisYear = fn(today.getFullYear())
  return thisYear >= today ? thisYear : fn(today.getFullYear() + 1)
}

function buildBuiltins(): CalendarDate[] {
  const today = new Date(); today.setHours(0,0,0,0)
  const fixed = (m: number, d: number) => (y: number) => new Date(y, m - 1, d)
  const thanksgiving = (y: number) => nthWeekday(y, 11, 4, 4)
  const blackFriday  = (y: number) => { const t = thanksgiving(y); const b = new Date(t); b.setDate(t.getDate()+1); return b }
  const cyberMonday  = (y: number) => { const b = blackFriday(y);  const c = new Date(b); c.setDate(b.getDate()+3); return c }

  const entries: Array<{name: string; fn: (y: number) => Date}> = [
    { name: "New Year's Day",   fn: fixed(1, 1) },
    { name: "Valentine's Day",  fn: fixed(2, 14) },
    { name: 'Easter',           fn: (y) => y === 2026 ? new Date(2026,3,5)  : fixed(4,5)(y) },
    { name: "Mother's Day",     fn: (y) => nthWeekday(y, 5, 0, 2) },
    { name: 'Memorial Day',     fn: (y) => lastWeekday(y, 5, 1) },
    { name: "Father's Day",     fn: (y) => nthWeekday(y, 6, 0, 3) },
    { name: '4th of July',      fn: fixed(7, 4) },
    { name: 'Labor Day',        fn: (y) => nthWeekday(y, 9, 1, 1) },
    { name: 'Halloween',        fn: fixed(10, 31) },
    { name: 'Thanksgiving',     fn: thanksgiving },
    { name: 'Black Friday',     fn: blackFriday },
    { name: 'Cyber Monday',     fn: cyberMonday },
    { name: 'Hanukkah',        fn: (y) => y === 2026 ? new Date(2026,11,4) : fixed(12,4)(y) },
    { name: 'Christmas',        fn: fixed(12, 25) },
  ]

  // Include current year AND next year so the calendar has data when browsing forward
  const years = [today.getFullYear(), today.getFullYear() + 1]
  const results: CalendarDate[] = []
  for (const { name, fn } of entries) {
    for (const y of years) {
      results.push({ name, date: fn(y), isCustom: false })
    }
  }
  return results
}

const BUILTINS = buildBuiltins()

function toKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

function loadCustom(): CustomDate[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') } catch { return [] }
}

function daysUntil(date: Date, today: Date): number {
  return Math.ceil((date.getTime() - today.getTime()) / 86400000)
}

export default function ShoppingCalendar() {
  const today = new Date(); today.setHours(0,0,0,0)

  const [viewYear,  setViewYear]  = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth())    // 0-based
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [customDates, setCustomDates] = useState<CustomDate[]>(loadCustom)
  const [newName, setNewName] = useState('')
  const [newDate, setNewDate] = useState('')
  const [showAdd, setShowAdd] = useState(false)

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(customDates)) }, [customDates])

  function prevMonth() {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11) }
    else setViewMonth(m => m - 1)
    setSelectedDay(null)
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0) }
    else setViewMonth(m => m + 1)
    setSelectedDay(null)
  }

  function addCustomDate() {
    if (!newName.trim() || !newDate) return
    setCustomDates(prev => [...prev, { id: `${Date.now()}`, name: newName.trim(), date: newDate }])
    setNewName(''); setNewDate(''); setShowAdd(false)
  }

  function removeCustomDate(id: string) {
    setCustomDates(prev => prev.filter(d => d.id !== id))
  }

  // Build all events keyed by day string
  const customCalDates: CalendarDate[] = customDates.map(cd => ({
    name: cd.name, date: new Date(cd.date + 'T00:00:00'), isCustom: true, id: cd.id,
  }))
  const allEvents: CalendarDate[] = [...BUILTINS, ...customCalDates]

  const eventsByDay = new Map<string, CalendarDate[]>()
  for (const ev of allEvents) {
    const k = toKey(ev.date)
    if (!eventsByDay.has(k)) eventsByDay.set(k, [])
    eventsByDay.get(k)!.push(ev)
  }

  // Build calendar grid
  const firstOfMonth = new Date(viewYear, viewMonth, 1)
  const startPad = firstOfMonth.getDay() // 0=Sun
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const cells: Array<number | null> = [
    ...Array(startPad).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  // Pad to complete last row
  while (cells.length % 7 !== 0) cells.push(null)

  const selectedEvents = selectedDay ? (eventsByDay.get(selectedDay) ?? []) : []

  const upcoming = allEvents
    .filter(e => e.date >= today)
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .slice(0, 6)

  return (
    <div className={styles.wrap}>
      {/* Month navigation */}
      <div className={styles.header}>
        <button className={styles.navBtn} onClick={prevMonth} aria-label="Previous month">‹</button>
        <span className={styles.monthLabel}>{MONTH_NAMES[viewMonth]} {viewYear}</span>
        <button className={styles.navBtn} onClick={nextMonth} aria-label="Next month">›</button>
      </div>

      {/* Main layout: calendar left, dates panel right */}
      <div className={styles.mainRow}>
        {/* Left: calendar grid */}
        <div className={styles.calendarCol}>
          {/* Day-of-week headers */}
          <div className={styles.dayHeaders}>
            {DAY_LABELS.map(d => <div key={d} className={styles.dayHeader}>{d}</div>)}
          </div>

          {/* Calendar grid */}
          <div className={styles.grid}>
            {cells.map((day, i) => {
              if (day === null) return <div key={`pad-${i}`} className={styles.cellEmpty} />
              const cellDate = new Date(viewYear, viewMonth, day)
              const key = toKey(cellDate)
              const events = eventsByDay.get(key) ?? []
              const isToday = key === toKey(today)
              const isSelected = selectedDay === key
              const isPast = cellDate < today
              return (
                <button
                  key={key}
                  className={[
                    styles.cell,
                    isToday     ? styles.cellToday    : '',
                    isSelected  ? styles.cellSelected : '',
                    isPast      ? styles.cellPast     : '',
                    events.length ? styles.cellHasEvents : '',
                  ].join(' ')}
                  onClick={() => setSelectedDay(isSelected ? null : key)}
                  aria-label={`${MONTH_NAMES[viewMonth]} ${day}${events.length ? `, ${events.length} event${events.length > 1 ? 's' : ''}` : ''}`}
                >
                  <span className={styles.dayNum}>{day}</span>
                  {events.length > 0 && (
                    <div className={styles.dots}>
                      {events.slice(0, 3).map((ev, di) => (
                        <span key={di} className={`${styles.dot} ${ev.isCustom ? styles.dotCustom : styles.dotBuiltin}`} />
                      ))}
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* Right: dates panel */}
        <div className={styles.datesCol}>
          {showAdd ? (
            <div className={styles.addForm}>
              <div className={styles.addFormTitle}>Add date</div>
              <input
                className={styles.addInput}
                placeholder="Event name"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addCustomDate()}
                autoFocus
              />
              <input
                className={styles.dateInput}
                type="date"
                value={newDate}
                onChange={e => setNewDate(e.target.value)}
                min={today.toISOString().slice(0, 10)}
              />
              <div className={styles.addRow}>
                <button className={styles.addBtn} onClick={addCustomDate} disabled={!newName.trim() || !newDate}>Add</button>
                <button className={styles.cancelBtn} onClick={() => { setShowAdd(false); setNewName(''); setNewDate('') }}>Cancel</button>
              </div>
            </div>
          ) : selectedDay ? (
            <div className={styles.eventList}>
              <div className={styles.eventListTitle}>
                {(() => {
                  const [y, m, d] = selectedDay.split('-').map(Number)
                  return `${MONTH_NAMES[m]} ${d}`
                })()}
              </div>
              {selectedEvents.length === 0 ? (
                <p className={styles.noEvents}>No events</p>
              ) : (
                selectedEvents.map((ev, i) => {
                  const days = daysUntil(ev.date, today)
                  return (
                    <div key={ev.isCustom ? ev.id : `${ev.name}-${i}`} className={`${styles.eventItem} ${days <= 30 && days >= 0 ? styles.eventUrgent : ''}`}>
                      <div className={styles.eventInfo}>
                        <span className={styles.eventName}>{ev.name}</span>
                        {days >= 0 && (
                          <span className={styles.eventCountdown}>
                            {days === 0 ? 'Today!' : days === 1 ? 'Tomorrow' : `${days}d away`}
                          </span>
                        )}
                      </div>
                      {ev.isCustom && (
                        <button className={styles.removeBtn} onClick={() => removeCustomDate(ev.id!)} title="Remove">×</button>
                      )}
                    </div>
                  )
                })
              )}
              <button className={styles.addEventBtn} onClick={() => { setShowAdd(true); setNewDate(`${viewYear}-${String(viewMonth+1).padStart(2,'0')}-${selectedDay.split('-')[2].padStart(2,'0')}`) }}>
                + Add event
              </button>
            </div>
          ) : (
            <div className={styles.upcomingPanel}>
              <div className={styles.upcomingPanelHeader}>
                <span className={styles.upcomingTitle}>Upcoming</span>
                <button className={styles.addEventBtnFloating} onClick={() => setShowAdd(true)}>+ Add</button>
              </div>
              {upcoming.map((ev, i) => {
                const days = daysUntil(ev.date, today)
                return (
                  <div key={i} className={styles.upcomingItem}>
                    <div className={styles.upcomingInfo}>
                      <span className={styles.upcomingName}>{ev.name}</span>
                      <span className={`${styles.upcomingDays} ${days <= 30 ? styles.upcomingUrgent : ''}`}>
                        {days === 0 ? 'Today!' : days === 1 ? '1 day' : `${days}d`}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
