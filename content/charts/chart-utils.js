// Chart utilities for shared chart functionality
window.ChartUtils = class ChartUtils {
  static async waitForChartJS(timeout = 5000) {
    const start = Date.now();
    while (typeof Chart === 'undefined' && Date.now() - start < timeout) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    if (typeof Chart === 'undefined') {
      throw new Error('Chart.js failed to load');
    }
  }
  
  static formatTooltipLabel(context, dataManager) {
    const label = context.dataset.label;
    const value = context.parsed.y;
    
    if (label === 'Authenticated Bots') {
      const totalNonBot = context.chart.data.datasets
        .find(d => d.label === 'Authenticated Users')
        ?.data[context.dataIndex]?.y || 0;
      const totalAuthenticated = totalNonBot + value;
      const percentage = totalAuthenticated > 0 ? ((value / totalAuthenticated) * 100).toFixed(1) : 0;
      return `${label}: ${value} (${percentage}%)`;
    }
    
    return `${label}: ${value.toLocaleString()}`;
  }

  static formatCreationTooltipLabel(context, dataManager) {
    // Simplified for new stacked chart format
    const value = context.parsed.y;
    return `Accounts Created: ${value}`;
  }

  static formatCreationTooltipAfterLabel(context, dataManager) {
    // No longer needed with the new stacked chart format
    return null;
  }
}