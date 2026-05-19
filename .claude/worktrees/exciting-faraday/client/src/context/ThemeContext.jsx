import React, { createContext, useState, useEffect } from "react";

export const ThemeContext = createContext();

const THEMES = {
  default: { "--bs-primary": "#0d6efd", "--app-bg": "#f8f9fa", "--app-text": "#212529" },
  dark: { "--bs-primary": "#6f42c1", "--app-bg": "#121214", "--app-text": "#e9ecef" },
  green: { "--bs-primary": "#198754", "--app-bg": "#f0fff4", "--app-text": "#0f5132" },
  sunset: { "--bs-primary": "#ff6b6b", "--app-bg": "#fff7f6", "--app-text": "#4b2e2e" },
};

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(localStorage.getItem("app_theme") || "default");

  useEffect(() => {
    const current = THEMES[theme];
    Object.entries(current).forEach(([k, v]) => {
      document.documentElement.style.setProperty(k, v);
    });
    localStorage.setItem("theme", theme);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
