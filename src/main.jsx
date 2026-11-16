import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";
class ErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    return this.state.error ? (
      <div className="fatal">
        <h1>The workspace needs to reload.</h1>
        <p>
          Your saved offline records remain on this device. Do not clear site
          data.
        </p>
        <button onClick={() => location.reload()}>Reload workspace</button>
        <details>
          <summary>Error details</summary>
          <pre>{this.state.error.message}</pre>
        </details>
      </div>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById("root")).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
if (import.meta.env.PROD && "serviceWorker" in navigator)
  window.addEventListener("load", () =>
    navigator.serviceWorker
      .register("/sw.js")
      .catch((error) =>
        console.error("Offline shell registration failed", error),
      ),
  );
