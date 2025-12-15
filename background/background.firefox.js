// Firefox-compatible background script (non-module)
// Combines ApiManager, timeout utilities, and BackgroundService into a single file

// Timeout utility functions (from shared/timeout-utils.module.js)
function calculateAutoTimeout(totalAuthenticatedCount) {
  if (!totalAuthenticatedCount) {
    return null; // Caller should use default
  }

  // Tiered timeout system (optimized for concurrent API processing):
  // Based on real performance: 33,000 users = 60-120 seconds
  // Base timeout starts at 1 minute + calculated value
  // <1000 users: 45 seconds + 1 minute = 1:45
  // <5000 users: 1 minute + 1 minute = 2 minutes
  // <15000 users: 90 seconds + 1 minute = 2:30
  // 15000+ users: 2 minutes base + 10 seconds per 10000 additional users + 1 minute
  let timeoutMinutes;

  if (totalAuthenticatedCount < 1000) {
    timeoutMinutes = 0.75; // 45 seconds
  } else if (totalAuthenticatedCount < 5000) {
    timeoutMinutes = 1; // 1 minute
  } else if (totalAuthenticatedCount < 15000) {
    timeoutMinutes = 1.5; // 90 seconds
  } else {
    // 15000+ viewers: 2 minutes base + 10 seconds per 10000 viewers
    timeoutMinutes = 2 + Math.floor((totalAuthenticatedCount - 15000) / 10000) * 0.167;
  }

  // Add 1 minute base timeout to calculated value
  const baseMinutes = 1;
  return (timeoutMinutes + baseMinutes) * 60000; // Convert to milliseconds
}

function calculateAutoRequestInterval(totalAuthenticatedCount) {
  if (!totalAuthenticatedCount) {
    return null; // Caller should use default
  }

  // Tiered request interval:
  // <1000 users: 5 seconds
  // <5000 users: 2 seconds
  // 5000+ users: 1 second
  if (totalAuthenticatedCount < 1000) return 5000;
  if (totalAuthenticatedCount < 5000) return 2000;
  return 1000;
}

// API Manager for GQL requests with rate limiting
class ApiManager {
  constructor() {
    this.requestQueue = [];
    this.requestCount = 0;
    this.maxRequests = 5000; // API call limit per minute
    this.requestWindow = 60000; // 1 minute
    this.isProcessing = false;
    this.lastResetTime = Date.now();

    // Configuration for user data fetching method
    this.useGraphQLUserBasic = true; // Default to new GraphQL method

    // Concurrent processing configuration
    this.concurrentUserInfoBatches = 50; // Max concurrent requests (default, can be updated via config)

    // Data usage tracking
    this.dataStats = {
      totalBytesSent: 0,
      totalBytesReceived: 0,
      totalApiCalls: 0,
      recentRequests: [] // Array of { timestamp, bytesSent, bytesReceived }
    };

    this.init();
  }

  async init() {
    // Start processing queue
    this.processQueue();
  }

  updateConfig(config) {
    this.useGraphQLUserBasic = config.useGraphQLUserBasic !== undefined ?
      config.useGraphQLUserBasic : this.useGraphQLUserBasic;

    this.concurrentUserInfoBatches = config.concurrentUserInfoBatches !== undefined ?
      config.concurrentUserInfoBatches : this.concurrentUserInfoBatches;
  }

  getTwitchHeaders() {
    // Simplified headers using alternate client ID
    return {
      'Client-Id': 'kd1unb4b3q4t58fwlpcbzcbnm76a8fp',
      'Content-Type': 'application/json'
    };
  }

  async makeRequest(url, options, priority = 2) {
    return new Promise((resolve, reject) => {
      this.requestQueue.push({
        url,
        options,
        priority,
        resolve,
        reject,
        timestamp: Date.now()
      });

      // Sort queue by priority (lower number = higher priority)
      this.requestQueue.sort((a, b) => a.priority - b.priority);

      // Start processing if not already running
      if (!this.isProcessing) {
        this.processQueue();
      }
    });
  }

  async processQueue() {
    if (this.isProcessing || this.requestQueue.length === 0) {
      return;
    }

    this.isProcessing = true;

    // Always use concurrent processing
    await this.processConcurrentRequests();

    this.isProcessing = false;

    // Auto-restart processing if queue has new items
    if (this.requestQueue.length > 0) {
      this.processQueue();
    }
  }

  async processConcurrentRequests() {
    // Process requests concurrently (up to concurrentUserInfoBatches at a time)

    while (this.requestQueue.length > 0) {
      // Use rolling window rate limiting (matches actual requests per minute display)
      const now = Date.now();
      const oneMinuteAgo = now - 60000;
      const requestsInLastMinute = this.dataStats.recentRequests.filter(
        req => req.timestamp > oneMinuteAgo
      ).length;

      // Check if we've hit the rate limit based on rolling window
      if (requestsInLastMinute >= this.maxRequests) {
        console.warn('Rate limit reached (rolling window), waiting...');
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }

      // Take multiple requests for concurrent processing
      const concurrentRequests = [];
      const maxConcurrent = Math.min(
        this.concurrentUserInfoBatches,
        this.maxRequests - requestsInLastMinute,
        this.requestQueue.length
      );

      for (let i = 0; i < maxConcurrent; i++) {
        const request = this.requestQueue.shift();
        if (request) {
          concurrentRequests.push(request);
        }
      }

      if (concurrentRequests.length === 0) {
        break;
      }

      // Execute requests concurrently
      await this.executeConcurrentRequests(concurrentRequests);

      // No delay - process next batch immediately to maximize throughput
    }
  }

  async executeConcurrentRequests(requests) {
    const promises = requests.map(request => this.executeRequest(request));

    try {
      await Promise.allSettled(promises);
    } catch (error) {
      console.error('Error in concurrent request processing:', error);
    }
  }

