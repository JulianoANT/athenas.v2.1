import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { TooltipProvider } from "./components/ui/tooltip.tsx";
import { ThemeProvider } from "@/lib/theme";
import { AuthProvider } from "@/lib/auth";
import { TelemetryProvider } from "@/lib/telemetry/provider";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <TelemetryProvider>
          <TooltipProvider>
            <App />
          </TooltipProvider>
        </TelemetryProvider>
      </AuthProvider>
    </ThemeProvider>
  </StrictMode>,
);
