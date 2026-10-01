import { useTranslation } from "react-i18next";
import { Field, Heading, Input, Stack } from "@chakra-ui/react";

import { ShippingSelect } from "../pickers/ShippingSelect";
import { ReceiptUpload } from "../orders/ReceiptUpload";
import type { ReceiptValue } from "../orders/ReceiptUpload";

// THE SHIPPING RECEIPT CARD — who is carrying the parcel, under what number, and the slip that says so.
//
// THE THREE ARE ONE MOMENT, which is why they share a card: somebody hands the parcel over, and comes
// back holding a courier, a tracking number and a piece of paper. They are not the same FACT, though,
// and the card is worth reading in that order:
//
//   COURIER   which company has it — a code from the shared catalogue, not typed
//   CODE      the parcel's name, the thing everybody outside this system tracks it by
//   FILE      a photo of the paper the code was printed on
//
// Each can exist without the ones below it. A courier is chosen when the order is taken, hours before
// a number exists; a code with no photo is the ordinary state of a shipped order; a photo with no code
// is a picture nobody can search for.
//
// The split with `ReceiptUpload` is worth keeping straight: THIS is the section — a title and a box —
// while `ReceiptUpload` is the CONTROL, which knows about document_service's two-phase upload, the
// 10 MB ceiling and what to do when a file is refused. A caller with its own framing (a dialog, a
// panel on a draft screen) uses the control directly and skips this.
//
// It started life as JSX inline on the create form, which is how the card and its heading ended up
// being page layout while the control beside them was a component — one idea living in two files.
//
// ⚠ A SECTION, NOT A CARD (owner). It renders a heading and its fields, and the CALLER supplies the
// card — because it now sits as one CELL of `CustomerInfoForm`'s grid, under the customer and beside the
// address. Wrapping itself would put a card inside a card, which reads as a box somebody forgot to
// take off. It lives in `components/customers/` for the same reason: it is part of that card now,
// not a thing an orders screen arranges for itself.
//
// NOT required, on any screen that mounts it: nothing here gates a submit (#118). An order ships
// before its slip exists far more often than not.
export const description =
  "The shipping-receipt SECTION of the customer card (the caller supplies the card) — the COURIER (from the shared catalogue), the RECEIPT CODE (nomor resi) and the one file an order carries: a photo of the slip, or the PDF the marketplace prints. The three are one moment but not one fact, and each can exist without the ones below it. The code is typed verbatim, never uppercased or stripped, because it is pasted into the courier's tracking box. The file is REPLACED rather than accumulated, because an order ships once; removing it detaches the file from the order and deliberately leaves the uploaded document where it is. Each of the courier and the code appears only when the caller passes a handler for it — a field whose contents are dropped on submit is worse than no field.";

export function ShippingReceipt({
  teamId,
  value,
  onChange,
  shippingCode,
  onShippingCodeChange,
  code,
  onCodeChange,
}: {
  /** The team the document is uploaded FOR — document_service scopes every file to one. `0n` while no
   * team is chosen, which is the same "not yet" the rest of a form holds. */
  teamId: bigint;
  value: ReceiptValue;
  onChange: (value: ReceiptValue) => void;

  /** WHICH COURIER is carrying it — a `Shipping.code` from the shared catalogue (`jne`, `sicepat`),
   * never a typed name. The code is the stable key an order stores; the label is looked up for
   * display, so renaming a courier never rewrites the orders that used it. */
  shippingCode?: string;
  /** Omit to hide the courier picker — same rule as `onCodeChange` below. */
  onShippingCodeChange?: (code: string) => void;

  /** The courier's tracking number, as typed.
   *
   * ⚠ Held RAW — what is typed is what is stored. The field never uppercases, trims mid-typing or
   * strips the dashes and spaces inside a code: it is pasted into the courier's tracking box, and one
   * we have "tidied" is one that comes back not found. `OrderLineItem` trims for DISPLAY only. */
  code?: string;
  /** Omit to hide the code field entirely — the card is then the file alone. A caller that cannot
   * hold the value must not show a box for it: a field whose contents are dropped on submit is worse
   * than no field, because somebody types a real number into it and believes it was saved. */
  onCodeChange?: (code: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <Stack gap="card" data-testid="order-receipt-section">
      <Heading as="h3" size="sm">{t("orders.receipt")}</Heading>

      {onShippingCodeChange && (
        <Field.Root>
          <Field.Label>{t("orders.shipping")}</Field.Label>
          {/* The SHARED picker, not a local list: it is backed by the one courier catalogue the
              whole app reads, so a screen with a picker and badges makes a single ShippingList
              call and the two can never disagree about what `jne` is called. */}
          <ShippingSelect value={shippingCode} onChange={onShippingCodeChange} />
        </Field.Root>
      )}

      {onCodeChange && (
        <Field.Root>
          <Field.Label>{t("orders.receiptCode")}</Field.Label>
          <Input
            value={code ?? ""}
            placeholder={t("orders.receiptCodePlaceholder")}
            data-testid="order-receipt-code"
            onChange={(e) => onCodeChange(e.target.value)}
          />
          <Field.HelperText>{t("orders.receiptCodeHelp")}</Field.HelperText>
        </Field.Root>
      )}

      <ReceiptUpload teamId={teamId} value={value} onChange={onChange} />
    </Stack>
  );
}
