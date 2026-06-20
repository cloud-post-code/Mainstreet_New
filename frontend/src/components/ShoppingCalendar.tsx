import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import styles from './ShoppingCalendar.module.css'
import { api } from '../api'
import { useAuth } from '../hooks/useAuth'

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

function formatChipDate(date: Date): string {
  return `${MONTH_NAMES[date.getMonth()].slice(0,3)} ${date.getDate()}`
}

export default function ShoppingCalendar() {
  const today = new Date(); today.setHours(0,0,0,0)
  const navigate = useNavigate()
  const { token } = useAuth()

  const [viewYear,  setViewYear]  = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth())
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [customDates, setCustomDates] = useState<CustomDate[]>(loadCustom)
  const [newName, setNewName] = useState('')
  const [newDate, setNewDate] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [gcalStatus, setGcalStatus] = useState<'idle' | 'loading' | 'connected' | 'error'>('idle')
  const [gcalEvents, setGcalEvents] = useState<CustomDate[]>([])

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(customDates)) }, [customDates])

  // Load Google Calendar status on mount
  useEffect(() => {
    if (!token) return
    api.gcalStatus(token)
      .then(r => {
        if (r.connected) {
          setGcalStatus('connected')
          if (r.events) {
            setGcalEvents(r.events.map((e: { id: string; name: string; date: string }) => ({
              id: `gcal-${e.id}`,
              name: e.name,
              date: e.date,
            })))
          }
        }
      })
      .catch(() => { /* not connected yet */ })
  }, [token])

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

  function openShoppingChat(holidayName: string) {
    const message = `I want to shop for ${holidayName}. Help me find the perfect gifts and products!`
    navigate('/', { state: { seedMessage: message } })
  }

  function handleGcalConnect() {
    window.location.href = '/api/gcal/connect'
  }

  async function handleGcalDisconnect() {
    if (!token) return
    await api.gcalDisconnect(token).catch(() => {})
    setGcalStatus('idle')
    setGcalEvents([])
  }

  async function handleGcalSync() {
    if (!token) return
    setGcalStatus('loading')
    try {
      const r = await api.gcalSync(token)
      setGcalEvents(r.events.map((e: { id: string; name: string; date: string }) => ({
        id: `gcal-${e.id}`,
        name: e.name,
        date: e.date,
      })))
      setGcalStatus('connected')
    } catch {
      setGcalStatus('error')
    }
  }

  const customCalDates: CalendarDate[] = customDates.map(cd => ({
    name: cd.name, date: new Date(cd.date + 'T00:00:00'), isCustom: true, id: cd.id,
  }))
  const gcalCalDates: CalendarDate[] = gcalEvents.map(cd => ({
    name: cd.name, date: new Date(cd.date + 'T00:00:00'), isCustom: true, id: cd.id,
  }))
  const allEvents: CalendarDate[] = [...BUILTINS, ...customCalDates, ...gcalCalDates]

  const eventsByDay = new Map<string, CalendarDate[]>()
  for (const ev of allEvents) {
    const k = toKey(ev.date)
    if (!eventsByDay.has(k)) eventsByDay.set(k, [])
    eventsByDay.get(k)!.push(ev)
  }

  const firstOfMonth = new Date(viewYear, viewMonth, 1)
  const startPad = firstOfMonth.getDay()
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const cells: Array<number | null> = [
    ...Array(startPad).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  const selectedEvents = selectedDay ? (eventsByDay.get(selectedDay) ?? []) : []

  // Upcoming holidays (builtins only) sorted by date, deduplicated by name keeping closest
  const seenNames = new Set<string>()
  const upcomingHolidays = BUILTINS
    .filter(e => e.date >= today)
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .filter(e => { if (seenNames.has(e.name)) return false; seenNames.add(e.name); return true })
    .slice(0, 8)

  return (
    <div className={styles.wrap}>
      {/* Month navigation */}
      <div className={styles.header}>
        <button className={styles.navBtn} onClick={prevMonth} aria-label="Previous month">‹</button>
        <span className={styles.monthLabel}>{MONTH_NAMES[viewMonth]} {viewYear}</span>
        <button className={styles.navBtn} onClick={nextMonth} aria-label="Next month">›</button>
      </div>

      {/* Calendar grid */}
      <div className={styles.calendarSection}>
        <div className={styles.dayHeaders}>
          {DAY_LABELS.map(d => <div key={d} className={styles.dayHeader}>{d}</div>)}
        </div>
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

      {/* Selected day event detail */}
      {selectedDay && (
        <div className={styles.selectedPanel}>
          <div className={styles.selectedTitle}>
            {(() => {
              const [y, m, d] = selectedDay.split('-').map(Number)
              return `${MONTH_NAMES[m]} ${d}, ${y}`
            })()}
          </div>
          {selectedEvents.length === 0 ? (
            <p className={styles.noEvents}>No events</p>
          ) : (
            <div className={styles.selectedEvents}>
              {selectedEvents.map((ev, i) => {
                const days = daysUntil(ev.date, today)
                return (
                  <div key={ev.isCustom ? ev.id : `${ev.name}-${i}`} className={styles.selectedEventRow}>
                    <div className={styles.selectedEventInfo}>
                      <span className={styles.selectedEventName}>{ev.name}</span>
                      {days >= 0 && (
                        <span className={styles.selectedEventDays}>
                          {days === 0 ? 'Today!' : days === 1 ? 'Tomorrow' : `${days}d away`}
                        </span>
                      )}
                    </div>
                    <div className={styles.selectedEventActions}>
                      {!ev.isCustom && (
                        <button
                          className={styles.shopBtn}
                          onClick={() => openShoppingChat(ev.name)}
                        >
                          Shop
                        </button>
                      )}
                      {ev.isCustom && ev.id && !ev.id.startsWith('gcal-') && (
                        <button className={styles.removeBtn} onClick={() => removeCustomDate(ev.id!)} title="Remove">×</button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          <button
            className={styles.addEventBtn}
            onClick={() => {
              setShowAdd(true)
              setNewDate(`${viewYear}-${String(viewMonth+1).padStart(2,'0')}-${selectedDay.split('-')[2].padStart(2,'0')}`)
            }}
          >
            + Add event
          </button>
        </div>
      )}

      {/* Add custom date form */}
      {showAdd && (
        <div className={styles.addForm}>
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
            <button className={styles.addBtn} onClick={addCustomDate} disabled={!newName.trim() || !newDate}>Save</button>
            <button className={styles.cancelBtn} onClick={() => { setShowAdd(false); setNewName(''); setNewDate('') }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Holiday chips */}
      <div className={styles.chipsSection}>
        <div className={styles.chipsSectionHeader}>
          <span className={styles.chipsSectionTitle}>Holidays — tap to shop</span>
          <button className={styles.addEventBtnSmall} onClick={() => setShowAdd(v => !v)}>+ Add date</button>
        </div>
        <div className={styles.chips}>
          {upcomingHolidays.map((ev, i) => {
            const days = daysUntil(ev.date, today)
            const urgent = days <= 30
            return (
              <button
                key={i}
                className={`${styles.chip} ${urgent ? styles.chipUrgent : ''}`}
                onClick={() => openShoppingChat(ev.name)}
                title={`Shop for ${ev.name} — ${formatChipDate(ev.date)}`}
              >
                <span className={styles.chipName}>{ev.name}</span>
                <span className={styles.chipDate}>{formatChipDate(ev.date)}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Google Calendar sync */}
      <div className={styles.gcalSection}>
        {gcalStatus === 'idle' && (
          <button className={styles.gcalConnectBtn} onClick={handleGcalConnect}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
              <line x1="16" y1="2" x2="16" y2="6"/>
              <line x1="8" y1="2" x2="8" y2="6"/>
              <line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
            Sync Google Calendar
          </button>
        )}
        {gcalStatus === 'loading' && (
          <span className={styles.gcalSyncing}>Syncing…</span>
        )}
        {gcalStatus === 'connected' && (
          <div className={styles.gcalConnected}>
            <span className={styles.gcalConnectedLabel}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#015237" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              Google Calendar synced
              {gcalEvents.length > 0 && ` · ${gcalEvents.length} events`}
            </span>
            <div className={styles.gcalActions}>
              <button className={styles.gcalSyncBtn} onClick={handleGcalSync}>Refresh</button>
              <button className={styles.gcalDisconnectBtn} onClick={handleGcalDisconnect}>Disconnect</button>
            </div>
          </div>
        )}
        {gcalStatus === 'error' && (
          <span className={styles.gcalError}>Sync failed — <button className={styles.gcalRetryBtn} onClick={handleGcalSync}>retry</button></span>
        )}
      </div>
    </div>
  )
}
