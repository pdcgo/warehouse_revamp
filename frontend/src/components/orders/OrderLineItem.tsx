import type { ReactNode } from "react";
import { HStack, Icon, Stack, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { Truck } from "lucide-react";

import { OrderStatus } from "../../gen/warehouse/selling/v1/order_pb";
import { OrderStatusBadge } from "../badges/OrderStatusBadge";

export interface OrderLineItemProps {
  /** OUR id for the order — rendered as `#1042`. It is what this system calls it, what the search box
   * matches and what a colleague quotes across the room.
   *
   * `undefined` or `0n` means NOT SAVED YET: an order still being typed on the create form has no id
   * until the server gives it one, and neither does a draft. That renders as a muted "Unsaved" rather
   * than `#0`, which would read as a real order number and is the one thing nobody could search for. */
  id?: bigint;
  /** THE ORDER REF ID — the number the order came in with, shown in parentheses after ours.
   *
   * This is the seller's own reference for the sale (a draft's `external_id`), and it is the only
   * name an order has before it is saved: a scraped draft has no `#id` at all, so this is what the
   * person matching it against their spreadsheet reads.
   *
   * "" or whitespace renders NOTHING — no empty `()`, no dash. An order taken over the phone has no
   * reference and never will. */
  orderRefId?: string;
  /** Where the order has got to. OPTIONAL, and omitting it renders NO badge — a draft has no status
   * at all, and inventing one (`PLACED`, "unknown") would state something about it that is not true. */
  status?: OrderStatus;

  /** The RECEIPT CODE — the courier's tracking number (nomor resi), as printed on the slip. The
   * order's THIRD name, and the one that outlives us: it is what the courier, the marketplace and the
   * buyer all call the parcel, so somebody chasing "where is my order" is holding this number.
   *
   * "" or whitespace renders nothing — no icon, no dash, no reserved space. An order is placed hours
   * or days before a courier issues one, so a marker on every unshipped order is the noise that
   * trains people to stop reading the field. Same rule as CustomerLineItem's phone.
   *
   * ⚠ NOT the attached slip. `OrderReceipt` (document_id / filename) is the FILE — a photo of the
   * paper — and it is not shown here: opening one costs a `GetDownloadUrl` call against
   * document_service, which in a list of forty rows is forty calls. A caller that wants the file
   * offers it from `action` and fetches the url on click, as `ReceiptCard` does. */
  receiptCode?: string;

  /** Optional trailing content: actions, a check, etc. */
  action?: ReactNode;
  /** Presentation size. "md" (default) is the compact list row; "lg" enlarges the order number for a
   * detail-page header, where the order is the subject rather than one row. */
  size?: "md" | "lg";
  /** Suffix for this row's `data-testid`. Defaults to the order id. */
  testId?: string | number | bigint;
}

// OrderLineItem is the shared way to IDENTIFY an order — one line of names, one line of parcel:
//
//     #1042 (INV-250815-004)  [Shipped]
//     🧾 JP2026081500471183
//
// AN ORDER HAS SEVERAL NAMES, and which one somebody is holding depends on who they are. We call it
// `#1042`. The seller's own record calls it by its ref. The courier, the marketplace and the buyer
// call the parcel by its receipt code. Every one of those is how a real question arrives — "where is
// 1042", "did INV-250815-004 ever ship", "the buyer is asking about JP2026…" — so the row a person
// scans has to carry all of them, and none of them is decoration.
//
// ⚠ A SECOND REF IS COMING (owner): a MARKETPLACE order ref, alongside the seller's. It will sit in
// the same parentheses, which is why the prop is `orderRefId` and not a generic `ref` — a name that
// cannot say which of the two it holds is one that will have to be renamed the day the other lands.
//
// IT IS THE ORDER'S IDENTITY, NOT ITS SUMMARY (owner). No customer, no money, no date, no line count.
// Each belongs to a component or a column that already owns it — `CustomerLineItem` for the buyer, a
// right-aligned total column for the money — and a caller composes them. Folding them in here would
// give every one of those facts a second home, and leave a picking queue or a receipt-chasing list
// turning off halves it never asked for.
//
// It is PRESENTATIONAL and fetches nothing — a list renders many of these, so any lookup here would be
// an N+1. That is also why it shows the receipt CODE and not the attached slip: the code is a string
// already on the row, while the file needs a document_service call per order.
//
// ⚠ THE PROTO CARRIES NEITHER STRING ON AN ORDER YET. A DRAFT has `external_id` (the ref), but a
// promoted `Order` has no ref and no receipt code — `OrderReceipt` is the FILE and `shipping_code` is
// the courier, not the parcel. This is the frontend-first order working as intended (HARD RULE 6): the
// screen states what it needs and the contract follows. Until it does, the caller supplies the strings.
//
// The status comes from the shared `OrderStatusBadge` rather than a local colour table, so a status
// looks the same here as on the tabs above it. Re-implementing it is how two screens start disagreeing
// about the same order.
//
// NOT to be confused with a line OF an order — that is `features/orders/OrderLineRow`, a table row of
// one product with its quantity and its money. This is the order itself, as one item in a list.
export const description =
  "The shared way to identify an order — `#our-id (the order's own ref)` with its status badge, and the courier's RECEIPT CODE (nomor resi) underneath. Identity only: no customer, no money, no date, because each belongs to a component or a column that already owns it. An order with NO ID yet is “Unsaved”, never “#0” — a scraped draft is read by its ref alone. Every reference is rendered VERBATIM and never wraps or clamps, because all three are copied into somebody else's search box.";

export function OrderLineItem({
  id,
  orderRefId,
  status,
  receiptCode,
  action,
  size = "md",
  testId,
}: OrderLineItemProps) {
  const { t } = useTranslation();
  const large = size === "lg";

  const key = (testId ?? (id !== undefined ? id : "")).toString();

  // `0n` is falsy, so a plain truthiness test happens to be right — but it is written out, because
  // "no id yet" and "id zero" are the same state here and the next reader should not have to work
  // that out from an implicit coercion.
  const saved = id !== undefined && id > 0n;

  // BOTH references are TRIMMED, and blank counts as absent — a value scraped off a marketplace push
  // arrives padded often enough that " " would otherwise render as empty parentheses, or as an icon
  // beside an empty space.
  //
  // Neither is otherwise transformed: no uppercasing, no stripping of dashes or spaces inside them.
  // They are pasted into somebody else's search box — the seller's spreadsheet, the courier's tracking
  // page — and a reference we have "tidied" is one that comes back not found.
  const ref = orderRefId?.trim() ?? "";
  const code = receiptCode?.trim() ?? "";

  return (
    <HStack gap="card" w="full" align="start" data-testid={`order-line-item-${key}`}>
      <Stack gap="0.5" flex="1" minW="0">
        <HStack gap="2" minW="0">
          <Text
            fontWeight="semibold"
            fontSize={large ? "lg" : "sm"}
            color={saved ? undefined : "fg.muted"}
            fontStyle={saved ? undefined : "italic"}
            whiteSpace="nowrap"
            data-testid={`order-line-item-id-${key}`}
          >
            {saved ? `#${id.toString()}` : t("orderLineItem.unsaved")}
          </Text>

          {/* IN PARENTHESES, and BOLD (owner): the brackets say it is a second name for the same
              thing rather than a second fact, while the weight says it is a name people actually work
              from. It is muted rather than plain so the two names stay distinguishable at a glance —
              the brackets alone do that on one row, but not down a column of forty. */}
          {ref !== "" && (
            <Text
              fontWeight="bold"
              fontSize={large ? "sm" : "xs"}
              color="fg.muted"
              whiteSpace="nowrap"
              data-testid={`order-line-item-ref-${key}`}
            >
              ({ref})
            </Text>
          )}

          {status !== undefined && <OrderStatusBadge status={status} />}
        </HStack>

        {code !== "" && (
          <HStack gap="1" minW="0" data-testid={`order-line-item-receipt-${key}`}>
            {/* A TRUCK, not a receipt (owner). The glyph should say what the code IS — a parcel in
                somebody else's hands — and a receipt/paperclip says "a document", which is the
                attached slip this row deliberately does not show. `Package` was the other candidate
                and is already the product placeholder (ProductListItem), so it would mean two things
                in one list. */}
            <Icon as={Truck} boxSize="3" color="fg.muted" flexShrink={0} />
            {/* NEVER CLAMPED, never wrapped — the same rule CustomerLineItem's phone follows, for the
                same reason. A tracking number is read aloud and pasted whole, and half of one with an
                ellipsis after it is worse than none: it looks like a value somebody can use. A long
                code overflows its column instead, which is visible and fixable. */}
            <Text fontSize="xs" color="fg.muted" whiteSpace="nowrap">
              {code}
            </Text>
          </HStack>
        )}
      </Stack>

      {action}
    </HStack>
  );
}
