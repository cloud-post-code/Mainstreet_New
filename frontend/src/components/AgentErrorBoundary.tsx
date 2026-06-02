import React from 'react'

interface State { error: Error | null }

interface Props {
  children: React.ReactNode
  fallback?: React.ReactNode
}

export default class AgentErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[AgentErrorBoundary] render failed:', error, info)
  }

  render() {
    if (this.state.error) {
      return this.props.fallback ?? (
        <div style={{
          padding: '12px 14px',
          border: '1px solid #e5b8b0',
          background: '#fdf2f0',
          borderRadius: 8,
          color: '#7a2e22',
          fontSize: 14,
        }}>
          ⚠️ Couldn't render this part of the response. The agent sent something I didn't understand.
        </div>
      )
    }
    return this.props.children
  }
}
