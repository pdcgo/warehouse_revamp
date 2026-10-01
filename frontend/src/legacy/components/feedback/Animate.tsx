import type { ReactNode } from "react";
import { Presence } from "@chakra-ui/react";
import type { PresenceProps } from "@chakra-ui/react";

// Animate mounts its children when `show` becomes truthy, and — the part that is easy to get wrong —
// keeps them mounted through the EXIT animation before unmounting.
//
// A plain `{show && <Panel/>}` can only animate IN. On the way out React removes the node on the
// same tick the condition flips, so the exit keyframes never get a frame to run and the panel
// vanishes instantly. That asymmetry is very visible: things slide in politely and then blink out of
// existence. Chakra's `Presence` holds the node until the animation reports done, which is what makes
// an exit possible at all.
//
// `show` accepts any truthy value, not just a boolean, because the caller usually already has the
// thing being shown — an id, a selected row, a count — and `show={selectedId}` reads better than
// `show={selectedId !== undefined}` at every call site.
export const description =
  "Mounts children while `show` is truthy and keeps them mounted through the EXIT animation — the half a plain `{cond && …}` cannot do.";

export interface AnimateProps extends Omit<PresenceProps, "present" | "children"> {
  show?: boolean | number | string | bigint | null;
  children?: ReactNode;
}

export function Animate({ show, children, ...rest }: AnimateProps) {
  return (
    <Presence
      present={Boolean(show)}
      // A DEFAULT animation, so the component is useful without configuring one. An `Animate` that
      // animated nothing until you handed it keyframes would be Presence with extra steps — and the
      // caller most likely to reach for it is the one who just wants a panel not to blink.
      animationName={{ _open: "fade-in, scale-in", _closed: "fade-out, scale-out" }}
      animationDuration="moderate"
      // Something ALREADY SHOWING when the component mounts is simply there — it does not animate
      // in. Without this every panel that starts open replays its entrance on every mount, so a tab
      // switch or a re-render makes the whole screen flutter. An animation should mark a CHANGE.
      skipAnimationOnMount
      // The pair that makes this actually absent when it is not showing:
      //   lazyMount    — do not mount it AT ALL until the first time it is shown. Without this the
      //                  children mount immediately and merely hide, so their effects run and their
      //                  queries fire for a panel nobody has opened.
      //   unmountOnExit — and take it back down once it has finished animating away, rather than
      //                  leaving a hidden subtree holding state, queries and focus traps.
      lazyMount
      unmountOnExit
      data-testid="animate"
      {...rest}
    >
      {children}
    </Presence>
  );
}