  async executeRequest(request) {
    try {
      // Calculate bytes sent (approximate)
      const bytesSent = this.calculateRequestSize(request.url, request.options);

      const response = await fetch(request.url, request.options);
      this.requestCount++;

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      // Calculate bytes received (approximate)
      const bytesReceived = this.calculateResponseSize(data);

      // Track data usage
      this.trackDataUsage(bytesSent, bytesReceived);

      request.resolve(data);
    } catch (error) {
      console.error('Request failed:', error);
      request.reject(error);
    }
  }

  async getViewerCount(channelName) {
    const query = `
      query {
        user(login: "${channelName}") {
          stream {
            viewersCount
          }
        }
      }
    `;

    try {
      const response = await this.makeRequest(
        'https://gql.twitch.tv/gql',
        {
          method: 'POST',
          headers: this.getTwitchHeaders(),
          body: JSON.stringify({ query })
        },
        1 // High priority
      );

      return response.data?.user?.stream?.viewersCount || 0;
    } catch (error) {
      console.error('Error fetching viewer count:', error);
      return 0;
    }
  }

  async getViewerList(channelName) {
    const payload = [{
      "operationName": "CommunityTab",
      "variables": {
        "limit": 10000,
        "cursor": "",
        "login": channelName,
        "order": "RECENTLY_ACTIVE"
      },
      "extensions": {
        "persistedQuery": {
          "version": 1,
          "sha256Hash": "0aacd9d251e685101c71c2cc73b28ccbe1891d129183afed6219ffe9f85c4a64"
        }
      }
    }];

    try {
      const response = await this.makeRequest(
        'https://gql.twitch.tv/gql',
        {
          method: 'POST',
          headers: this.getTwitchHeaders(),
          body: JSON.stringify(payload)
        },
        2 // Medium priority
      );

      // Extract viewers list from the response
      const viewers = response[0]?.data?.user?.community?.edges?.map(edge => edge.node.login) || [];
      const totalAuthenticatedCount = response[0]?.data?.user?.community?.totalCount || 0;

      return { viewers, totalAuthenticatedCount };
    } catch (error) {
      console.error('Error fetching viewer list:', error);
      return { viewers: [], totalAuthenticatedCount: 0 };
    }
  }

  async getViewerListParallel(channelName, concurrentCalls = 50) {
    // First get initial viewer list to get total count and cursor
    const initialPayload = [{
      "operationName": "CommunityTab",
      "variables": {
        "limit": 100,
        "cursor": "",
        "login": channelName,
        "order": "RECENTLY_ACTIVE"
      },
      "extensions": {
        "persistedQuery": {
          "version": 1,
          "sha256Hash": "0aacd9d251e685101c71c2cc73b28ccbe1891d129183afed6219ffe9f85c4a64"
        }
      }
    }];

    try {
      const initialResponse = await this.makeRequest(
        'https://gql.twitch.tv/gql',
        {
          method: 'POST',
          headers: this.getTwitchHeaders(),
          body: JSON.stringify(initialPayload)
        },
        1 // High priority for initial fetch
      );

      const initialEdges = initialResponse[0]?.data?.user?.community?.edges || [];
      const initialCursor = initialEdges.length > 0 ? initialEdges[initialEdges.length - 1].cursor : null;
      const totalAuthenticatedCount = initialResponse[0]?.data?.user?.community?.totalCount || 0;

      // If we don't have many viewers, just return the initial list
      if (totalAuthenticatedCount <= 100 || !initialCursor) {
        const viewers = initialEdges.map(edge => edge.node.login);
        return { viewers, totalAuthenticatedCount };
      }

      // Calculate how many pages we need
      const pageSize = 100;
      const remainingViewers = Math.max(0, totalAuthenticatedCount - initialEdges.length);
      const pagesNeeded = Math.ceil(remainingViewers / pageSize);

      // Generate payloads for remaining pages with cursors
      const payloads = [];
      let currentCursor = initialCursor;

      // Create enough payloads to potentially overshoot, we'll stop when we run out of pages
      for (let i = 0; i < pagesNeeded; i++) {
        payloads.push({
          "operationName": "CommunityTab",
          "variables": {
            "limit": 100,
            "cursor": currentCursor,
            "login": channelName,
            "order": "RECENTLY_ACTIVE"
          },
          "extensions": {
            "persistedQuery": {
              "version": 1,
              "sha256Hash": "0aacd9d251e685101c71c2cc73b28ccbe1891d129183afed6219ffe9f85c4a64"
            }
          }
        });
      }

      // Process payloads in batches to avoid overwhelming the API
      const batchSize = Math.min(concurrentCalls, this.concurrentUserInfoBatches);
      let viewers = initialEdges.map(edge => edge.node.login);

      for (let i = 0; i < payloads.length; i += batchSize) {
        const batch = payloads.slice(i, i + batchSize);

        try {
          const responses = await this.makeRequest(
            'https://gql.twitch.tv/gql',
            {
              method: 'POST',
              headers: this.getTwitchHeaders(),
              body: JSON.stringify(batch)
            },
            2 // Medium priority
          );

          for (const response of responses) {
            const edges = response?.data?.user?.community?.edges || [];
            viewers = viewers.concat(edges.map(edge => edge.node.login));
          }

          // Stop if we've collected enough viewers
          if (viewers.length >= totalAuthenticatedCount) {
            break;
          }
        } catch (error) {
          console.error('Error in batch processing:', error);
        }
      }

      return { viewers: Array.from(new Set(viewers)), totalAuthenticatedCount };
    } catch (error) {
      console.error('Error fetching viewer list in parallel:', error);
      return { viewers: [], totalAuthenticatedCount: 0 };
    }
  }

