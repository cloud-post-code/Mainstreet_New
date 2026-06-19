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

function nthWeekday(year: number, month: number, weekday: number, nth: number): Date {
  // month is 1-based; weekday 0=Sun
  const d = new Date(year, month - 1, 1)
  let count = 0
  while (true) {
    if (d.getDay() === weekday) {
      count++
      if (count === nth) return new Date(d)
    }
    d.setDate(d.getDate() + 1)
  }
}

function lastWeekday(year: number, month: number, weekday: number): Date {
  // last weekday of the month
  const d = new Date(year, month, 0) // last day of month
  while (d.getDay() !== weekday) d.setDate(d.getDate() - 1)
  return new Date(d)
}

function getNextOccurrence(buildDate: (year: number) => Date, today: Date): Date {
  const thisYear = buildDate(today.getFullYear())
  // Use >= so today counts as upcoming
  if (thisYear >= today) return thisYear
  return buildDate(today.getFullYear() + 1)
}

function buildBuiltinDates(today: Date): CalendarDate[] {
  const fixed = (month: number, day: number) => (year: number) => new Date(year, month - 1, day)

  const thanksgivingDate = (year: number) => nthWeekday(year, 11, 4, 4) // 4th Thu of Nov
  const blackFridayDate = (year: number) => {
    const t = thanksgivingDate(year)
    const bf = new Date(t)
    bf.setDate(t.getDate() + 1)
    return bf
  }
  const cyberMondayDate = (year: number) => {
    const bf = blackFridayDate(year)
    const cm = new Date(bf)
    cm.setDate(bf.getDate() + 3) // Monday after Black Friday
    return cm
  }

  const entries: Array<{ name: string; fn: (year: number) => Date }> = [
    { name: "Valentine's Day", fn: fixed(2, 14) },
    { name: "Mother's Day", fn: (y) => nthWeekday(y, 5, 0, 2) }, // 2nd Sun of May
    { name: 'Memorial Day', fn: (y) => lastWeekday(y, 5, 1) }, // last Mon of May
    { name: "Father's Day", fn: (y) => nthWeekday(y, 6, 0, 3) }, // 3rd Sun of Jun
    { name: '4th of July', fn: fixed(7, 4) },
    { name: 'Labor Day', fn: (y) => nthWeekday(y, 9, 1, 1) }, // 1st Mon of Sep
    { name: 'Halloween', fn: fixed(10, 31) },
    { name: 'Thanksgiving', fn: thanksgivingDate },
    { name: 'Black Friday', fn: blackFridayDate },
    { name: 'Cyber Monday', fn: cyberMondayDate },
    { name: 'Christmas', fn: fixed(12, 25) },
    { name: "New Year's", fn: fixed(1, 1) },
    // Hardcoded variable holidays for 2026
    { name: 'Hanukkah', fn: (y) => y === 2026 ? new Date(2026, 11, 4) : fixed(12, 4)(y) },
    { name: 'Easter', fn: (y) => y === 2026 ? new Date(2026, 3, 5) : fixed(4, 5)(y) },
  ]

  return entries.map(({ name, fn }) => ({
    name,
    date: getNextOccurrence(fn, today),
    isCustom: false,
  }))
}

function daysUntil(date: Date, today: Date): number {
  const ms = date.getTime() - today.getTime()
  return Math.ceil(ms / (1000 * 60 * 60 * 24))
}

function formatDateLabel(date: Date): string {
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

function loadCustomDates(): CustomDate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as CustomDate[]) : []
  } catch {
    return []
  }
}

function saveCustomDates(dates: CustomDate[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(dates))
}

export default function ShoppingCalendar() {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const builtins = buildBuiltinDates(today)

  const [customDates, setCustomDates] = useState<CustomDate[]>(loadCustomDates)
  const [newName, setNewName] = useState('')
  const [newDate, setNewDate] = useState('')

  useEffect(() => {
    saveCustomDates(customDates)
  }, [customDates])

  function addCustomDate() {
    if (!newName.trim() || !newDate) return
    const entry: CustomDate = {
      id: `${Date.now()}-${Math.random()}`,
      name: newName.trim(),
      date: newDate,
    }
    setCustomDates(prev => [...prev, entry])
    setNewName('')
    setNewDate('')
  }

  function removeCustomDate(id: string) {
    setCustomDates(prev => prev.filter(d => d.id !== id))
  }

  // Merge and sort
  const customCalendarDates: CalendarDate[] = customDates.map(cd => ({
    name: cd.name,
    date: new Date(cd.date + 'T00:00:00'),
    isCustom: true,
    id: cd.id,
  }))

  const allDates = [...builtins, ...customCalendarDates]
    .filter(d => d.date >= today)
    .sort((a, b) => a.date.getTime() - b.date.getTime())

  return (
    <div className={styles.calendar}>
      <div className={styles.addForm}>
        <input
          className={styles.addInput}
          placeholder="Event name"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addCustomDate()}
        />
        <input
          className={styles.dateInput}
          type="date"
          value={newDate}
          onChange={e => setNewDate(e.target.value)}
          min={today.toISOString().slice(0, 10)}
        />
        <button
          className={styles.addBtn}
          onClick={addCustomDate}
          disabled={!newName.trim() || !newDate}
        >
          Add
        </button>
      </div>

      <ul className={styles.list}>
        {allDates.map((entry, i) => {
          const days = daysUntil(entry.date, today)
          const urgent = days <= 30
          return (
            <li key={entry.isCustom ? entry.id : `${entry.name}-${i}`} className={`${styles.item} ${urgent ? styles.urgent : ''}`}>
              <div className={styles.itemLeft}>
                <span className={styles.itemName}>{entry.name}</span>
                <span className={styles.itemDate}>{formatDateLabel(entry.date)}</span>
              </div>
              <div className={styles.itemRight}>
                <span className={`${styles.countdown} ${urgent ? styles.countdownUrgent : ''}`}>
                  {days === 0 ? 'Today!' : days === 1 ? '1 day' : `${days} days`}
                </span>
                {entry.isCustom && (
                  <span className={styles.customBadge}>custom</span>
                )}
                {entry.isCustom && (
                  <button
                    className={styles.removeBtn}
                    onClick={() => removeCustomDate(entry.id!)}
                    title="Remove"
                    aria-label={`Remove ${entry.name}`}
                  >
                    ×
                  </button>
                )}
              </div>
            </li>
          )
        })}
        {allDates.length === 0 && (
          <li className={styles.empty}>No upcoming dates.</li>
        )}
      </ul>
    </div>
  )
}
