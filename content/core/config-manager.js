// Configuration Manager for centralized settings
window.ConfigManager = class ConfigManager {
  // Constants for validation
  static VALIDATION_LIMITS = {
    INTERVAL: { MIN: 1, MAX: 60 },
    TIMEOUT: { MIN: 5, MAX: 60 },
    MAX_HISTORY_POINTS: { MIN: 100, MAX: 1440 },
    MAX_VIEWER_LIST_SIZE: { MIN: 1000, MAX: 500000 },
    PAGE_SIZE: { MIN: 10, MAX: 500 }, // Increased max for better performance with large datasets
    REFRESH_INTERVAL: { MIN: 100, MAX: 5000 }
  };

  constructor() {
    this.config = this.getDefaults();
    this.listeners = new Set();
  }

  getDefaults() {
    return {
      // API settings
      requestInterval: 5000,
      maxRetries: 3,
      retryDelay: 1000,
      
      // Concurrent API processing
      concurrentUserInfoBatches: 20, // Number of concurrent getUserInfo requests when queue > 1000
      concurrentThreshold: 1000, // Switch to concurrent processing when pending users exceeds this
      
      // User data fetching method
      useGraphQLUserBasic: true, // Default to new GraphQL method
      
      // Auto adjust timeout based on viewer count
      autoAdjustTimeout: true, // Default to on
      
      // Auto adjust request interval based on authenticated user count
      autoAdjustRequestInterval: true, // Default to on
      
      // Graph update pausing
      autoPauseGraphsOnZeroViewers: true, // Default to on
      
      // Graph cleaning
      cleanGraphZeroData: true, // Remove excessive zero viewer data from start
      
      // Bot detection date range
      botDateRangeStart: '2021-01-01',
      botDateRangeMonthsFromNow: 2, // Ignore most recent accounts due to expected spike
      
      // Data management
      timeoutDuration: 600000,
      maxHistoryPoints: 360,
      maxViewerListSize: 250000, // High safety limit - memory-based limit will kick in first
      
      
      // UI settings
      pageSize: 100, // Increased default for better performance with large datasets
      refreshInterval: 500,
      
      // Chart settings
      chartAnimationDuration: 750,
      chartColors: {
        totalViewers: '#00ff88',
        authenticatedNonBots: '#ffa500',
        bots: '#9147ff',
        totalAuthenticated: '#adadb8'
      }
    };
  }

  async load() {
    try {
      const stored = await chrome.storage.local.get('config');
      if (stored.config) {
        // Migrate old chart color key names to new ones
        if (stored.config.chartColors) {
          const colors = stored.config.chartColors;
          
          // Migrate authenticatedUsers -> authenticatedNonBots
          if (colors.authenticatedUsers && !colors.authenticatedNonBots) {
            colors.authenticatedNonBots = colors.authenticatedUsers;
            delete colors.authenticatedUsers;
          }
        }
        
        this.config = { ...this.config, ...stored.config };
      }
    } catch (error) {
      console.error('Failed to load config:', error);
    }
  }

  async save() {
    try {
      await chrome.storage.local.set({ config: this.config });
      this.notifyListeners();
    } catch (error) {
      console.error('Failed to save config:', error);
    }
  }

  async update(updates) {
    const oldConfig = { ...this.config };
    this.config = { ...this.config, ...updates };
    console.log('ConfigManager: Updating config with:', updates);
    console.log('ConfigManager: New config values:', {
      requestInterval: this.config.requestInterval,
      timeoutDuration: this.config.timeoutDuration
    });
    await this.save();
    return { oldConfig, newConfig: this.config };
  }

  get(key) {
    return key ? this.config[key] : this.config;
  }

  subscribe(callback) {
    this.listeners.add(callback);
  }

  unsubscribe(callback) {
    this.listeners.delete(callback);
  }

  notifyListeners() {
    this.listeners.forEach(callback => {
      try {
        callback(this.config);
      } catch (error) {
        console.error('Config listener error:', error);
      }
    });
  }

  // Validation methods
  validateInterval(value) {
    const num = parseInt(value);
    return num >= ConfigManager.VALIDATION_LIMITS.INTERVAL.MIN && 
           num <= ConfigManager.VALIDATION_LIMITS.INTERVAL.MAX;
  }

  validateTimeout(value) {
    const num = parseInt(value);
    return num >= ConfigManager.VALIDATION_LIMITS.TIMEOUT.MIN && 
           num <= ConfigManager.VALIDATION_LIMITS.TIMEOUT.MAX;
  }

  validateUseGraphQLUserBasic(value) {
    return typeof value === 'boolean';
  }

  validateAutoAdjustTimeout(value) {
    return typeof value === 'boolean';
  }

  validateAutoAdjustRequestInterval(value) {
    return typeof value === 'boolean';
  }

  // Calculate auto-adjusted timeout based on total authenticated users
  calculateAutoTimeout(totalAuthenticatedCount) {
    if (!this.config.autoAdjustTimeout) {
      return this.config.timeoutDuration;
    }

    if (!totalAuthenticatedCount || totalAuthenticatedCount === 0) {
      return this.config.timeoutDuration;
    }

    // Under 5000 is 5 minutes, add 1 minute per 1000
    // Convert to milliseconds (5 minutes = 300000ms, 1 minute = 60000ms)
    let timeoutMinutes = 5; // Base 5 minutes
    
    if (totalAuthenticatedCount > 5000) {
      const additionalThousands = Math.floor((totalAuthenticatedCount - 5000) / 1000);
      timeoutMinutes += additionalThousands;
    }

    // Convert minutes to milliseconds
    const calculatedTimeout = timeoutMinutes * 60000;
    
    return calculatedTimeout;
  }

  // Calculate auto-adjusted request interval based on total authenticated users
  calculateAutoRequestInterval(totalAuthenticatedCount) {
    if (!this.config.autoAdjustRequestInterval || !totalAuthenticatedCount || totalAuthenticatedCount === 0) {
      return this.config.requestInterval;
    }

    // Under 500: every 5 seconds
    // Under 1000: every 2 seconds  
    // Over 1000: every 1 second
    if (totalAuthenticatedCount < 500) {
      return 5000; // 5 seconds
    } else if (totalAuthenticatedCount < 1000) {
      return 2000; // 2 seconds
    } else {
      return 1000; // 1 second
    }
  }
}
