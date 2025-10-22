// Settings Manager for handling configuration and validation
window.SettingsManager = class SettingsManager {
  constructor(configManager, errorHandler) {
    this.configManager = configManager;
    this.errorHandler = errorHandler;
    this.isInitialized = false;
  }

  async init() {
    try {
      await this.configManager.load();
      this.isInitialized = true;
    } catch (error) {
      this.errorHandler?.handle(error, 'SettingsManager Init');
    }
  }

  async validateAndSave(settings) {
    try {
      const validationErrors = this.validateSettings(settings);
      
      if (validationErrors.length > 0) {
        throw new Error(`Validation failed: ${validationErrors.join(', ')}`);
      }

      const sanitizedSettings = this.sanitizeSettings(settings);
      const result = await this.configManager.update(sanitizedSettings);
      
      return {
        success: true,
        oldConfig: result.oldConfig,
        newConfig: result.newConfig,
        message: 'Settings saved successfully!'
      };
      
    } catch (error) {
      this.errorHandler?.handle(error, 'SettingsManager Validate And Save', settings);
      return {
        success: false,
        error: error.message
      };
    }
  }

  validateSettings(settings) {
    const errors = [];
    
    // Validate request interval
    if (settings.requestInterval !== undefined) {
      const intervalSeconds = settings.requestInterval / 1000;
      if (!this.configManager.validateInterval(intervalSeconds)) {
        errors.push('Request interval must be between 1 and 60 seconds');
      }
    }

    // Validate timeout duration
    if (settings.timeoutDuration !== undefined) {
      const timeoutMinutes = settings.timeoutDuration / 60000;
      if (!this.configManager.validateTimeout(timeoutMinutes)) {
        errors.push('Timeout duration must be between 5 and 60 minutes');
      }
    }

    // Validate max history points
    if (settings.maxHistoryPoints !== undefined) {
      const points = parseInt(settings.maxHistoryPoints);
      if (isNaN(points) || points < 10 || points > 1000) {
        errors.push('Max history points must be between 10 and 1000');
      }
    }

    // Validate max viewer list size
    if (settings.maxViewerListSize !== undefined) {
      const size = parseInt(settings.maxViewerListSize);
      if (isNaN(size) || size < 100 || size > 50000) {
        errors.push('Max viewer list size must be between 100 and 50,000');
      }
    }

    // Validate page size
    if (settings.pageSize !== undefined) {
      const size = parseInt(settings.pageSize);
      if (isNaN(size) || size < 10 || size > 200) {
        errors.push('Page size must be between 10 and 500');
      }
    }

    // Validate auto adjust timeout
    if (settings.autoAdjustTimeout !== undefined) {
      if (!this.configManager.validateAutoAdjustTimeout(settings.autoAdjustTimeout)) {
        errors.push('Auto adjust timeout must be a boolean value');
      }
    }

    // Validate auto adjust request interval
    if (settings.autoAdjustRequestInterval !== undefined) {
      if (!this.configManager.validateAutoAdjustRequestInterval(settings.autoAdjustRequestInterval)) {
        errors.push('Auto adjust request interval must be a boolean value');
      }
    }

    return errors;
  }

  sanitizeSettings(settings) {
    const sanitized = {};

    // Sanitize numeric values
    if (settings.requestInterval !== undefined) {
      sanitized.requestInterval = Math.max(1000, Math.min(60000, parseInt(settings.requestInterval)));
    }

    if (settings.timeoutDuration !== undefined) {
      sanitized.timeoutDuration = Math.max(300000, Math.min(3600000, parseInt(settings.timeoutDuration)));
    }

    if (settings.maxHistoryPoints !== undefined) {
      sanitized.maxHistoryPoints = Math.max(10, Math.min(1000, parseInt(settings.maxHistoryPoints)));
    }

    if (settings.maxViewerListSize !== undefined) {
      sanitized.maxViewerListSize = Math.max(100, Math.min(50000, parseInt(settings.maxViewerListSize)));
    }

    if (settings.pageSize !== undefined) {
      sanitized.pageSize = Math.max(10, Math.min(500, parseInt(settings.pageSize)));
    }

    if (settings.refreshInterval !== undefined) {
      sanitized.refreshInterval = Math.max(500, Math.min(10000, parseInt(settings.refreshInterval)));
    }

    // Sanitize boolean values
    if (settings.autoAdjustTimeout !== undefined) {
      sanitized.autoAdjustTimeout = Boolean(settings.autoAdjustTimeout);
    }
    if (settings.autoAdjustRequestInterval !== undefined) {
      sanitized.autoAdjustRequestInterval = Boolean(settings.autoAdjustRequestInterval);
    }
    // Sanitize string values
    if (settings.botDateRangeStart !== undefined) {
      const date = new Date(settings.botDateRangeStart);
      if (!isNaN(date.getTime())) {
        sanitized.botDateRangeStart = settings.botDateRangeStart;
      }
    }

    if (settings.botDateRangeMonthsFromNow !== undefined) {
      sanitized.botDateRangeMonthsFromNow = Math.max(1, Math.min(12, parseInt(settings.botDateRangeMonthsFromNow)));
    }

    // Sanitize chart colors
    if (settings.chartColors !== undefined && typeof settings.chartColors === 'object') {
      sanitized.chartColors = {};
      const colorKeys = ['totalViewers', 'authenticatedNonBots', 'bots', 'totalAuthenticated'];
      
      for (const key of colorKeys) {
        if (settings.chartColors[key] && this.isValidColor(settings.chartColors[key])) {
          sanitized.chartColors[key] = settings.chartColors[key];
        }
      }
    }

    return sanitized;
  }

  isValidColor(color) {
    // Basic color validation (hex, rgb, rgba, named colors)
    const colorRegex = /^(#([0-9A-F]{3}){1,2}|rgb\([0-9,\s]+\)|rgba\([0-9,.\s]+\)|[a-z]+)$/i;
    return colorRegex.test(color);
  }

  getDefaultsForUI() {
    const config = this.configManager.get();
    return {
      requestInterval: config.requestInterval / 1000,
      timeoutDuration: config.timeoutDuration / 60000,
      maxHistoryPoints: config.maxHistoryPoints,
      maxViewerListSize: config.maxViewerListSize,
      pageSize: config.pageSize,
      refreshInterval: config.refreshInterval,
      botDateRangeStart: config.botDateRangeStart,
      botDateRangeMonthsFromNow: config.botDateRangeMonthsFromNow,
      chartColors: { ...config.chartColors }
    };
  }

  exportSettings() {
    try {
      const config = this.configManager.get();
      const exportData = {
        version: '2.0.0',
        timestamp: new Date().toISOString(),
        settings: config
      };
      
      return JSON.stringify(exportData, null, 2);
    } catch (error) {
      this.errorHandler?.handle(error, 'SettingsManager Export Settings');
      throw new Error('Failed to export settings');
    }
  }

  async importSettings(jsonString) {
    try {
      const importData = JSON.parse(jsonString);
      
      if (!importData.settings || typeof importData.settings !== 'object') {
        throw new Error('Invalid settings format');
      }

      // Validate version compatibility
      if (importData.version && !this.isCompatibleVersion(importData.version)) {
        console.warn(`Settings version ${importData.version} may not be fully compatible`);
      }

      const result = await this.validateAndSave(importData.settings);
      
      if (!result.success) {
        throw new Error(result.error);
      }

      return {
        success: true,
        message: 'Settings imported successfully!',
        importedAt: importData.timestamp || 'Unknown'
      };
      
    } catch (error) {
      this.errorHandler?.handle(error, 'SettingsManager Import Settings', { jsonString: jsonString?.substring(0, 100) });
      return {
        success: false,
        error: error.message
      };
    }
  }

  isCompatibleVersion(version) {
    // Simple version compatibility check
    const [major] = version.split('.');
    return major === '2';
  }

  async resetToDefaults() {
    try {
      const defaults = this.configManager.getDefaults();
      const result = await this.configManager.update(defaults);
      
      return {
        success: true,
        message: 'Settings reset to defaults',
        oldConfig: result.oldConfig,
        newConfig: result.newConfig
      };
      
    } catch (error) {
      this.errorHandler?.handle(error, 'SettingsManager Reset To Defaults');
      return {
        success: false,
        error: error.message
      };
    }
  }

  getSettingsForDisplay() {
    const config = this.configManager.get();
    
    return {
      'Request Interval': `${config.requestInterval / 1000} seconds`,
      'Timeout Duration': `${config.timeoutDuration / 60000} minutes`,
      'Max History Points': `${config.maxHistoryPoints} points`,
      'Max Viewer List Size': `${config.maxViewerListSize.toLocaleString()} viewers`,
      'Page Size': `${config.pageSize} items`,
      'Refresh Interval': `${config.refreshInterval / 1000} seconds`,
      'Bot Date Range Start': config.botDateRangeStart,
      'Bot Date Range End': `${config.botDateRangeMonthsFromNow} months from now`,
      'Chart Animation Duration': `${config.chartAnimationDuration}ms`
    };
  }

  subscribeToChanges(callback) {
    return this.configManager.subscribe(callback);
  }

  unsubscribeFromChanges(callback) {
    this.configManager.unsubscribe(callback);
  }

  get(key) {
    return this.configManager.get(key);
  }

  getCurrentConfig() {
    return this.configManager.get();
  }
}
