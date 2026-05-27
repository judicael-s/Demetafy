---
paths:
  - "src/ui/**"
  - "src-tauri/capabilities/**"
---

# Tauri dialogs

### Use `@tauri-apps/plugin-dialog` (`confirm`/`ask`/`message`), never `window.confirm`/`alert`/`prompt`
- **Why:** native JS dialogs are unreliable across Tauri webviews (WebView2/WKWebView/WebKitGTK) and can silently no-op in production; 16C shipped a `window.confirm` part-count gate that was swapped out 2026-05-24.
- **How:** when adding any confirm/alert in `src/ui/**`, import from `@tauri-apps/plugin-dialog` AND add the matching `dialog:allow-confirm`/`-ask`/`-message` permission to `src-tauri/capabilities/default.json`, or it errors at runtime.
