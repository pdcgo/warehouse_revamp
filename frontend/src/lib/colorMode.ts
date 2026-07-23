import { useSyncExternalStore } from "react";

// Color mode, without a dependency (#213).
//
// Chakra v3's `_dark` condition is the `.dark` class on an ancestor, so the whole mechanism is: put
// `dark` on <html> or not. This mirrors the mocks' own toggle exactly — system preference by default,
// a manual override persisted to localStorage, and an inline <head> script (see index.html) that
// applies the class before first paint so there is no light-then-dark flash.
//
// We deliberately do NOT reach for next-themes: it exists to solve SSR flash and framework routing,
// neither of which a Vite SPA has. One class on one element is the whole job.

export type ColorMode = "light" | "dark";

const STORAGE_KEY = "wh-color-mode";

function systemMode(): ColorMode {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

// The stored OVERRIDE, or null when the user has never chosen and we follow the system.
function storedMode(): ColorMode | null {
  const v = localStorage.getItem(STORAGE_KEY);
  return v === "light" || v === "dark" ? v : null;
}

export function currentMode(): ColorMode {
  return storedMode() ?? systemMode();
}

function apply(mode: ColorMode) {
  document.documentElement.classList.toggle("dark", mode === "dark");
}

// A tiny store so components re-render on a toggle. The subscribers also let a second tab's change (a
// `storage` event) and a live system-preference change propagate while no override is set.
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function setColorMode(mode: ColorMode) {
  localStorage.setItem(STORAGE_KEY, mode);
  apply(mode);
  emit();
}

export function toggleColorMode() {
  setColorMode(currentMode() === "dark" ? "light" : "dark");
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);

  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      apply(currentMode());
      onChange();
    }
  };
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const onSystem = () => {
    // A live system change only shows through while the user has set no override.
    if (storedMode() === null) {
      apply(systemMode());
      onChange();
    }
  };

  window.addEventListener("storage", onStorage);
  mq.addEventListener("change", onSystem);

  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
    mq.removeEventListener("change", onSystem);
  };
}

// The hook a toggle reads. useSyncExternalStore keeps every subscriber in step with the class on
// <html>, which is the single source of truth.
export function useColorMode(): ColorMode {
  return useSyncExternalStore(subscribe, currentMode, () => "light" as ColorMode);
}
