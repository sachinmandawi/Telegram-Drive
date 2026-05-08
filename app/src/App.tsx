import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthWizard } from "./components/AuthWizard";
import { Dashboard } from "./components/Dashboard";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { UpdateBanner } from "./components/UpdateBanner";
import { useUpdateCheck } from "./hooks/useUpdateCheck";
import "./App.css";

import { Toaster } from "sonner";
import { ConfirmProvider } from "./context/ConfirmContext";
import { ThemeProvider, useTheme } from "./context/ThemeContext";
import { DropZoneProvider } from "./contexts/DropZoneContext";
import { isSavedMessagesDefaultStorage, isTauriRuntime, loadAppStore, telegramApiDefaults } from "./platform";

const queryClient = new QueryClient();

function AppContent() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const { theme } = useTheme();
  const { available, version, downloading, progress, downloadAndInstall, dismissUpdate } = useUpdateCheck();

  useEffect(() => {
    let cancelled = false;
    const checkAuth = async () => {
      try {
        const configStore = await loadAppStore('config.json');
        let authComplete = await configStore.get<boolean>('auth_complete');
        let apiId = await configStore.get<string>('api_id');

        if (isTauriRuntime() && (!authComplete || !apiId)) {
          const settingsStore = await loadAppStore('settings.json');
          authComplete = authComplete || (await settingsStore.get<boolean>('auth_complete'));
          apiId = apiId || (await settingsStore.get<string>('api_id'));
        }

        const defaults = telegramApiDefaults();
        const hasCloudIdentity = Boolean(apiId && apiId !== 'browser') || Boolean(defaults.apiId && defaults.apiHash);
        if (!cancelled && authComplete && (!isSavedMessagesDefaultStorage() || hasCloudIdentity)) {
          setIsAuthenticated(true);
        }
      } catch {
        // Fall through to auth screen after the check completes.
      } finally {
        if (!cancelled) setAuthChecked(true);
      }
    };
    void checkAuth();

    return () => {
      cancelled = true;
    };
  }, []);

  if (!authChecked) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-telegram-bg text-telegram-subtext">
        <div className="h-8 w-8 rounded-full border-4 border-telegram-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <main className="relative h-[100dvh] w-screen overflow-hidden text-telegram-text selection:bg-telegram-primary/30">
      <UpdateBanner
        available={available}
        version={version}
        downloading={downloading}
        progress={progress}
        onUpdate={downloadAndInstall}
        onDismiss={dismissUpdate}
      />
      <Toaster theme={theme} position="bottom-center" />
      {isAuthenticated ? (
        <Dashboard onLogout={() => setIsAuthenticated(false)} />
      ) : (
        <AuthWizard onLogin={() => setIsAuthenticated(true)} />
      )}
    </main>
  );
}


function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <ConfirmProvider>
            <DropZoneProvider>
              <AppContent />
            </DropZoneProvider>
          </ConfirmProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
