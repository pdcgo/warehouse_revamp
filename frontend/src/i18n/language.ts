import { useCallback, useEffect, useState } from "react";

// The UI languages the app offers (#93). This is the switcher's foundation only: it remembers the
// user's choice (per device) and sets the document language. Actual STRING translation is the larger
// i18n effort (#65) and waits on the library decision there — so today nothing in the UI text
// changes yet; this is deliberately library-agnostic so whatever #65 picks can read the same stored
// value. The default locale is likewise a #65 question (§2.2); we default to `en` because the UI
// text ships in English today.
export type Lang = "id" | "en";

export const LANGUAGES: { value: Lang; label: string }[] = [
  { value: "id", label: "Bahasa Indonesia" },
  { value: "en", label: "English" },
];

const LANG_KEY = "warehouse.lang";

function isLang(v: string | null): v is Lang {
  return v === "id" || v === "en";
}

export function storedLang(): Lang {
  const v = typeof localStorage !== "undefined" ? localStorage.getItem(LANG_KEY) : null;
  return isLang(v) ? v : "en";
}

// useLanguage exposes the current UI language and a setter that persists it and reflects it on the
// document. When #65 introduces a translation layer, it consumes this same value.
export function useLanguage() {
  const [lang, setLangState] = useState<Lang>(storedLang);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    localStorage.setItem(LANG_KEY, next);
    setLangState(next);
  }, []);

  return { lang, setLang };
}
