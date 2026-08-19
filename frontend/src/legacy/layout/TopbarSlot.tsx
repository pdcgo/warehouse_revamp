import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { TOPBAR_LEFT_SLOT, TOPBAR_RIGHT_SLOT } from "./MobileTopbar";

// TopbarSlot lets a PAGE put its own controls into the shell's top bar.
//
// It inverts the usual direction: rather than the layout knowing about every screen that might want
// a button up there — which turns the shell into a switch statement over routes — each screen
// declares its own, from inside itself, and the declaration unmounts with the screen.
//
// ⚠ IT RESOLVES THE TARGET IN AN EFFECT, not during render. The slot lives in the top bar, which
// mounts in the same commit as the page inside it — so on first render `getElementById` returns
// null. Portalling during render would silently drop the content on the first paint of every screen,
// and the symptom (a toolbar that fills in only after an unrelated re-render) is miserable to chase.
export const description =
  "Lets a page render its own controls into the shell's top bar, from inside the page. Resolves its target in an effect, because the slot mounts in the same commit as the page.";

export interface TopbarSlotProps {
  side?: "left" | "right";
  children: ReactNode;
}

export function TopbarSlot({ side = "right", children }: TopbarSlotProps) {
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setTarget(document.getElementById(side === "left" ? TOPBAR_LEFT_SLOT : TOPBAR_RIGHT_SLOT));
  }, [side]);

  // No bar on screen (desktop, or before it mounts) simply means nothing to fill.
  if (!target) return null;

  return createPortal(children, target);
}
