import React from "react";

export default class ErrorBoundary extends React.Component {
  constructor(props){
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error){
    return { hasError: true, error };
  }

  componentDidCatch(error, info){
    console.error("[Renderer crash]", error, info);
  }

  render(){
    if (!this.state.hasError) return this.props.children;

    const msg = String(this.state.error?.message || this.state.error || "Unknown error");
    return (
      <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
        <h2 style={{ margin: 0 }}>Sentinel hit an error</h2>
        <p style={{ opacity: 0.85, maxWidth: 900 }}>
          The UI crashed while rendering. This page is shown so you don't get a blank window.
        </p>
        <div style={{
          marginTop: 12,
          padding: 12,
          borderRadius: 12,
          background: "rgba(255,255,255,0.06)",
          border: "1px solid rgba(255,255,255,0.12)",
          maxWidth: 1100,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
        }}>
          {msg}
        </div>

        <p style={{ marginTop: 16, opacity: 0.85, maxWidth: 900 }}>
          Tip: If you launched from a terminal, look there for logs. Otherwise open DevTools (View → Toggle Developer Tools)
          and check the Console.
        </p>
      </div>
    );
  }
}
