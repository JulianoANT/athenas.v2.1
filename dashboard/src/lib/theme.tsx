import * as React from "react";

// Modo Sol/Noite da Diretriz. "noite" é o tema navy/ciano padrão; "sol" usa
// alto contraste cromático para legibilidade sob luz solar direta na margem
// do lago. Internamente "noite" aplica a classe .dark do Tailwind.

export type ThemeMode = "noite" | "sol";

const THEME_KEY = "athenas:theme";

interface ThemeContextValue {
  theme: ThemeMode;
  setTheme: (t: ThemeMode) => void;
  toggle: () => void;
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

function readTheme(): ThemeMode {
  if (typeof window === "undefined") return "noite";
  return window.localStorage.getItem(THEME_KEY) === "sol" ? "sol" : "noite";
}

function apply(theme: ThemeMode) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", theme === "noite");
  document.documentElement.dataset.theme = theme;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<ThemeMode>(readTheme);

  React.useEffect(() => {
    apply(theme);
  }, [theme]);

  const setTheme = React.useCallback((t: ThemeMode) => {
    window.localStorage.setItem(THEME_KEY, t);
    setThemeState(t);
  }, []);

  const toggle = React.useCallback(
    () => setTheme(theme === "noite" ? "sol" : "noite"),
    [theme, setTheme],
  );

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme deve ser usado dentro de <ThemeProvider>");
  return ctx;
}
