import { useState } from 'react'
import { track } from '../analytics/posthog'

type Rating = 'up' | 'down'

interface Props {
  sessionId: number | null
  messageId: string
  surface: 'chat' | 'mason_page'
}

const containerStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  marginTop: 6,
  alignItems: 'center',
  fontSize: 12,
  color: '#6b6b6b',
}

const btnStyle = (active: boolean): React.CSSProperties => ({
  background: active ? '#015237' : 'transparent',
  color: active ? '#f1e9d8' : 'inherit',
  border: '1px solid #d6cdb4',
  borderRadius: 999,
  width: 28,
  height: 24,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  padding: 0,
})

export default function MasonFeedback({ sessionId, messageId, surface }: Props) {
  const [rating, setRating] = useState<Rating | null>(null)
  const [reason, setReason] = useState('')
  const [reasonOpen, setReasonOpen] = useState(false)
  const [reasonSent, setReasonSent] = useState(false)

  const submit = (next: Rating) => {
    if (rating) return
    setRating(next)
    track('mason_response_rated', {
      session_id: sessionId,
      message_id: messageId,
      surface,
      rating: next,
    })
    if (next === 'down') setReasonOpen(true)
  }

  const sendReason = () => {
    const text = reason.trim()
    if (!text || reasonSent) return
    track('mason_response_rated', {
      session_id: sessionId,
      message_id: messageId,
      surface,
      rating: 'down',
      reason: text.slice(0, 500),
      is_reason_followup: true,
    })
    setReasonSent(true)
    setReasonOpen(false)
  }

  return (
    <div style={containerStyle}>
      <span aria-hidden="true">Was this helpful?</span>
      <button
        type="button"
        aria-label="Thumbs up"
        onClick={() => submit('up')}
        disabled={!!rating}
        style={btnStyle(rating === 'up')}
      >
        👍
      </button>
      <button
        type="button"
        aria-label="Thumbs down"
        onClick={() => submit('down')}
        disabled={!!rating}
        style={btnStyle(rating === 'down')}
      >
        👎
      </button>
      {rating && !reasonOpen && !reasonSent && rating === 'up' && (
        <span>Thanks.</span>
      )}
      {reasonOpen && (
        <>
          <input
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="What was off? (optional)"
            style={{
              flex: 1,
              minWidth: 120,
              border: '1px solid #d6cdb4',
              borderRadius: 12,
              padding: '4px 10px',
              fontSize: 12,
            }}
          />
          <button
            type="button"
            onClick={sendReason}
            disabled={!reason.trim()}
            style={btnStyle(false)}
          >
            ↵
          </button>
        </>
      )}
      {reasonSent && <span>Thanks for the feedback.</span>}
    </div>
  )
}
