// Tab Manager for handling tab navigation
window.TabManager = class TabManager {
  constructor(errorHandler = null) {
    this.errorHandler = errorHandler;
    this.activeTab = 'graphs';
  }

  setupTabListeners() {
    try {
      const tabs = document.querySelectorAll('.tvm-tab');
      tabs.forEach(tab => {
        tab.addEventListener('click', (e) => {
          const tabName = e.target.dataset.tab;
          if (tabName) {
            this.switchTab(tabName);
          }
        });
      });
    } catch (error) {
      this.errorHandler?.handle(error, 'TabManager Setup Tab Listeners');
    }
  }

  switchTab(tabName) {
    try {
      // Update active tab
      this.activeTab = tabName;

      // Update tab buttons
      const tabs = document.querySelectorAll('.tvm-tab');
      tabs.forEach(tab => {
        const isActive = tab.dataset.tab === tabName;
        tab.classList.toggle('tvm-tab-active', isActive);
      });

      // Update tab panels
      const panels = document.querySelectorAll('.tvm-tab-panel');
      panels.forEach(panel => {
        const isActive = panel.id === `tvm-tab-${tabName}`;
        panel.classList.toggle('tvm-tab-panel-active', isActive);
      });

      // Dispatch tab change event for other components to listen to
      const event = new CustomEvent('tvm-tab-changed', { detail: { tabName } });
      document.dispatchEvent(event);
    } catch (error) {
      this.errorHandler?.handle(error, 'TabManager Switch Tab', { tabName });
    }
  }

  showTabs() {
    try {
      const tabsContainer = document.getElementById('tvm-tabs');
      if (tabsContainer) {
        tabsContainer.style.display = 'flex';
      }
    } catch (error) {
      this.errorHandler?.handle(error, 'TabManager Show Tabs');
    }
  }

  hideTabs() {
    try {
      const tabsContainer = document.getElementById('tvm-tabs');
      if (tabsContainer) {
        tabsContainer.style.display = 'none';
      }
    } catch (error) {
      this.errorHandler?.handle(error, 'TabManager Hide Tabs');
    }
  }

  getActiveTab() {
    return this.activeTab;
  }
}