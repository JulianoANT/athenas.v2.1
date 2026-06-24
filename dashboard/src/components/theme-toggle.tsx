import { IconSun, IconMoon } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/lib/theme";

// Chaveador global de estilos Sol/Noite (canto superior).
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={theme === "noite" ? "Ativar modo Sol" : "Ativar modo Noite"}
      title={theme === "noite" ? "Modo Sol" : "Modo Noite"}
    >
      {theme === "noite" ? (
        <IconSun className="size-5" />
      ) : (
        <IconMoon className="size-5" />
      )}
    </Button>
  );
}
