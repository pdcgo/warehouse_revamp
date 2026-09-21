import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { Role } from "../../gen/warehouse/role_base/v1/role_pb";

// The two INDEPENDENT pieces of sidebar state, and they are not the same thing:
//
//   collapsed — DESKTOP. The sidebar narrows to icons only. A deliberate, sticky preference: an
//               operator who wants more room for a wide table sets it once and expects it to hold.
//   expanded  — MOBILE. The sidebar is a drawer over the content. Transient: it closes on every
//               navigation, because leaving it open would cover the page you just navigated to.
//
// Collapsing them into one flag is the obvious-looking simplification and it is wrong in both
// directions — a phone would inherit a desktop preference it cannot act on, and a desktop collapse
// would close itself on every navigation.
export interface SidebarState {
  collapsed: boolean;
  toggleCollapsed(): void;
  expanded: boolean;
  toggleExpanded(): void;
  closeExpanded(): void;
  // The viewer's role, so a nav item can gate on it in one place.
  //
  // ⚠ UI GATING ONLY. Hiding a link hides nothing — the RPC is still reachable, and the access
  // interceptor is the only real boundary (CLAUDE.md). Never move a check from the backend to here.
  role?: Role;
}

const SidebarContext = createContext<SidebarState | null>(null);

// useSidebar returns null outside the provider rather than throwing.
//
// That is deliberate here and the opposite of `useModal`: these pieces are also rendered standalone
// in stories and could be reused outside the shell, and a sidebar chrome component that hard-crashes
// a page because it was mounted without its provider is a worse failure than one that renders in its
// default (expanded) state.
export function useSidebar(): SidebarState | null {
  return useContext(SidebarContext);
}

export const STORAGE_KEY = "legacy-sidebar-collapsed";

export function SidebarProvider({
  children,
  role,
  initialCollapsed,
}: {
  children: ReactNode;
  role?: Role;
  initialCollapsed?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(() => {
    if (initialCollapsed !== undefined) return initialCollapsed;

    // Restored from storage: the desktop collapse is a preference, and a preference that resets on
    // every reload is not one. Wrapped because storage throws in a sandboxed frame.
    try {
      return localStorage.getItem(STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });

  const [expanded, setExpanded] = useState(false);

  const value = useMemo<SidebarState>(
    () => ({
      collapsed,
      toggleCollapsed: () =>
        setCollapsed((current) => {
          const next = !current;
          try {
            localStorage.setItem(STORAGE_KEY, String(next));
          } catch {
            // A sandboxed frame just loses the preference; it must not break the sidebar.
          }
          return next;
        }),
      expanded,
      toggleExpanded: () => setExpanded((current) => !current),
      closeExpanded: () => setExpanded(false),
      role,
    }),
    [collapsed, expanded, role],
  );

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}
