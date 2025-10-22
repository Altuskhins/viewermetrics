// Settings UI Manager for handling settings form display and management
window.SettingsUIManager = class SettingsUIManager {
  constructor(configManager, dataManager, apiClient, errorHandler, statsManager) {
    this.configManager = configManager;
    this.dataManager = dataManager;
    this.apiClient = apiClient;
    this.errorHandler = errorHandler;
    this.statsManager = statsManager;
  }

  async loadSettings() {
    try {
      const config = this.configManager.get();
      
      const elements = {
        interval: document.getElementById('tvm-interval'),
        timeout: document.getElementById('tvm-timeout'),
        autoAdjustTimeout: document.getElementById('tvm-auto-adjust-timeout'),
        autoAdjustRequestInterval: document.getElementById('tvm-auto-adjust-request-interval'),
        autoPause: document.getElementById('tvm-auto-pause'),
        cleanGraphZeroData: document.getElementById('tvm-clean-graph-zero-data')
      };

      if (elements.interval) elements.interval.value = config.requestInterval / 1000;
      if (elements.timeout) elements.timeout.value = config.timeoutDuration / 60000;
      if (elements.autoAdjustTimeout) elements.autoAdjustTimeout.checked = config.autoAdjustTimeout;
      if (elements.autoAdjustRequestInterval) elements.autoAdjustRequestInterval.checked = config.autoAdjustRequestInterval;
      if (elements.autoPause) elements.autoPause.checked = config.autoPauseGraphsOnZeroViewers;
      if (elements.cleanGraphZeroData) elements.cleanGraphZeroData.checked = config.cleanGraphZeroData;

      // Set initial input states based on checkbox values
      this.toggleInputState(elements.timeout, config.autoAdjustTimeout);
      this.toggleInputState(elements.interval, config.autoAdjustRequestInterval);

      // Update effective displays using StatsManager
      if (this.statsManager) {
        this.statsManager.updateEffectiveTimeoutDisplay();
        this.statsManager.updateEffectiveRequestIntervalDisplay();
      }
      
    } catch (error) {
      this.errorHandler?.handle(error, 'SettingsUIManager Load Settings');
    }
  }

  resetSettingsToDefaults() {
    try {
      // Get default values - these should match ConfigManager.getDefaults()
            const defaults = {
        autoAdjustRequestInterval: true,
        autoAdjustTimeout: true,
        autoAdjustBatchSize: true,
        autoAdjustConcurrentRequests: true,
        autoPauseGraphsOnZeroViewers: true,
        cleanGraphZeroData: true,
        concurrentProcessing: true
      };

      // Reset all form elements to default values
      const elements = {
        interval: document.getElementById('tvm-interval'),
        timeout: document.getElementById('tvm-timeout'),
        autoAdjustTimeout: document.getElementById('tvm-auto-adjust-timeout'),
        autoAdjustRequestInterval: document.getElementById('tvm-auto-adjust-request-interval'),
        autoPauseGraphs: document.getElementById('tvm-auto-pause-graphs'),
        cleanGraphZeroData: document.getElementById('tvm-clean-graph-zero-data')
      };

      // Apply default values
      if (elements.interval) elements.interval.value = defaults.requestInterval;
      if (elements.timeout) elements.timeout.value = defaults.timeoutDuration;
      if (elements.autoAdjustTimeout) elements.autoAdjustTimeout.checked = defaults.autoAdjustTimeout;
      if (elements.autoAdjustRequestInterval) elements.autoAdjustRequestInterval.checked = defaults.autoAdjustRequestInterval;
      if (elements.autoPause) elements.autoPause.checked = defaults.autoPauseGraphsOnZeroViewers;
      if (elements.cleanGraphZeroData) elements.cleanGraphZeroData.checked = defaults.cleanGraphZeroData;

      // Update input states based on default checkbox values
      this.toggleInputState(elements.timeout, defaults.autoAdjustTimeout);
      this.toggleInputState(elements.interval, defaults.autoAdjustRequestInterval);

      // Update effective displays using StatsManager (since auto-adjust checkboxes may have changed)
      if (this.statsManager) {
        this.statsManager.updateEffectiveTimeoutDisplay();
        this.statsManager.updateEffectiveRequestIntervalDisplay();
      }

      // Show visual feedback that defaults have been loaded (but not saved)
      const resetBtn = document.getElementById('tvm-reset-settings');
      if (resetBtn) {
        const originalText = resetBtn.textContent;
        resetBtn.textContent = 'Defaults Loaded';
        resetBtn.style.backgroundColor = '#00ff88';
        setTimeout(() => {
          resetBtn.textContent = originalText;
          resetBtn.style.backgroundColor = '';
        }, 1500);
      }

    } catch (error) {
      this.errorHandler?.handle(error, 'SettingsUIManager Reset Settings To Defaults');
    }
  }

  async saveSettings() {
    try {
      const elements = {
        interval: document.getElementById('tvm-interval'),
        timeout: document.getElementById('tvm-timeout'),
        autoAdjustTimeout: document.getElementById('tvm-auto-adjust-timeout'),
        autoAdjustRequestInterval: document.getElementById('tvm-auto-adjust-request-interval'),
        autoPauseGraphs: document.getElementById('tvm-auto-pause-graphs'),
        cleanGraphZeroData: document.getElementById('tvm-clean-graph-zero-data')
      };

      const intervalValue = parseInt(elements.interval?.value || 5);
      const timeoutValue = parseInt(elements.timeout?.value || 10);
      const autoAdjustTimeoutValue = elements.autoAdjustTimeout?.checked || false;
      const autoAdjustRequestIntervalValue = elements.autoAdjustRequestInterval?.checked || false;
      const autoPauseGraphsValue = elements.autoPauseGraphs?.checked || false;
      const cleanGraphZeroDataValue = elements.cleanGraphZeroData?.checked || false;

      // Validate
      if (!this.configManager.validateInterval(intervalValue)) {
        alert('Request interval must be between 1 and 60 seconds.');
        return;
      }
      
      if (!this.configManager.validateTimeout(timeoutValue)) {
        alert('Timeout duration must be between 5 and 60 minutes.');
        return;
      }

      if (!this.configManager.validateAutoAdjustTimeout(autoAdjustTimeoutValue)) {
        alert('Auto-adjust timeout must be a boolean value.');
        return;
      }

      if (!this.configManager.validateAutoAdjustRequestInterval(autoAdjustRequestIntervalValue)) {
        alert('Auto-adjust request interval must be a boolean value.');
        return;
      }


      const oldConfig = this.configManager.get();
      
      const updates = {
        requestInterval: intervalValue * 1000,
        timeoutDuration: timeoutValue * 60000,
        autoAdjustTimeout: autoAdjustTimeoutValue,
        autoAdjustRequestInterval: autoAdjustRequestIntervalValue,
        autoPauseGraphsOnZeroViewers: autoPauseGraphsValue,
        cleanGraphZeroData: cleanGraphZeroDataValue
      };

      await this.configManager.update(updates);

      // Update background tracking configuration if tracking is active
      if (this.apiClient && this.apiClient.isTracking()) {
        try {
          const bgUpdateResult = await this.apiClient.updateTrackingConfig(updates);
        } catch (error) {
          console.error('Error updating background tracking config:', error);
        }
      }

      // Update effective displays using StatsManager
      if (this.statsManager) {
        this.statsManager.updateEffectiveTimeoutDisplay();
        this.statsManager.updateEffectiveRequestIntervalDisplay();
      }

      alert('Settings saved successfully!');
      
    } catch (error) {
      this.errorHandler?.handle(error, 'SettingsUIManager Save Settings');
      alert('Failed to save settings. Please try again.');
    }
  }

  setupSettingsEventListeners() {
    try {
      const elements = {
        autoAdjustTimeout: document.getElementById('tvm-auto-adjust-timeout'),
        autoAdjustRequestInterval: document.getElementById('tvm-auto-adjust-request-interval'),
        autoPauseGraphs: document.getElementById('tvm-auto-pause-graphs'),
        timeoutInput: document.getElementById('tvm-timeout'),
        intervalInput: document.getElementById('tvm-interval'),
        saveSettings: document.getElementById('tvm-save-settings'),
        resetSettings: document.getElementById('tvm-reset-settings')
      };

      // Add event listeners for auto-adjust checkboxes to update effective displays and disable inputs
      if (elements.autoAdjustTimeout && this.statsManager) {
        elements.autoAdjustTimeout.addEventListener('change', () => {
          this.statsManager.updateEffectiveTimeoutDisplay();
          this.toggleInputState(elements.timeoutInput, elements.autoAdjustTimeout.checked);
        });
        // Set initial state
        this.toggleInputState(elements.timeoutInput, elements.autoAdjustTimeout.checked);
      }
      
      if (elements.autoAdjustRequestInterval && this.statsManager) {
        elements.autoAdjustRequestInterval.addEventListener('change', () => {
          this.statsManager.updateEffectiveRequestIntervalDisplay();
          this.toggleInputState(elements.intervalInput, elements.autoAdjustRequestInterval.checked);
        });
        // Set initial state
        this.toggleInputState(elements.intervalInput, elements.autoAdjustRequestInterval.checked);
      }
      
      // Save settings button
      if (elements.saveSettings) {
        elements.saveSettings.addEventListener('click', () => this.saveSettings());
      }

      // Reset settings button
      if (elements.resetSettings) {
        elements.resetSettings.addEventListener('click', () => this.resetSettingsToDefaults());
      }

    } catch (error) {
      this.errorHandler?.handle(error, 'SettingsUIManager Setup Settings Event Listeners');
    }
  }



  onPauseResumeClick() {
    // Dispatch a custom event that the main class can listen for
    const event = new CustomEvent('tvm-pause-resume-graphs');
    document.dispatchEvent(event);
  }

  toggleInputState(inputElement, isAutoAdjust) {
    if (inputElement) {
      inputElement.disabled = isAutoAdjust;
      // Add visual styling to indicate disabled state
      if (isAutoAdjust) {
        inputElement.style.opacity = '0.5';
        inputElement.style.cursor = 'not-allowed';
      } else {
        inputElement.style.opacity = '1';
        inputElement.style.cursor = '';
      }
    }
  }
}