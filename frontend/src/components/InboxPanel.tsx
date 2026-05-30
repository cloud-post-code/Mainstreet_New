import { useEffect, useState } from 'react'
import { api, InboxMessage } from '../api'
import styles from './InboxPanel.module.css'

interface Props {
  token: string
  onClose: () => void
  onOpenSession: (sessionId: number) => void
}

export default function InboxPanel({ token, onClose, onOpenSession }: Props) {
  const [messages, setMessages] = useState<InboxMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [openingId, setOpeningId] = useState<number | null>(null)

  useEffect(() => {
    api.getInbox(token).then(msgs => {
      setMessages(msgs)
      setLoading(false)
    })
  }, [token])

  async function handleOpen(msg: InboxMessage) {
    if (openingId !== null) return
    setOpeningId(msg.id)
    try {
      const { session_id } = await api.openInboxMessage(msg.id, token)
      setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, read: true, session_id } : m))
      onOpenSession(session_id)
      onClose()
    } finally {
      setOpeningId(null)
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.panel} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>Inbox</h2>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close inbox">✕</button>
        </div>

        {loading && <p className={styles.empty}>Loading…</p>}
        {!loading && messages.length === 0 && (
          <p className={styles.empty}>No messages yet.</p>
        )}

        <ul className={styles.list}>
          {messages.map(msg => (
            <li
              key={msg.id}
              className={`${styles.item} ${msg.read ? styles.read : styles.unread}`}
              onClick={() => handleOpen(msg)}
            >
              {!msg.read && <span className={styles.dot} aria-label="Unread" />}
              <div className={styles.itemBody}>
                <p className={styles.itemTitle}>{msg.title}</p>
                <p className={styles.itemPreview}>{msg.preview}</p>
                <span className={styles.itemDate}>
                  {new Date(msg.created_at).toLocaleDateString()}
                </span>
              </div>
              {openingId === msg.id && <span className={styles.spinner}>…</span>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
