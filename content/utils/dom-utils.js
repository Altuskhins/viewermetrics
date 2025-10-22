// DOM utilities for consistent DOM manipulation across components
window.DOMUtils = class DOMUtils {
  static updateElement(id, content) {
    const element = document.getElementById(id);
    if (element) {
      if (typeof content === 'string' && (content.includes('<span') || content.includes('<div') || content.includes('<br>'))) {
        element.innerHTML = content;
      } else {
        element.textContent = content;
      }
    }
    return element;
  }

  static createElement(tag, className, innerHTML) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (innerHTML) element.innerHTML = innerHTML;
    return element;
  }

  static removeElement(id) {
    const element = document.getElementById(id);
    if (element) {
      element.remove();
      return true;
    }
    return false;
  }

  static addEventListenerSafe(element, event, handler, options = {}) {
    if (element && typeof handler === 'function') {
      element.addEventListener(event, handler, options);
      return handler;
    }
    return null;
  }

  static removeEventListenerSafe(element, event, handler, options = {}) {
    if (element && handler) {
      element.removeEventListener(event, handler, options);
    }
  }

  static querySelector(selector, parent = document) {
    try {
      return parent.querySelector(selector);
    } catch (error) {
      console.warn('Invalid selector:', selector);
      return null;
    }
  }

  static querySelectorAll(selector, parent = document) {
    try {
      return parent.querySelectorAll(selector);
    } catch (error) {
      console.warn('Invalid selector:', selector);
      return [];
    }
  }

  static setStyle(element, styles) {
    if (!element) return;
    
    if (typeof styles === 'string') {
      element.style.cssText = styles;
    } else if (typeof styles === 'object') {
      Object.entries(styles).forEach(([key, value]) => {
        element.style[key] = value;
      });
    }
  }

  static addClass(element, className) {
    if (element && className) {
      element.classList.add(className);
    }
  }

  static removeClass(element, className) {
    if (element && className) {
      element.classList.remove(className);
    }
  }

  static toggleClass(element, className, force) {
    if (element && className) {
      return element.classList.toggle(className, force);
    }
    return false;
  }

  static hasClass(element, className) {
    if (element && className) {
      return element.classList.contains(className);
    }
    return false;
  }
}