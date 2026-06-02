import { useNavigate, Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import InboxPanel from '../components/InboxPanel'

export default function Inbox() {
  const { token } = useAuth()
  const navigate = useNavigate()

  if (!token) return <Navigate to="/login" replace />

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: '0 auto' }}>
      <InboxPanel
        token={token}
        onClose={() => navigate('/')}
        onOpenSession={sessionId => {
          navigate(`/?session=${sessionId}`)
        }}
      />
    </div>
  )
}
