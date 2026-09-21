import { Clipboard, Icon } from "@chakra-ui/react";
import { Copy } from "lucide-react";
import { Tooltip } from "../feedback/Tooltip";
import { ToneBadge, type ToneBadgeProps } from "./ToneBadge";

// RefIdBadge shows a product's reference id (its SKU) as a badge you can click to copy.
//
// Copying matters more here than it looks. A ref id is the string a person retypes into a
// marketplace back-office, a courier form or a chat message a dozen times a shift, and it is
// exactly the kind of value that is long enough to mistype and short enough that nobody notices
// until the wrong item ships. One click beats a careful selection drag every time.
//
// Two rules the component owns:
//
//  1. NO REF ID, NO BADGE. An empty ref id renders nothing rather than an empty chip — a blank
//     badge in a table cell reads as "this product has an unknown SKU" when the truth is that it
//     has none.
//  2. THE CLICK DOES NOT ESCAPE. Product rows are usually themselves clickable (they open the
//     detail page). Copying a SKU must not also navigate, so the trigger stops propagation.
export const description =
  "A product's ref id (SKU) as a click-to-copy badge. Renders nothing when there is no ref id, and its click never bubbles to the row beneath.";

export interface RefIdBadgeProps extends Omit<ToneBadgeProps, "children" | "tone"> {
  refId?: string;
}

export function RefIdBadge({ refId, ...rest }: RefIdBadgeProps) {
  // Rule 1.
  if (!refId) return null;

  return (
    <Clipboard.Root
      value={refId}
      // Rule 2: keep the copy inside the badge — a product row is a link.
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      display="inline-flex"
      w="fit-content"
    >
      <Clipboard.Context>
        {({ copied }) => (
          <Tooltip content={copied ? "SKU copied" : "Copy SKU"}>
            <Clipboard.Trigger asChild>
              <ToneBadge
                tone="plain"
                cursor="pointer"
                gap="1"
                whiteSpace="nowrap"
                data-testid="refid-badge"
                {...rest}
              >
                <Icon as={Copy} boxSize="3" />
                {refId}
              </ToneBadge>
            </Clipboard.Trigger>
          </Tooltip>
        )}
      </Clipboard.Context>
    </Clipboard.Root>
  );
}
