import { Component, type ReactNode } from 'react'

type State = { error: Error | null }

/** If something unexpected breaks the page, say so calmly and offer a way out instead of a blank screen. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  reset = () => {
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith('lobby:v1:'))
        .forEach((k) => localStorage.removeItem(k))
    } catch {
      /* ignore */
    }
    window.location.reload()
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="wrap">
        <section className="sec welcome">
          <h2>
            <span className="r">!</span> The desk hit a snag
          </h2>
          <p className="sub">Nothing on the chain has changed and your money is safe. This is only the page misbehaving.</p>
          <p className="errtext">{this.state.error.message}</p>
          <div className="acts">
            <button className="btn solid" onClick={() => window.location.reload()}>
              Reload
            </button>
            <button className="btn" onClick={this.reset}>
              Reset local data and reload
            </button>
          </div>
          <p className="note">Resetting only forgets names and invoices kept in this browser. Held payments are read back from the chain.</p>
        </section>
      </div>
    )
  }
}
