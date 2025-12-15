// Ensure Firefox's promise-based `browser` API is available through the
// `chrome` namespace so existing code using `chrome.*` continues to work.
// This is intentionally small and side-effect only.
(() => {
  if (typeof globalThis.chrome === 'undefined' && typeof globalThis.browser !== 'undefined') {
    globalThis.chrome = globalThis.browser;
  }
})();

