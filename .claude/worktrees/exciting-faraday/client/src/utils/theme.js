// Detect system theme preference
export function getSystemTheme() {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}

// Get effective theme (if system is selected, return the actual system theme)
export function getEffectiveTheme() {
  const stored = getCurrentTheme();
  if (stored === 'system') {
    return getSystemTheme();
  }
  return stored;
}

// Store system theme listener globally to avoid duplicates
let systemThemeListener = null;

export function setTheme(theme) {
  const effectiveTheme = theme === 'system' ? getSystemTheme() : theme;
  document.documentElement.setAttribute("data-theme", effectiveTheme);
  document.documentElement.setAttribute("data-theme-preference", theme); // Store preference separately
    localStorage.setItem("theme", theme);
  
  // Clean up old system theme listener if exists
  if (systemThemeListener && typeof window !== 'undefined' && window.matchMedia) {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    if (mediaQuery.removeEventListener) {
      mediaQuery.removeEventListener('change', systemThemeListener);
    } else if (mediaQuery.removeListener) {
      mediaQuery.removeListener(systemThemeListener);
    }
    systemThemeListener = null;
  }
  
  // Listen for system theme changes if system theme is selected
  if (theme === 'system' && typeof window !== 'undefined' && window.matchMedia) {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    systemThemeListener = (e) => {
      const newSystemTheme = e.matches ? 'dark' : 'light';
      document.documentElement.setAttribute("data-theme", newSystemTheme);
      // Trigger custom event for components listening to theme changes
      window.dispatchEvent(new CustomEvent('themechange', { detail: { theme: newSystemTheme, preference: 'system' } }));
    };
    
    // Add new listener
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', systemThemeListener);
    } else if (mediaQuery.addListener) {
      mediaQuery.addListener(systemThemeListener);
    }
  }
  
  // Trigger custom event for theme changes
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('themechange', { detail: { theme: effectiveTheme, preference: theme } }));
  }
  }
  
  export function getCurrentTheme() {
    return localStorage.getItem("theme") || "light";
  }
  
// Initialize theme on load
  setTheme(getCurrentTheme());
  