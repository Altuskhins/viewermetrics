// Ensure the `chrome` namespace exposes promise-based APIs so code using
// `await chrome.*` works consistently across browsers.
// This is intentionally small and side-effect only.
(() => {
  const hasBrowser = typeof globalThis.browser !== 'undefined';

  // Prefer Firefox's promise-based `browser` implementation when available.
  if (hasBrowser) {
    globalThis.chrome = globalThis.browser;
    return;
  }

  // For Chrome or other environments that only provide callback-style
  // extension APIs, wrap common storage methods to return Promises when no
  // callback is supplied. This allows `await chrome.storage.local.*()` usage
  // without throwing when the resolved value is `undefined`.
  const storage = globalThis.chrome?.storage?.local;
  if (!storage) return;

  const promisify = (methodName) => {
    const original = storage[methodName];
    if (!original || original.__tvmPromisified) return;

    storage[methodName] = (...args) => {
      const maybeCallback = args[args.length - 1];
      if (typeof maybeCallback === 'function') {
        return original.apply(storage, args);
      }

      return new Promise((resolve, reject) => {
        try {
          original.call(storage, ...args, (result) => {
            const error = globalThis.chrome?.runtime?.lastError;
            if (error) {
              reject(new Error(error.message));
              return;
            }
            resolve(result);
          });
        } catch (err) {
          reject(err);
        }
      });
    };

    storage[methodName].__tvmPromisified = true;
  };

  ['get', 'set', 'remove', 'clear'].forEach(promisify);
})();

