import React from 'react';

// One bad row must not blank the page. Shows what failed and a reload link.
export default class ErrorBoundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidUpdate(prev) { if (prev.resetKey !== this.props.resetKey && this.state.err) this.setState({ err: null }); }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div className="bar warn">
        <p>This page hit an error: {String(this.state.err.message || this.state.err)}</p>
        <p><a href="#/home" onClick={() => location.reload()}>Reload</a></p>
      </div>
    );
  }
}
