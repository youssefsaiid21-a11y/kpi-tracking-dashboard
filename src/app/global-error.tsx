"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", fontFamily: "system-ui, sans-serif", background: "#0a0a0b", color: "#e4e4e7" }}>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "0.5rem" }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: "0.875rem", color: "#a1a1aa", marginBottom: "1.5rem", maxWidth: "24rem", textAlign: "center" }}>
            An unexpected error occurred. Please try reloading the page.
          </p>
          <div style={{ display: "flex", gap: "0.75rem" }}>
            <button
              onClick={reset}
              style={{ padding: "0.5rem 1rem", fontSize: "0.875rem", fontWeight: 500, borderRadius: "0.5rem", border: "1px solid #27272a", background: "#18181b", color: "#e4e4e7", cursor: "pointer" }}
            >
              Try Again
            </button>
            <button
              onClick={() => { window.location.href = "/"; }}
              style={{ padding: "0.5rem 1rem", fontSize: "0.875rem", fontWeight: 500, borderRadius: "0.5rem", border: "none", background: "#3b82f6", color: "#ffffff", cursor: "pointer" }}
            >
              Reload Page
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