  async getUserInfo(channelName, usernames, priority = 3) {
    try {
      if (!usernames || usernames.length === 0) {
        return [];
      }

      // Decide which method to use based on configuration
      if (this.useGraphQLUserBasic) {
        return await this.getUserInfoGraphQLBasic(usernames, priority);
      }

      // Fallback to the previous method
      const apiUrl = 'https://gql.twitch.tv/gql';
      const payload = usernames.map(username => ({
        "operationName": "ChannelPointsContext",
        "variables": {
          "channelLogin": channelName,
          "includeChannelPoints": true,
          "isCollectionContent": true,
          "lookupType": "ACTIVE",
          "userLogin": username
        },
        "extensions": {
          "persistedQuery": {
            "version": 1,
            "sha256Hash": "854c7440c4e4513b0c4d8f1ef863f282084210777eecbba6c197b8a95da77517"
          }
        }
      }));

      const response = await this.makeRequest(
        apiUrl,
        {
          method: 'POST',
          headers: this.getTwitchHeaders(),
          body: JSON.stringify(payload)
        },
        priority
      );

      // Extract user info from each response
      return response.map(item => ({
        username: item.data.community.user.displayName,
        id: item.data.community.user.id,
        createdAt: item.data.community.user.createdAt,
        isSubscriber: item.data.community.isSubscriber,
        isModerator: item.data.community.isModerator,
        hasPrime: item.data.community.user.hasPrime,
        chatColor: item.data.community.user.chatColor,
        communityPoints: item.data.community.availableCommunityPoints,
        lastSeen: Date.now()
      }));
    } catch (error) {
      console.error('Error fetching user info:', error);
      return [];
    }
  }

  async getUserInfoGraphQLBasic(usernames, priority = 3) {
    try {
      const apiUrl = 'https://gql.twitch.tv/gql';

      const payload = usernames.map(username => ({
        "operationName": "UserBasic",
        "variables": {
          "login": username
        },
        "extensions": {
          "persistedQuery": {
            "version": 1,
            "sha256Hash": "e13c1688ef9571437b0fc61da3f7d7f71155898ac470fba061d91c9f54a5e5ca"
          }
        }
      }));

      const response = await this.makeRequest(
        apiUrl,
        {
          method: 'POST',
          headers: this.getTwitchHeaders(),
          body: JSON.stringify(payload)
        },
        priority
      );

      // Extract basic user info from each response
      return response.map(item => ({
        username: item.data.user.displayName,
        id: item.data.user.id,
        createdAt: item.data.user.createdAt,
        hasPrime: item.data.user.hasPrime,
        chatColor: item.data.user.chatColor,
        lastSeen: Date.now()
      }));
    } catch (error) {
      console.error('Error fetching user info (GraphQL Basic):', error);
      return [];
    }
  }

  async getUserFollowing(usernames, options = {}, priority = 3) {
    try {
      const apiUrl = 'https://gql.twitch.tv/gql';

      // Each username gets its own request in the batch
      const payload = usernames.map(username => ({
        "operationName": "FollowingLiveBrowsi",
        "variables": {
          "username": username,
          "limit": options.limit || 100,
          "order": options.order || "DESC"
        },
        "extensions": {
          "persistedQuery": {
            "version": 1,
            "sha256Hash": "3d0f1e06cb52110919e1d5dbeb11d814c0b25a9c3d8cce67a406225e01e5b865"
          }
        }
      }));

      const response = await this.makeRequest(
        apiUrl,
        {
          method: 'POST',
          headers: this.getTwitchHeaders(),
          body: JSON.stringify(payload)
        },
        priority
      );

      return response.map(item => ({
        username: item.data.user.displayName,
        following: item.data.user.following?.edges?.map(edge => ({
          login: edge.node.login,
          id: edge.node.id,
          displayName: edge.node.displayName,
          stream: edge.node.stream ? {
            id: edge.node.stream.id,
            title: edge.node.stream.title,
            viewersCount: edge.node.stream.viewersCount,
            type: edge.node.stream.type
          } : null
        })) || []
      }));
    } catch (error) {
      console.error('Error fetching user following:', error);
      return [];
    }
  }

  getRateLimitStatus() {
    // Calculate requests in current rolling window
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    const requestsInLastMinute = this.dataStats.recentRequests.filter(req => req.timestamp > oneMinuteAgo).length;

    return {
      currentRequests: requestsInLastMinute,
      maxRequests: this.maxRequests,
      remainingRequests: Math.max(0, this.maxRequests - requestsInLastMinute),
      resetIn: Math.max(0, this.requestWindow - (now - this.lastResetTime))
    };
  }

  calculateRequestSize(url, options) {
    let size = url.length;
    if (options.headers) {
      size += JSON.stringify(options.headers).length;
    }
    if (options.body) {
      size += options.body.length;
    }
    return size;
  }

  calculateResponseSize(data) {
    return JSON.stringify(data).length;
  }

  trackDataUsage(bytesSent, bytesReceived) {
    const timestamp = Date.now();
    this.dataStats.totalBytesSent += bytesSent;
    this.dataStats.totalBytesReceived += bytesReceived;
    this.dataStats.totalApiCalls++;

    // Track recent requests (keep last 1000)
    this.dataStats.recentRequests.push({ timestamp, bytesSent, bytesReceived });
    if (this.dataStats.recentRequests.length > 1000) {
      this.dataStats.recentRequests.shift();
    }
  }

  getDataUsageStats() {
    return {
      ...this.dataStats,
      requestsInLastMinute: this.dataStats.recentRequests.filter(req => req.timestamp > Date.now() - 60000).length
    };
  }

  clearQueue() {
    this.requestQueue = [];
    this.isProcessing = false;
  }
}

// Background service worker logic
class BackgroundService {
  constructor() {
    this.apiManager = new ApiManager();
    this.activeChannels = new Map(); // channelName -> { tabId, isActive }

    // Background tracking state
    this.trackingSessions = new Map(); // channelName -> { config, intervals, data, tabId }

    this.init();
  }

