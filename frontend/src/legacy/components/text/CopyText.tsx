import type { ReactNode } from "react";
import { Clipboard, HStack, Icon, IconButton } from "@chakra-ui/react";
import { Check, Copy } from "lucide-react";
import { Tooltip } from "../feedback/Tooltip";

// CopyText wraps any value in a click-to-copy affordance: the value, then a small copy button that
// confirms by swapping to a check.
//
// The confirmation is the point. Clipboard writes are silent — nothing on screen changes — so
// without feedback a person clicks twice, or clicks and then pastes somewhere to check it took.
// Chakra's Clipboard.Indicator flips on `copied` and resets itself, so the confirmation cannot get
// stuck showing "copied" for a value that has since changed.
//
// The click never bubbles: these sit inside table rows that are themselves links.
export const description =
  "Any value with a click-to-copy button beside it, confirming with a check. Its click never bubbles to the row beneath.";

export interface CopyTextProps {
  // What lands on the clipboard. Defaults to the rendered children when they are a plain string —
  // pass it explicitly whenever the display form is formatted (a price, a date, a masked id), since
  // the thing worth pasting is almost never the thing worth reading.
  copyText?: string;
  children?: ReactNode;
  disabled?: boolean;
  // The action and its confirmation, as two separate strings rather than one plus a suffix —
  // "Copy" + "ed" reads as "Copyed", and a caller passing "Copy SKU" would get "Copy SKUed".
  label?: string;
  copiedLabel?: string;
}

export function CopyText({
  copyText,
  children,
  disabled,
  label = "Copy",
  copiedLabel = "Copied",
}: CopyTextProps) {
  const value = copyText ?? (typeof children === "string" ? children : "");

  return (
    <Clipboard.Root
      value={value}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      w="fit-content"
    >
      <HStack
        gap="1"
        bg="bg.muted"
        px="1"
        borderRadius="l2"
        whiteSpace="nowrap"
        data-testid="copy-text"
      >
        {children}
        <Clipboard.Context>
          {({ copied }) => (
            <Tooltip content={copied ? copiedLabel : label}>
              <Clipboard.Trigger asChild>
                <IconButton
                  type="button"
                  size="xs"
                  variant="ghost"
                  disabled={disabled}
                  // The accessible name flips too, not just the icon. A check-mark swap confirms
                  // the copy only to someone who can see it — without this, a screen-reader user
                  // gets no feedback at all from an operation that is otherwise entirely silent.
                  aria-label={copied ? copiedLabel : label}
                  data-testid="copy-text-trigger"
                >
                  <Icon as={copied ? Check : Copy} boxSize="3.5" />
                </IconButton>
              </Clipboard.Trigger>
            </Tooltip>
          )}
        </Clipboard.Context>
      </HStack>
    </Clipboard.Root>
  );
}
