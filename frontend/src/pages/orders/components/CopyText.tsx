import { Clipboard, Icon } from "@chakra-ui/react";
import { Check, Copy } from "lucide-react";

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
// ⚠ THE CONFIRMATION IS ON THE CONTROL, NOT A TOAST. `Clipboard.Indicator` swaps the icon for a check
// where the eye already is. A toast for something this small is a second thing to read, and the person
// is already moving to the window they are pasting into.
//
// ⚠ IT IS NOT IN `components/` YET, deliberately — one page uses it (CLAUDE.md's rule is that the
// second page to import it is what makes it design-system furniture). It wants a story the day it
// moves.
export function CopyText({
  value,
  mono = false,
  testId,
}: {
  value: string;
  /** A tracking number is read character by character, so it gets a monospace face. */
  mono?: boolean;
  testId?: string;
}) {
  return (
    <Clipboard.Root value={value} onClick={(e) => e.stopPropagation()}>
      {/* The Trigger IS the button — styling it directly beats wrapping a second element in `asChild`,
          which is what lost the keyboard affordance the first time this was written. */}
      <Clipboard.Trigger
        display="inline-flex"
        alignItems="center"
        gap="1"
        cursor="pointer"
        maxW="full"
        textAlign="start"
        whiteSpace="nowrap"
        fontFamily={mono ? "mono" : undefined}
        fontSize={mono ? "xs" : undefined}
        _hover={{ color: "brand.fg" }}
        data-testid={testId}
      >
        {value}
        <Clipboard.Indicator copied={<Icon as={Check} boxSize="3" color="success.fg" />}>
          <Icon as={Copy} boxSize="3" color="fg.subtle" />
        </Clipboard.Indicator>
      </Clipboard.Trigger>
    </Clipboard.Root>
  );
}
