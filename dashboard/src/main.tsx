import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "uplot/dist/uPlot.min.css";
import App from "./App.tsx";
import { TooltipProvider } from "./components/ui/tooltip.tsx";
import { ThemeProvider } from "@/lib/theme";
import { AuthProvider } from "@/lib/auth";
import { TelemetryBridge } from "@/lib/telemetry/bridge";

// A telemetria nao e mais um Context: o estado vive no store Zustand
// (@/lib/telemetry/store) e o <TelemetryBridge /> apenas mantem o Web Worker
// do WebSocket vivo. Nenhum componente re-renderiza por causa de um provider.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <TooltipProvider>
          <TelemetryBridge />
          <App />
        </TooltipProvider>
      </AuthProvider>
    </ThemeProvider>
  </StrictMode>,
);
