import { useEffect, useRef, useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import { Icon, chakra } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { Check, Copy, TriangleAlert } from "lucide-react";

import { writeClipboard } from "../../../lib/clipboard";

// A VALUE SOMEBODY HAS TO PASTE SOMEWHERE ELSE (owner: *"resi dan orderid copyable"*).
//
// The two references on an order row are not read, they are CARRIED: the marketplace order id goes into
// the platform's own dashboard, and the resi goes into a courier's tracking page or a WhatsApp reply to
// a buyer. Both are long, both are alphanumeric, and retyping either is how the wrong parcel gets
// chased. Our `#id` is not one of these — it is quoted across a room, not pasted into another system.
//
// ⚠ IT STOPS THE ROW'S NAVIGATE. The row opens the order on click, so without `stopPropagation` copying
// a number would also leave the page — the copy would succeed and nobody would see it happen.
//
// ⚠ THE CONFIRMATION IS ON THE CONTROL, NOT A TOAST — and it only says "copied" when something WAS.
// This used Chakra's `Clipboard`, whose ✓ appears whether or not the browser accepted the write; inside
// Storybook's iframe the write was refused, the clipboard stayed empty, and the tick said otherwise
// (owner: *"copyable tidak copy?"*). `writeClipboard` waits for the outcome and falls back when the
// async API refuses, so the icon now shows ✓ on success and ⚠ on a real failure — and a failure leaves
// the text selectable, so it can still be copied by hand.
//
// ⚠ IT IS NOT IN `components/` YET, deliberately — one page uses it (CLAUDE.md's rule is that the
// second page to import it is what makes it design-system furniture). It wants a story the day it
// moves.
export function CopyText({
  value,
  display,
  mono = false,
  fontSize,
  testId,
}: {
  /** What lands on the clipboard. */
  value: string;
  /**
   * What is SHOWN, when it differs from what is copied — an amount displays as "Rp 245.000" and
   * copies as "245000", because the paste goes into a sheet or a marketplace form that wants a number.
   */
  display?: ReactNode;
  /** A tracking number is read character by character, so it gets a monospace face. */
  mono?: boolean;
  /** Overrides the default size — a table cell keeps a mono value small, a headline reference does not. */
  fontSize?: string;
  testId?: string;
}) {
  const { t } = useTranslation();
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copy(event: MouseEvent) {
    // A row opens its order on click; copying must not also leave the page.
    event.stopPropagation();

    const ok = await writeClipboard(value);

    setState(ok ? "copied" : "failed");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), ok ? 1500 : 3000);
  }

  const label =
    state === "copied" ? t("common.copied") : state === "failed" ? t("common.copyFailed") : t("common.copy");

  return (
    <chakra.button
      type="button"
      display="inline-flex"
      alignItems="center"
      gap="1"
      cursor="pointer"
      maxW="full"
      textAlign="start"
      whiteSpace="nowrap"
      // Selectable, so a refused copy can still be done by hand.
      userSelect="text"
      fontFamily={mono ? "mono" : undefined}
      fontSize={fontSize ?? (mono ? "xs" : undefined)}
      fontWeight="inherit"
      color="inherit"
      _hover={{ color: "brand.fg" }}
      _focusVisible={{ outline: "2px solid", outlineColor: "brand.focusRing", outlineOffset: "2px", rounded: "sm" }}
      aria-label={`${label}: ${value}`}
      title={label}
      data-testid={testId}
      data-copied={state === "copied" ? "" : undefined}
      data-copy-failed={state === "failed" ? "" : undefined}
      onClick={copy}
    >
      {display ?? value}
      {state === "copied" ? (
        <Icon as={Check} boxSize="3" color="success.fg" />
      ) : state === "failed" ? (
        <Icon as={TriangleAlert} boxSize="3" color="error.fg" />
      ) : (
        <Icon as={Copy} boxSize="3" color="fg.subtle" />
      )}
    </chakra.button>
  );
}
