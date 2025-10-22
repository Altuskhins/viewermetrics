// Color utilities for consistent color handling across components
window.ColorUtils = class ColorUtils {
  static getAuthenticatedPercentageColor(percentage) {
    const num = parseFloat(percentage);
    if (num >= 80) return '#00ff88';
    if (num >= 65) return '#ffa500';
    return '#ff4444';
  }

  static getBotPercentageStyle(percentage) {
    const num = parseFloat(percentage);
    if (num > 15) {
      return 'color: #ff4444 !important; font-weight: bold; -webkit-text-fill-color: #ff4444 !important; background: none !important;';
    } else if (num >= 5) {
      return 'color: #ffa500 !important; font-weight: bold; -webkit-text-fill-color: #ffa500 !important; background: none !important;';
    }
    return '';
  }

  static isValidColor(color) {
    if (!color) return false;
    const colorRegex = /^(#([0-9A-F]{3}){1,2}|rgb\([0-9,\s]+\)|rgba\([0-9,.\s]+\)|[a-z]+)$/i;
    return colorRegex.test(color);
  }

  static hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : null;
  }

  static rgbToHex(r, g, b) {
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  static adjustBrightness(color, amount) {
    const rgb = this.hexToRgb(color);
    if (!rgb) return color;
    
    const r = Math.max(0, Math.min(255, rgb.r + amount));
    const g = Math.max(0, Math.min(255, rgb.g + amount));
    const b = Math.max(0, Math.min(255, rgb.b + amount));
    
    return this.rgbToHex(r, g, b);
  }

  static getContrastColor(backgroundColor) {
    const rgb = this.hexToRgb(backgroundColor);
    if (!rgb) return '#000000';
    
    // Calculate luminance
    const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
    
    // Return black for light backgrounds, white for dark backgrounds
    return luminance > 0.5 ? '#000000' : '#ffffff';
  }

  static interpolateColor(color1, color2, factor) {
    if (!color1 || !color2) return color1 || color2;
    
    const rgb1 = this.hexToRgb(color1);
    const rgb2 = this.hexToRgb(color2);
    
    if (!rgb1 || !rgb2) return color1;
    
    const r = Math.round(rgb1.r + (rgb2.r - rgb1.r) * factor);
    const g = Math.round(rgb1.g + (rgb2.g - rgb1.g) * factor);
    const b = Math.round(rgb1.b + (rgb2.b - rgb1.b) * factor);
    
    return this.rgbToHex(r, g, b);
  }
}