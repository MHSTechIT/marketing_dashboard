import React from "react";
import { setTheme } from "../utils/theme";

export default function ThemeBar() {
  const themes = ["light", "dark", "green", "sunset"];

  return (
    <div className="d-flex align-items-center">
      {themes.map((t) => (
        <button
          key={t}
          onClick={() => setTheme(t)}
          className={`btn btn-sm me-1 theme-btn theme-${t}`}
          title={t}
        />
      ))}
    </div>
  );
}
