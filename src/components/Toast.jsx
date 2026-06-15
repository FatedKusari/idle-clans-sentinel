import React, { createContext, useCallback, useContext, useRef, useState } from "react";


const ToastContext = createContext(null);


export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}


export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((message, type = "error") => {
    const id = ++idRef.current;
    setToasts((prev) => [...prev.slice(-4), { id, message: String(message), type }]);
    setTimeout(() => dismiss(id), 4000);
  }, [dismiss]);

  // Convenience shorthands
  toast.error   = (msg) => toast(msg, "error");
  toast.success = (msg) => toast(msg, "success");
  toast.warning = (msg) => toast(msg, "warning");

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}


const TYPE_STYLES = {
  error:   { icon: "✕", bg: "rgba(var(--danger-rgb),0.12)",   border: "rgba(var(--danger-rgb),0.35)",   color: "var(--danger)" },
  success: { icon: "✓", bg: "rgba(var(--success-rgb),0.12)",   border: "rgba(var(--success-rgb),0.35)",   color: "var(--success)" },
  warning: { icon: "⚠", bg: "rgba(var(--warning2-rgb),0.12)", border: "rgba(var(--warning2-rgb),0.35)", color: "var(--warning2)" },
};

function ToastStack({ toasts, onDismiss }) {
  if (!toasts.length) return null;
  return (
    <div style={{
      position: "fixed", bottom: 24, right: 24,
      display: "flex", flexDirection: "column", gap: 8,
      zIndex: 99999, pointerEvents: "none",
      maxWidth: 360,
    }}>
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastItem({ toast: t, onDismiss }) {
  const s = TYPE_STYLES[t.type] || TYPE_STYLES.error;
  return (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: 10,
      background: s.bg,
      border: `1px solid ${s.border}`,
      borderRadius: 10,
      padding: "10px 12px",
      boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
      pointerEvents: "all",
      animation: "toast-in 0.18s ease",
    }}>
      <span style={{ color: s.color, fontWeight: 700, fontSize: 13, flexShrink: 0, marginTop: 1 }}>
        {s.icon}
      </span>
      <span style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.45, flex: 1, wordBreak: "break-word" }}>
        {t.message}
      </span>
      <button
        onClick={() => onDismiss(t.id)}
        style={{
          background: "none", border: "none", cursor: "pointer",
          color: "var(--text)", opacity: 0.4, fontSize: 16,
          padding: 0, lineHeight: 1, flexShrink: 0, marginTop: 1,
        }}
        aria-label="Dismiss"
      >×</button>
    </div>
  );
}
