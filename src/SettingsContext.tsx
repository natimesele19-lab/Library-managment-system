import { createContext, useContext, useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { api } from "./api";
import i18n, { applyTextOverrides } from "./i18n";

export type LibrarySettings = {
  libraryName: string;
  appTitle: string;
  defaultLanguage: "en" | "am";
  englishText: Record<string, string>;
  amharicText: Record<string, string>;
};

const defaultLibrarySettings: LibrarySettings = {
  libraryName: "Libra",
  appTitle: "Library Management",
  defaultLanguage: "en",
  englishText: {},
  amharicText: {},
};

type SettingsContextValue = {
  settings: LibrarySettings;
  setSettings: Dispatch<SetStateAction<LibrarySettings>>;
  language: string;
  setLanguage: (language: "en" | "am") => Promise<void>;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(defaultLibrarySettings);
  const [language, setCurrentLanguage] = useState(i18n.language);

  useEffect(() => {
    let cancelled = false;
    void api.get<LibrarySettings>("/public/settings").then((loadedSettings) => {
      if (!cancelled) {
        setSettings(loadedSettings);
        void i18n.changeLanguage(loadedSettings.defaultLanguage);
      }
    }).catch((cause: unknown) => {
      if (!cancelled) console.warn("Unable to load library branding; using default settings.", cause);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    applyTextOverrides(settings.englishText, settings.amharicText);
    document.title = settings.appTitle;
  }, [settings]);

  useEffect(() => {
    const updateLanguage = (nextLanguage: string) => setCurrentLanguage(nextLanguage);
    i18n.on("languageChanged", updateLanguage);
    return () => { i18n.off("languageChanged", updateLanguage); };
  }, []);

  return <SettingsContext.Provider value={{
    settings,
    setSettings,
    language,
    setLanguage: async (nextLanguage) => { await i18n.changeLanguage(nextLanguage); },
  }}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) throw new Error("useSettings must be used within a SettingsProvider.");
  return context;
}
