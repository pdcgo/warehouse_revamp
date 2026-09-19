import { useCallback } from "react";
import { useTranslation } from "react-i18next";

// The UI languages the app offers (#93/#97). The switcher's chosen language drives react-i18next
// (see ./config), so switching re-renders every translated component. The choice is persisted per
// device and reflected on the document. `English` / `Bahasa Indonesia` are endonyms — shown in their
// own language regardless of the active UI language, so they are not themselves translated.
export type Lang = "id" | "en";

export const LANGUAGES: { value: Lang; label: string }[] = [
  { value: "id", label: "Bahasa Indonesia" },
  { value: "en", label: "English" },
];

const LANG_KEY = "warehouse.lang";

function isLang(v: string | null | undefined): v is Lang {
  return v === "id" || v === "en";
}

// storedLang is read at i18n init to pick the starting language before React mounts. Defaults to
// English (the source language the catalogs fall back to).
export function storedLang(): Lang {
  const v = typeof localStorage !== "undefined" ? localStorage.getItem(LANG_KEY) : null;
  return isLang(v) ? v : "en";
}

// useLanguage exposes the current UI language (from i18next) and a setter that changes it, persists
// the choice, and reflects it on the document. Components read `lang` for the switcher's state and
// use react-i18next's `useTranslation().t` for the actual strings.
export function useLanguage() {
  const { i18n } = useTranslation();
  const lang: Lang = isLang(i18n.language) ? i18n.language : "en";

  const setLang = useCallback(
    (next: Lang) => {
      localStorage.setItem(LANG_KEY, next);
      document.documentElement.lang = next;
      void i18n.changeLanguage(next);
    },
    [i18n],
  );

  return { lang, setLang };
}
