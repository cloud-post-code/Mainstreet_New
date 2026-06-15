import { InboxMessage } from '../api'
import { formatDate } from '../lib/format'

interface Props {
  messages: InboxMessage[]
  onOpen: (id: number) => void
  emptyClass: string
  listClass: string
  itemClass: string
  unreadClass: string
  dotClass: string
  bodyClass: string
  titleClass: string
  previewClass: string
  dateClass: string
}

export default function MasonInboxTab({
  messages,
  onOpen,
  emptyClass,
  listClass,
  itemClass,
  unreadClass,
  dotClass,
  bodyClass,
  titleClass,
  previewClass,
  dateClass,
}: Props) {
  if (messages.length === 0) {
    return <p className={emptyClass}>No messages yet.</p>
  }

  return (
    <ul className={listClass}>
      {messages.map(msg => (
        <li
          key={msg.id}
          className={`${itemClass} ${msg.read ? '' : unreadClass}`}
          onClick={() => onOpen(msg.id)}
        >
          {!msg.read && <span className={dotClass} aria-label="Unread" />}
          <div className={bodyClass}>
            <p className={titleClass}>{msg.title}</p>
            <p className={previewClass}>{msg.preview}</p>
            <div className={dateClass}>{formatDate(msg.created_at)}</div>
          </div>
        </li>
      ))}
    </ul>
  )
}
