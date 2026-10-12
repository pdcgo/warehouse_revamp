import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import id from "./locales/id.json";
import { storedLang } from "./language";

// react-i18next setup (#97). The active language is the stored preference (#93); English is the
// fallback. Strings live in the per-locale JSON catalogs under ./locales — as more of the UI is
// translated, add keys there. The switcher calls i18n.changeLanguage, which re-renders every
// component using useTranslation. Import this module once for its side effect (see main.tsx).
void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    id: { translation: id },
  },
  lng: storedLang(),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

// Reflect the starting language on the document at load, before any switch (useLanguage keeps it in
// sync thereafter).
if (typeof document !== "undefined") {
  document.documentElement.lang = storedLang();
}

export default i18n;