  init() {
    // Listen for messages from content scripts
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message, sender, sendResponse);
      return true; // Keep channel open for async response
    });
  }

  async handleMessage(message, sender, sendResponse) {
    try {
      switch (message.type) {
        case 'FORCE_START_TRACKING':
          const forceResult = await this.forceStartTracking(message.channelName, sender.tab.id);
          sendResponse(forceResult);
          break;

        case 'GET_USER_INFO':
          const userInfo = await this.apiManager.getUserInfo(
            message.channelName,
            message.usernames,
            message.priority || 3 // Default to low priority if not specified
          );
          sendResponse({ success: true, userInfo });
          break;

        case 'GET_USER_FOLLOWING':
          const followingData = await this.apiManager.getUserFollowing(
            message.usernames,
            message.options || {},
            message.priority || 3 // Default to low priority if not specified
          );
          sendResponse({ success: true, followingData });
          break;

        case 'UPDATE_API_CONFIG':
          this.apiManager.updateConfig(message.config);
          sendResponse({ success: true });
          break;

        case 'GET_AUTH_STATUS':
          sendResponse({
            success: true,
            hasAuth: true // Always true now - using simplified headers
          });
          break;

        case 'GET_RATE_LIMIT_STATUS':
          const rateLimitStatus = this.apiManager.getRateLimitStatus();
          sendResponse({
            success: true,
            status: rateLimitStatus
          });
          break;

        case 'getDataUsageStats':
          const dataUsageStats = this.apiManager.getDataUsageStats();
          sendResponse(dataUsageStats);
          break;

        case 'openViewerPage':
          try {
            const viewerPageURL = chrome.runtime.getURL('pages/viewer.html');
            const tab = await chrome.tabs.create({ url: viewerPageURL });
            sendResponse({ success: true, tabId: tab.id });
          } catch (error) {
            console.error('Error opening viewer page:', error);
            sendResponse({ success: false, error: error.message });
          }
          break;

        case 'START_BACKGROUND_TRACKING':
          const startBgResult = await this.startBackgroundTracking(
            message.channelName,
            message.config,
            sender.tab.id
          );
          sendResponse(startBgResult);
          break;

        case 'STOP_BACKGROUND_TRACKING':
          const stopBgResult = await this.stopBackgroundTracking(message.channelName);
          sendResponse(stopBgResult);
          break;

        case 'PAUSE_BACKGROUND_TRACKING':
          const pauseBgResult = await this.pauseBackgroundTracking(message.channelName);
          sendResponse(pauseBgResult);
          break;

        case 'RESUME_BACKGROUND_TRACKING':
          const resumeBgResult = await this.resumeBackgroundTracking(message.channelName);
          sendResponse(resumeBgResult);
          break;

        case 'GET_TRACKING_DATA':
          const trackingData = this.getTrackingData(message.channelName);
          sendResponse({ success: true, data: trackingData });
          break;

        case 'UPDATE_TRACKING_CONFIG':
          const updateResult = this.updateTrackingConfig(message.channelName, message.config);
          sendResponse(updateResult);
          break;

        case 'FORCE_STOP_ALL_TRACKING':
          console.log('Force stopping all tracking sessions');
          try {
            // Stop all tracking sessions (both old and new style)
            if (this.trackingSessions) {
              this.trackingSessions.clear();
            }
            if (this.activeChannels) {
              this.activeChannels.clear();
            }

            // Clear API manager queues and state
            if (this.apiManager && this.apiManager.clearQueue) {
              this.apiManager.clearQueue();
            }

            // Stop all intervals - use 'this' instead of 'this.backgroundService'
            this.clearAllIntervals();

            sendResponse({ success: true });
          } catch (error) {
            console.error('Error during force stop all tracking:', error);
            sendResponse({ success: false, error: error.message });
          }
          break;

        case 'OPEN_TRACKING_PAGE':
          const openTrackingResult = await this.handleOpenTrackingPage(message.channelName);
          sendResponse(openTrackingResult);
          break;

        default:
          sendResponse({ success: false, error: 'Unknown message type' });
      }
    } catch (error) {
      console.error('Error handling message:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  async forceStartTracking(channelName, tabId) {
    // Stop all other tracking first
    const currentlyTracked = Array.from(this.activeChannels.keys());
    for (const tracked of currentlyTracked) {
      if (tracked !== channelName) {
        // Get the channel info BEFORE stopping tracking
        const trackedChannel = this.activeChannels.get(tracked);

        // Stop legacy tracking
        this.activeChannels.delete(tracked);
        console.log(`Stopped tracking channel: ${tracked}`);

        // Notify the other tab that tracking was stopped
        if (trackedChannel && trackedChannel.tabId) {
          try {
            await chrome.tabs.sendMessage(trackedChannel.tabId, {
              type: 'TRACKING_STOPPED_BY_OTHER_TAB',
              stoppedChannel: tracked,
              newChannel: channelName
            });
          } catch (error) {
            console.log('Could not notify other tab:', error);
          }
        }
      }
    }

    // Start tracking the new channel
    this.activeChannels.set(channelName, { tabId, isActive: true });
    console.log(`Force started tracking channel: ${channelName}`);
    return { success: true };
  }

  // Background Tracking Methods
  async startBackgroundTracking(channelName, config, tabId) {
    try {
      // Stop ALL existing tracking sessions to prevent conflicts
      const existingSessions = Array.from(this.trackingSessions.keys());
      for (const existingChannel of existingSessions) {
        console.log(`Stopping existing background tracking for ${existingChannel} before starting ${channelName}`);
        await this.stopBackgroundTracking(existingChannel);

        // Notify the tab that tracking was stopped
        const existingSession = this.trackingSessions.get(existingChannel);
        if (existingSession && existingSession.tabId !== tabId) {
          try {
            await chrome.tabs.sendMessage(existingSession.tabId, {
              type: 'TRACKING_STOPPED_BY_OTHER_TAB',
              stoppedChannel: existingChannel,
              newChannel: channelName,
              reason: 'New tracking session started'
            });
          } catch (error) {
            console.log('Could not notify other tab:', error);
          }
        }
      }

      console.log(`Starting background tracking for ${channelName}`);

      // Initialize tracking session
      const sessionConfig = {
        refreshInterval: config.refreshInterval || 30000,
        requestInterval: config.requestInterval || 5000,
        timeoutDuration: config.timeoutDuration || 300000,
        batchSize: config.batchSize || 20,
        concurrentUserInfoBatches: config.concurrentUserInfoBatches || 50,
        viewerListConcurrentCallsInitial: config.viewerListConcurrentCallsInitial || 50,
        viewerListConcurrentCallsReduced: config.viewerListConcurrentCallsReduced || 10,
        viewerListNewUserThresholdLow: config.viewerListNewUserThresholdLow || 0.05,
        viewerListNewUserThresholdHigh: config.viewerListNewUserThresholdHigh || 0.10,
        ...config
      };

      const session = {
        channelName,
        tabId,
        config: sessionConfig,
        intervals: new Map(),
        data: {
          viewers: new Map(),
          history: [],
          metadata: {
            lastUpdated: null,
            totalRequests: 0,
            sessionStart: Date.now(),
            errors: [],
            viewerCount: 0,
            authenticatedCount: 0,
            viewerListConcurrentCalls: sessionConfig.viewerListConcurrentCallsInitial,
            recentNewUserCounts: []
          },
          pendingUserInfo: new Set()
        },
        // Request locks to prevent concurrent requests
        requestLocks: {
          viewerList: false,
          viewerCount: false,
          userInfo: false
        },
        // Communication failure tracking
        communicationFailures: {
          count: 0,
          firstFailure: null,
          lastFailure: null
        },
        isActive: true,
        paused: false
      };

      this.trackingSessions.set(channelName, session);

      // Start periodic operations
      await this.setupBackgroundIntervals(session);

      return { success: true };
    } catch (error) {
      console.error('Error starting background tracking:', error);
      return { success: false, error: error.message };
    }
  }

  async pauseBackgroundTracking(channelName) {
    try {
      const session = this.trackingSessions.get(channelName);
      if (!session) {
        return { success: false, message: 'No active tracking session' };
      }

      console.log(`Pausing background tracking for ${channelName}`);
      session.paused = true;

      return { success: true };
    } catch (error) {
      console.error('Error pausing background tracking:', error);
      return { success: false, error: error.message };
    }
  }

  async resumeBackgroundTracking(channelName) {
    try {
      const session = this.trackingSessions.get(channelName);
      if (!session) {
        return { success: false, message: 'No active tracking session' };
      }

      console.log(`Resuming background tracking for ${channelName}`);
      session.paused = false;

      // Immediately fetch fresh data
      await this.backgroundFetchViewerList(session);
      await this.backgroundFetchViewerCount(session);

      return { success: true };
    } catch (error) {
      console.error('Error resuming background tracking:', error);
      return { success: false, error: error.message };
    }
  }

  async stopBackgroundTracking(channelName) {
    try {
      const session = this.trackingSessions.get(channelName);
      if (!session) {
        return { success: true, message: 'No active tracking session' };
      }

      console.log(`Stopping background tracking for ${channelName}`);

      // Clear all intervals
      for (const [name, intervalId] of session.intervals) {
        clearInterval(intervalId);
      }

      // Remove session
      this.trackingSessions.delete(channelName);

      return { success: true };
    } catch (error) {
      console.error('Error stopping background tracking:', error);
      return { success: false, error: error.message };
    }
  }

  async setupBackgroundIntervals(session) {
    const { channelName, config } = session;

    try {
      // Calculate effective request interval based on current authenticated user count
      const effectiveRequestInterval = this.calculateEffectiveRequestInterval(session);

      // Viewer list fetching
      session.intervals.set('viewerList', setInterval(async () => {
        await this.backgroundFetchViewerList(session);
      }, effectiveRequestInterval));

      // Viewer count tracking
      session.intervals.set('viewerCount', setInterval(async () => {
        await this.backgroundFetchViewerCount(session);
      }, 60000)); // Every minute

      // User info processing
      session.intervals.set('userInfo', setInterval(async () => {
        await this.backgroundFetchUserInfo(session);
      }, config.refreshInterval));

      // Cleanup timed out viewers
      session.intervals.set('cleanup', setInterval(() => {
        this.backgroundCleanupViewers(session);
      }, 15000)); // Every 15 seconds for responsive timeout removal

      // API status updates
      session.intervals.set('apiStatus', setInterval(async () => {
        await this.sendApiStatusUpdate(session);
      }, 5000)); // Every 5 seconds

      // Session health check - verify tab is still reachable
      session.intervals.set('healthCheck', setInterval(async () => {
        await this.checkSessionHealth(session);
      }, 10000)); // Every 10 seconds

      console.log(`Background intervals setup for ${channelName}`);

      // Wait a moment for content script to be ready, then do initial fetches
      setTimeout(async () => {
        await this.backgroundFetchViewerList(session);
        await this.backgroundFetchViewerCount(session);
      }, 1000); // 1 second delay

    } catch (error) {
      console.error('Error setting up background intervals:', error);
    }
  }

  async backgroundFetchViewerList(session) {
    // Check if paused
    if (session.paused) {
      return;
    }

    // Check if request is already in progress
    if (session.requestLocks.viewerList) {
      return;
    }

    try {
      // Acquire lock
      session.requestLocks.viewerList = true;

      const { channelName } = session;

      // Adaptive concurrent calls: start high, reduce once tracking stabilizes
      const concurrentCalls = this.calculateOptimalViewerListConcurrency(session);
      const viewerData = await this.apiManager.getViewerListParallel(channelName, concurrentCalls);

      if (viewerData && viewerData.viewers) {
        const timestamp = Date.now();
        const newUsers = [];
        const currentViewers = new Set(viewerData.viewers);

        // Process current viewer list
        for (const username of viewerData.viewers) {
          if (!session.data.viewers.has(username)) {
            session.data.viewers.set(username, {
              username,
              firstSeen: timestamp,
              lastSeen: timestamp,
              timeInStream: 0,
              isAuthenticated: true
            });
            newUsers.push(username);
            session.data.pendingUserInfo.add(username);
          } else {
            // Update existing viewer
            const viewer = session.data.viewers.get(username);
            viewer.lastSeen = timestamp;
          }
        }

        // Track new user discovery rate for adaptive concurrency
        this.updateViewerListConcurrency(session, newUsers.length, viewerData.viewers.length);

        // Don't remove viewers immediately - let timeout system handle it
        // This prevents flickering when viewer list API has temporary issues

        // Update metadata
        session.data.metadata.lastUpdated = timestamp;
        session.data.metadata.totalRequests++;
        const oldAuthenticatedCount = session.data.metadata.authenticatedCount || 0;
        session.data.metadata.authenticatedCount = viewerData.totalAuthenticatedCount || 0;

        // Check if we need to adjust request interval based on new authenticated count
        this.checkAndUpdateRequestInterval(session, oldAuthenticatedCount);

        // Send update to content script
        await this.sendTrackingUpdate(session, {
          type: 'VIEWER_LIST_UPDATE',
          viewers: Array.from(session.data.viewers.values()),
          newUsers,
          authenticatedCount: session.data.metadata.authenticatedCount
        });

      }
    } catch (error) {
      console.error('Background viewer list fetch error:', error);
      session.data.metadata.errors.push({
        timestamp: Date.now(),
        error: error.message,
        type: 'viewerList'
      });
    } finally {
      // Always release lock
      session.requestLocks.viewerList = false;
    }
  }

  async backgroundFetchViewerCount(session) {
    // Check if paused
    if (session.paused) {
      return;
    }

    // Check if request is already in progress
    if (session.requestLocks.viewerCount) {
      return;
    }

    try {
      // Acquire lock
      session.requestLocks.viewerCount = true;

      const { channelName } = session;
      const count = await this.apiManager.getViewerCount(channelName);

      const timestamp = Date.now();
      session.data.metadata.viewerCount = count;

      // Add to history
      session.data.history.push({
        timestamp,
        viewerCount: count,
        authenticatedCount: session.data.metadata.authenticatedCount
      });

      // Send update to content script
      await this.sendTrackingUpdate(session, {
        type: 'VIEWER_COUNT_UPDATE',
        count,
        timestamp,
        history: session.data.history.slice(-100) // Send last 100 points
      });

    } catch (error) {
      console.error('Background viewer count fetch error:', error);
      session.data.metadata.errors.push({
        timestamp: Date.now(),
        error: error.message,
        type: 'viewerCount'
      });
    } finally {
      // Always release lock
      session.requestLocks.viewerCount = false;
    }
  }

  async backgroundFetchUserInfo(session) {
    // Check if paused
    if (session.paused) {
      return;
    }

    // Check if request is already in progress
    if (session.requestLocks.userInfo) {
      return;
    }

    try {
      // Acquire lock
      session.requestLocks.userInfo = true;

      const pendingUsers = Array.from(session.data.pendingUserInfo);
      if (pendingUsers.length === 0) {
        return;
      }

      // Process in batches
      const batchSize = session.config.batchSize;
      const batches = [];
      for (let i = 0; i < pendingUsers.length; i += batchSize) {
        batches.push(pendingUsers.slice(i, i + batchSize));
      }

      for (const batch of batches) {
        const userInfo = await this.apiManager.getUserInfo(session.channelName, batch);
        await this.updateViewersWithUserInfo(session, userInfo);

        // Remove processed users from pending set
        for (const username of batch) {
          session.data.pendingUserInfo.delete(username);
        }
      }

    } catch (error) {
      console.error('Background user info fetch error:', error);
      session.data.metadata.errors.push({
        timestamp: Date.now(),
        error: error.message,
        type: 'userInfo'
      });
    } finally {
      // Always release lock
      session.requestLocks.userInfo = false;
    }
  }

  calculateOptimalViewerListConcurrency(session) {
    const { metadata } = session.data;
    const config = session.config;

    // If auto adjustment is disabled, return current setting
    if (!config.viewerListAutoAdjust) {
      return metadata.viewerListConcurrentCalls || config.viewerListConcurrentCallsInitial || 50;
    }

    const currentCalls = metadata.viewerListConcurrentCalls || config.viewerListConcurrentCallsInitial || 50;
    const reducedCalls = config.viewerListConcurrentCallsReduced || 10;
    const initialCalls = config.viewerListConcurrentCallsInitial || 50;
    const thresholdLow = config.viewerListNewUserThresholdLow || 0.05;
    const thresholdHigh = config.viewerListNewUserThresholdHigh || 0.10;

    // Need at least 5 data points to make a decision
    if (metadata.recentNewUserCounts.length < 5) {
      return initialCalls; // Start with initial concurrency until we have enough data
    }

    // Calculate new user discovery rate from recent fetches
    const recentCounts = metadata.recentNewUserCounts.slice(-10); // Last 10 fetches
    const avgNewUsers = recentCounts.reduce((a, b) => a + b.newUsers, 0) / recentCounts.length;
    const avgTotalViewers = recentCounts.reduce((a, b) => a + b.totalViewers, 0) / recentCounts.length;
    const newUserRate = avgTotalViewers > 0 ? (avgNewUsers / avgTotalViewers) : 0;

    // If finding < thresholdLow new users, reduce to reducedCalls
    if (newUserRate < thresholdLow && currentCalls > reducedCalls) {
      return reducedCalls;
    }

    // If finding > thresholdHigh new users, increase back to initialCalls (viewer surge)
    if (newUserRate > thresholdHigh && currentCalls < initialCalls) {
      return initialCalls;
    }

    // Default: use current setting
    return currentCalls;
  }

  updateViewerListConcurrency(session, newUsersCount, totalViewersCount) {
    const { metadata } = session.data;

    // Track recent new user counts (keep last 20)
    metadata.recentNewUserCounts.push({
      timestamp: Date.now(),
      newUsers: newUsersCount,
      totalViewers: totalViewersCount
    });

    if (metadata.recentNewUserCounts.length > 20) {
      metadata.recentNewUserCounts.shift();
    }

    // Update concurrent calls based on discovery rate
    const optimalCalls = this.calculateOptimalViewerListConcurrency(session);
    if (optimalCalls !== metadata.viewerListConcurrentCalls) {
      const oldCalls = metadata.viewerListConcurrentCalls;
      metadata.viewerListConcurrentCalls = optimalCalls;
      const newUserRate = totalViewersCount > 0
        ? ((newUsersCount / totalViewersCount) * 100).toFixed(1)
        : '0.0';
      console.log(`Adjusting viewer list concurrency: ${oldCalls} -> ${optimalCalls} (new user rate: ${newUserRate}%)`);
    }
  }

  async updateViewersWithUserInfo(session, userInfo) {
    // Update viewer data with user info
    for (const info of userInfo) {
      if (info && session.data.viewers.has(info.username)) {
        const viewer = session.data.viewers.get(info.username);
        viewer.createdAt = info.createdAt;
        viewer.id = info.id;
        // Add any other fields from getUserInfo
      }
    }

    // Send update to content script
    await this.sendTrackingUpdate(session, {
      type: 'USER_INFO_UPDATE',
      userInfo,
      remainingPending: session.data.pendingUserInfo.size
    });
  }

  async sendApiStatusUpdate(session) {
    try {
      const rateLimitStatus = this.apiManager.getRateLimitStatus();
      const pendingCount = session.data.pendingUserInfo.size;

      await this.sendTrackingUpdate(session, {
        type: 'API_STATUS_UPDATE',
        rateLimitStatus,
        pendingCount
      });
    } catch (error) {
      console.error('Error sending API status update:', error);
    }
  }

  // Calculate effective timeout duration (matching content script logic)
  calculateEffectiveTimeout(session) {
    const config = session.config;
    if (!config.autoAdjustTimeout) {
      return config.timeoutDuration;
    }

    // Get the latest total authenticated count
    const totalAuthenticatedCount = session.data.metadata.authenticatedCount || 0;

    // Use shared utility function
    const calculatedTimeout = calculateAutoTimeout(totalAuthenticatedCount);
    if (calculatedTimeout) {
      return calculatedTimeout;
    }

    // Fallback to config default if no authenticated count
    return config.timeoutDuration;
  }

  // Calculate effective request interval (matching ConfigManager.calculateAutoRequestInterval logic)
  calculateEffectiveRequestInterval(session) {
    const config = session.config;
    if (!config.autoAdjustRequestInterval) {
      return config.requestInterval;
    }

    // Get the latest total authenticated count
    const totalAuthenticatedCount = session.data.metadata.authenticatedCount || 0;

    // Use shared utility function
    const calculatedInterval = calculateAutoRequestInterval(totalAuthenticatedCount);
    if (calculatedInterval) {
      return calculatedInterval;
    }

    // Fallback to config default if no authenticated count
    return config.requestInterval;
  }

  // Check if request interval needs to be updated based on authenticated count changes
  checkAndUpdateRequestInterval(session, oldAuthenticatedCount) {
    if (!session.config.autoAdjustRequestInterval) {
      return;
    }

    const newAuthenticatedCount = session.data.metadata.authenticatedCount || 0;

    // Calculate what the old and new effective intervals would be
    const oldEffectiveInterval = this.calculateEffectiveIntervalForCount(session, oldAuthenticatedCount);
    const newEffectiveInterval = this.calculateEffectiveIntervalForCount(session, newAuthenticatedCount);

    // Only restart if the effective interval actually changed
    if (oldEffectiveInterval !== newEffectiveInterval) {
      console.log(`Auto-adjusting request interval for ${session.channelName}: ${oldEffectiveInterval / 1000}s -> ${newEffectiveInterval / 1000}s (${oldAuthenticatedCount} -> ${newAuthenticatedCount} auth users)`);

      // Restart the viewer list interval with new timing
      if (session.intervals.has('viewerList')) {
        clearInterval(session.intervals.get('viewerList'));
        session.intervals.set('viewerList', setInterval(async () => {
          await this.backgroundFetchViewerList(session);
        }, newEffectiveInterval));
      }
    }
  }

  // Helper method to calculate effective interval for a specific count
  calculateEffectiveIntervalForCount(session, authenticatedCount) {
    if (!session.config.autoAdjustRequestInterval) {
      return session.config.requestInterval;
    }

    if (!authenticatedCount || authenticatedCount === 0) {
      return session.config.requestInterval;
    }

    // Same logic as calculateEffectiveRequestInterval but for a specific count
    if (authenticatedCount < 500) {
      return 5000; // 5 seconds
    } else if (authenticatedCount < 1000) {
      return 2000; // 2 seconds
    } else {
      return 1000; // 1 second
    }
  }

  backgroundCleanupViewers(session) {
    try {
      const now = Date.now();
      // Use effective timeout calculation instead of static timeoutDuration
      const effectiveTimeout = this.calculateEffectiveTimeout(session);
      let removedCount = 0;
      const removedUsernames = [];

      const viewerCount = session.data.viewers.size;

      for (const [username, viewer] of session.data.viewers) {
        const timeSinceLastSeen = now - viewer.lastSeen;
        const shouldRemove = timeSinceLastSeen > effectiveTimeout;

        if (shouldRemove) {
          session.data.viewers.delete(username);
          session.data.pendingUserInfo.delete(username);
          removedUsernames.push(username);
          removedCount++;
        }
      }

      if (removedCount > 0) {

        // Send delta update instead of all viewer data
        this.sendTrackingUpdate(session, {
          type: 'CLEANUP_UPDATE',
          removedCount,
          removedUsernames: removedUsernames, // Only send removed usernames
          totalViewerCount: session.data.viewers.size
        });
      }
    } catch (error) {
      console.error('Background cleanup error:', error);
    }
  }

  async sendTrackingUpdate(session, data) {
    try {
      // Try to send message to the tab (works for content scripts and extension pages)
      await chrome.tabs.sendMessage(session.tabId, {
        type: 'BACKGROUND_TRACKING_UPDATE',
        channelName: session.channelName,
        data
      });

      // Reset failure tracking on successful communication
      session.communicationFailures.count = 0;
      session.communicationFailures.firstFailure = null;
      session.communicationFailures.lastFailure = null;

    } catch (error) {
      // If direct tab messaging fails, try runtime messaging for extension pages
      try {
        await chrome.runtime.sendMessage({
          type: 'BACKGROUND_TRACKING_UPDATE',
          channelName: session.channelName,
          data,
          targetTabId: session.tabId
        });

        // Reset failure tracking on successful communication
        session.communicationFailures.count = 0;
        session.communicationFailures.firstFailure = null;
        session.communicationFailures.lastFailure = null;

      } catch (runtimeError) {
        // Both methods failed - tab might be closed or content script not ready
        console.log(`Could not send tracking update to tab ${session.tabId} (failure ${session.communicationFailures.count + 1}):`, error.message);

        // Track failures and stop after too many
        session.communicationFailures.count++;
        if (!session.communicationFailures.firstFailure) {
          session.communicationFailures.firstFailure = Date.now();
        }
        session.communicationFailures.lastFailure = Date.now();

        // If we've had repeated failures for 30 seconds, stop tracking
        if (session.communicationFailures.firstFailure &&
            (Date.now() - session.communicationFailures.firstFailure) > 30000) {
          console.log(`Stopping tracking for ${session.channelName} due to communication failures`);
          await this.stopBackgroundTracking(session.channelName);
        }
      }
    }
  }

  async checkSessionHealth(session) {
    try {
      // Try to send a ping message to verify the tab is still there
      const response = await chrome.tabs.sendMessage(session.tabId, {
        type: 'TRACKING_SESSION_PING'
      });

      if (!response || !response.success) {
        console.log(`Tracking tab ${session.tabId} not responding, stopping session for ${session.channelName}`);
        await this.stopBackgroundTracking(session.channelName);
      }
    } catch (error) {
      console.warn(`Health check failed for tab ${session.tabId}, stopping session for ${session.channelName}`);
      await this.stopBackgroundTracking(session.channelName);
    }
  }

  getTrackingData(channelName) {
    const session = this.trackingSessions.get(channelName);
    if (!session) return null;

    return {
      config: session.config,
      data: {
        viewers: Array.from(session.data.viewers.values()),
        history: session.data.history,
        metadata: session.data.metadata,
        pendingUserInfo: Array.from(session.data.pendingUserInfo)
      },
      isActive: session.isActive,
      paused: session.paused
    };
  }

  async backgroundCleanupInactiveChannels() {
    const now = Date.now();
    const inactiveThreshold = 5 * 60 * 1000; // 5 minutes

    for (const [channelName, session] of this.trackingSessions.entries()) {
      if (now - session.data.metadata.lastUpdated > inactiveThreshold) {
        console.log(`Cleaning up inactive session for ${channelName}`);
        await this.stopBackgroundTracking(channelName);
      }
    }
  }

  async backgroundCleanupPendingUserInfo(session) {
    // Remove pending user info requests for users no longer being tracked
    for (const username of Array.from(session.data.pendingUserInfo)) {
      if (!session.data.viewers.has(username)) {
        session.data.pendingUserInfo.delete(username);
      }
    }
  }

  clearAllIntervals() {
    // Clear all tracking session intervals
    if (this.trackingSessions) {
      for (const [channelName, session] of this.trackingSessions.entries()) {
        if (session.intervals) {
          for (const [key, intervalId] of session.intervals.entries()) {
            if (intervalId) {
              clearInterval(intervalId);
            }
          }
          session.intervals.clear();
        }
      }
    }
    console.log('Cleared all background tracking intervals');
  }

  async handleOpenTrackingPage(channelName) {
    try {
      // Check if tracking page is already open
      const existingTabId = await this.findExistingTrackingPage();

      if (existingTabId) {
        // Switch to existing tab and send channel name
        await chrome.tabs.update(existingTabId, { active: true });

        // Try to send channel switch message to the tracking page
        try {
          await chrome.tabs.sendMessage(existingTabId, {
            type: 'TRACKING_PAGE_SWITCH_CHANNEL',
            channelName: channelName
          });
        } catch (msgError) {
          console.warn('Could not send channel switch message to tracking page:', msgError);
        }

        return { success: true, action: 'switched', tabId: existingTabId };
      } else {
        // Store channel name for the tracking page
        await chrome.storage.local.set({
          trackingPageChannel: channelName
        });

        // Open new tracking page
        const trackingPageURL = chrome.runtime.getURL('pages/tracking.html');
        const tab = await chrome.tabs.create({
          url: trackingPageURL,
          active: true
        });

        return { success: true, action: 'opened', tabId: tab.id };
      }
    } catch (error) {
      console.error('Error opening tracking page:', error);
      return { success: false, error: error.message };
    }
  }

  async findExistingTrackingPage() {
    try {
      const tabs = await chrome.tabs.query({
        url: chrome.runtime.getURL('pages/tracking.html*')
      });

      if (tabs.length > 0) {
        // Ping the tab to make sure it's responsive
        try {
          const response = await chrome.tabs.sendMessage(tabs[0].id, {
            type: 'TRACKING_PAGE_PING'
          });

          if (response && response.success) {
            return tabs[0].id;
          }
        } catch (error) {
          // Tab is not responsive, consider it dead
          console.warn('Found tracking tab but it\'s not responsive');
        }
      }

      return null;
    } catch (error) {
      console.error('Error finding existing tracking page:', error);
      return null;
    }
  }
}

// Initialize the background service
const backgroundService = new BackgroundService();
