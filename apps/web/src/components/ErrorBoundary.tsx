import { Component, type ErrorInfo, type ReactNode } from "react";

/** Last line of defence: a render error shows a recoverable message instead of a blank screen. User data is never at risk here. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("UI error:", error.message, info.componentStack?.split("\n")[1]?.trim()); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="card auth">
        <h1>Something went wrong</h1>
        <p>Your data is saved. Please try again.</p>
        <button onClick={() => { this.setState({ failed: false }); }}>Try again</button>
        <button className="ghost" onClick={() => window.location.assign("/")}>Go to home</button>
      </div>
    );
  }
}
