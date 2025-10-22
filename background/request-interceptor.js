// Request interceptor to capture authentication headers
export class RequestInterceptor {
  constructor() {
    this.ourRequestTimestamps = new Set();
    this.authHeaders = null;
  }

  init() {
    // Listen to requests before they are sent
    // In Manifest V3, we need to check if extraHeaders is supported
    const extraInfoSpec = ['requestHeaders'];

    // Try to add extraHeaders if available (needed for some headers)
    try {
      chrome.webRequest.onBeforeSendHeaders.addListener(
        (details) => this.handleRequest(details),
        { urls: ['https://gql.twitch.tv/gql'] },
        ['requestHeaders', 'extraHeaders']
      );
      console.log('Request interceptor initialized with extraHeaders');
    } catch (e) {
      // Fallback without extraHeaders
      chrome.webRequest.onBeforeSendHeaders.addListener(
        (details) => this.handleRequest(details),
        { urls: ['https://gql.twitch.tv/gql'] },
        ['requestHeaders']
      );
      console.log('Request interceptor initialized without extraHeaders');
    }
  }

  handleRequest(details) {
    // Check if this request was initiated by our extension
    // Extension requests typically have a different initiator pattern
    if (details.initiator && details.initiator.startsWith('chrome-extension://')) {
      return; // This is likely our own request, ignore it
    }

    // Also check if this timestamp matches one of our recent requests
    const now = Date.now();
    const timestamp = Math.floor(now / 1000) * 1000; // Round to nearest second
    if (this.ourRequestTimestamps.has(timestamp)) {
      return; // This is likely our own request made recently
    }

    // Extract authentication headers
    const headers = {};
    const requiredHeaders = [
      'client-id',
      'client-integrity',
      'client-session-id',
      'client-version',
      'x-device-id'
    ];

    const optionalHeaders = [
      'user-agent',
      'accept-language',
      'authorization'
    ];

    for (const header of details.requestHeaders || []) {
      const headerName = header.name.toLowerCase();

      // Capture required headers
      if (requiredHeaders.includes(headerName)) {
        headers[headerName] = header.value;
      }

      // Capture optional headers
      if (optionalHeaders.includes(headerName)) {
        headers[headerName] = header.value;
      }
    }

    // Only update if we found all required headers
    const foundRequired = requiredHeaders.filter(h => headers[h]).length;
    if (foundRequired === requiredHeaders.length) {
      this.updateAuthHeaders(headers);
    }
  }

  async updateAuthHeaders(headers) {
    // Check if headers have changed by comparing individual values
    const currentHeaders = await chrome.storage.session.get('authHeaders');
    const current = currentHeaders.authHeaders || {};

    // Compare key headers that actually matter
    const keyHeaders = [
      'client-integrity',
      'client-session-id',
      'client-version',
      'x-device-id',
      'authorization'
    ];

    let hasChanged = false;
    for (const key of keyHeaders) {
      if (current[key] !== headers[key]) {
        hasChanged = true;
        break;
      }
    }

    // Also check if we're missing any new headers or have extra old ones
    if (!hasChanged) {
      const currentKeys = Object.keys(current).sort();
      const newKeys = Object.keys(headers).sort();
      hasChanged = JSON.stringify(currentKeys) !== JSON.stringify(newKeys);
    }

    if (hasChanged) {
      this.authHeaders = headers;
      await chrome.storage.session.set({ authHeaders: headers });
      console.log('Auth headers updated');
    }
  }

  registerOurRequest() {
    // Register that we're about to make a request
    const timestamp = Math.floor(Date.now() / 1000) * 1000; // Round to nearest second
    this.ourRequestTimestamps.add(timestamp);

    // Clean up old timestamps after 5 seconds
    setTimeout(() => {
      this.ourRequestTimestamps.delete(timestamp);
    }, 5000);
  }
}
