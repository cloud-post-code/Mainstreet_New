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
    console.error('[AgentErrorBoundary] render failed:', error, info.componentStack)
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
          ⚠️ Couldn't render this card. {import.meta.env.DEV && this.state.error.message ? (
            <span style={{ display: 'block', marginTop: 6, fontSize: 12, opacity: 0.8 }}>
              {this.state.error.message}
            </span>
          ) : null}
        </div>
      )
    }
    return this.props.children
  }
}
