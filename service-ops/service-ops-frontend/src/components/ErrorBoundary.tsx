import React from 'react'

type Props = {
  children: React.ReactNode
}

type State = {
  hasError: boolean
  errorText: string
}

export default class ErrorBoundary extends React.Component<Props, State> {
  public state: State = { hasError: false, errorText: '' }

  static getDerivedStateFromError(error: unknown): State {
    return {
      hasError: true,
      errorText: String((error as any)?.message ?? error ?? 'Unknown error')
    }
  }

  componentDidCatch(error: unknown, info: unknown) {
    try {
      // eslint-disable-next-line no-console
      console.error('ErrorBoundary caught error:', error, info)
    } catch {
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 16 }}>
          <div style={{ fontWeight: 900, marginBottom: 8 }}>Sayfa hatası</div>
          <div style={{ whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace', fontSize: 12 }}>
            {this.state.errorText}
          </div>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, errorText: '' })}
            style={{ marginTop: 12, height: 34, padding: '0 12px', borderRadius: 10, border: '1px solid #e5e7eb', background: 'white', fontWeight: 700, cursor: 'pointer' }}
          >
            Tekrar Dene
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
