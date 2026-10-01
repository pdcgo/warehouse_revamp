import { useTranslation } from "react-i18next";
import { Card, Field, Grid, GridItem, Heading, Input, Stack } from "@chakra-ui/react";

import { AddressPicker } from "./AddressPicker";
import type { AddressValue } from "./AddressPicker";
import { ShippingReceipt } from "./ShippingReceipt";
import { emptyReceipt } from "../orders/ReceiptUpload";
import type { ReceiptValue } from "../orders/ReceiptUpload";

export interface CustomerInfoFormProps {
  /** data-testid prefix — "order-create" on the form, "draft" on a draft. */
  idPrefix?: string;
  customerName: string;
  onCustomerNameChange: (value: string) => void;
  customerPhone: string;
  onCustomerPhoneChange: (value: string) => void;
  /** Where the parcel goes. CONTROLLED, like the picker itself — the caller owns the value so it can
   * snapshot the names onto its own record. */
  address: AddressValue;
  onAddressChange: (value: AddressValue) => void;

  /** The team the receipt's file is uploaded FOR — document_service scopes every file to one. */
  teamId?: bigint;
  receipt?: ReceiptValue;
  /**
   * Omit to leave the RECEIPT CELL out entirely — the card is then customer + address, which is the
   * shape a DRAFT wants: nothing has been handed to a courier yet, so there is no slip to attach and
   * no tracking number to type. Same rule the receipt's own fields follow: a caller that cannot hold
   * the value must not show a box for it.
   */
  onReceiptChange?: (value: ReceiptValue) => void;

  /** WHICH COURIER is carrying it — a `Shipping.code` from the shared catalogue. Rendered inside the
   * receipt cell, so it appears only when that cell does. */
  shippingCode?: string;
  onShippingCodeChange?: (value: string) => void;
}

// WHO THE ORDER IS FOR, WHERE IT GOES, AND WHAT WAS HANDED OVER — one card, THREE CELLS (owner):
//
//   ┌ Customer Information ─────────────────────┐
//   │ Who the parcel is for, where it goes, …   │
//   ├ Customer ─────────┬ Address ──────────────┤
//   │  name             │  provinsi → kabupaten │
//   │  phone            │  → kecamatan → desa   │
//   ├ Shipping receipt ─┤  postcode, street     │
//   │  courier, code    │                       │
//   │  slip             │                       │
//   └───────────────────┴───────────────────────┘
//
// THEY ARE ONE ANSWER, which is why they share a card rather than sitting in three: they are taken
// down in one breath, from one person, in one phone call — "Bu Ani, 0812…, Dago, Coblong, by JNE".
// Split across separate cards, the address drifted so far from the name that nothing on screen said
// whose address it was.
//
// THE SHAPE IS WHAT MAKES IT WORK, and it is why the address takes a column to itself and spans both
// rows. It is a four-rung cascade plus a postcode and a street box — far taller than anything else
// here — so a row-per-section layout would leave a hole beside it every time. The two SHORT sections
// stack down the left instead, and the row closes level with the address.
//
// Below `md` the grid collapses to one column in reading order: customer, address, receipt.
//
// ⚠ THE COURIER LIVES IN THE RECEIPT CELL, not among the customer's fields, and the difference is not
// cosmetic: a courier is a fact about the PARCEL, not about the person. It sits beside the tracking
// number and the slip because those are the same moment — somebody hands the box over and comes back
// with all three.
//
// The shipping COST is not here either, and is not coming back (owner). It is not gone from an order
// — the contract and the column still carry it, historical orders still read theirs, the detail page
// still shows it — it is simply no longer typed in, so a new order places at `total = subtotal`.
//
// The labels are the `orders.*` strings deliberately: these are an ORDER's fields rendered by a
// customer-shaped card, and a second copy of "Customer name" under a `customers.*` key is how two
// screens start disagreeing about what the field is called.
export const description =
  "The customer card on an order form — titled \"Customer Information\", with a one-line description under it and THREE SECTIONS below: who the parcel is for (name, phone) with the shipping receipt beneath it on the left, and where it goes (AddressPicker) taking the right column across both rows. They share a card because they are one answer, taken down from one person in one breath. The address gets its own full-height column because it is a four-rung cascade plus a postcode and a street box, so any row-per-section layout leaves a hole beside it. The NAME is the only required field — the one that gates Create, and the one a draft must have before it can promote — while the address is entirely optional (#118): an order can be taken before the address is known. The RECEIPT SECTION is omitted unless the caller passes `onReceiptChange`, which is the draft case: nothing has been handed to a courier yet. Below md the grid collapses to one column in reading order — customer, address, receipt.";

export function CustomerInfoForm(props: CustomerInfoFormProps) {
  const {
    idPrefix = "order-create",
    customerName,
    onCustomerNameChange,
    customerPhone,
    onCustomerPhoneChange,
    address,
    onAddressChange,
    teamId,
    receipt,
    onReceiptChange,
    shippingCode,
    onShippingCodeChange,
  } = props;
  const { t } = useTranslation();

  return (
    <Card.Root>
      {/* THE CARD'S OWN TITLE, above the three sections (owner) — and a line saying what it is for.
          Chakra's `Card.Title`/`Card.Description`, not another hand-rolled heading: the card knows
          how to space and size its own header, and this is the one place in the card where the type
          scale is not being chosen by hand.

          It reads one level ABOVE the section titles inside it, which is what makes the grid legible
          as one thing: "Customer Information" is the subject, and Customer / Delivery address /
          Shipping receipt are its parts. Without it the card opened on three same-sized headings with
          nothing saying they belonged together. */}
      <Card.Header>
        <Card.Title>{t("orders.customerInfo")}</Card.Title>
        <Card.Description>{t("orders.customerInfoHelp")}</Card.Description>
      </Card.Header>

      <Card.Body>
        {/* EXPLICIT `gridColumn`/`gridRow` rather than flow, because the address has to SPAN both
            rows — and because DOM order then stays reading order (customer, address, receipt), which
            is also the tab order and the single column a narrow screen collapses to.

            `alignItems="start"` so a short cell keeps its own height instead of stretching to the
            address's — a two-field section padded out to five rungs reads as a section with fields
            missing from the bottom of it. */}
        <Grid
          templateColumns={{ base: "1fr", md: "minmax(0, 1fr) minmax(0, 1fr)" }}
          gap="section"
          alignItems="start"
        >
          <GridItem gridColumn={{ md: 1 }} gridRow={{ md: 1 }}>
            <Stack gap="card" data-testid={`${idPrefix}-customer`}>
              <Heading as="h3" size="sm">{t("orders.customer")}</Heading>

              <Field.Root required>
                <Field.Label>{t("orders.customerName")}</Field.Label>
                <Input
                  value={customerName}
                  data-testid={`${idPrefix}-customer-name`}
                  onChange={(e) => onCustomerNameChange(e.target.value)}
                />
              </Field.Root>

              <Field.Root>
                <Field.Label>{t("orders.phone")}</Field.Label>
                <Input
                  value={customerPhone}
                  data-testid={`${idPrefix}-customer-phone`}
                  onChange={(e) => onCustomerPhoneChange(e.target.value)}
                />
              </Field.Root>
            </Stack>
          </GridItem>

          {/* NOT required, and nothing here gates a submit (#118): an order is taken while the buyer
              is still looking up their own postcode.

              It SPANS BOTH ROWS — the tall thing gets the full-height column, and the two short
              sections stack beside it. A span of 2 is safe with no receipt: an empty second row
              takes no height. */}
          <GridItem gridColumn={{ md: 2 }} gridRow={{ md: "1 / span 2" }}>
            <Stack gap="card" data-testid={`${idPrefix}-address`}>
              <Heading as="h3" size="sm">{t("orders.deliveryAddress")}</Heading>
              <AddressPicker value={address} onChange={onAddressChange} />
            </Stack>
          </GridItem>

          {/* WHAT WAS HANDED OVER — under the customer, and only when the caller can hold it. */}
          {onReceiptChange && (
            <GridItem gridColumn={{ md: 1 }} gridRow={{ md: 2 }}>
              <ShippingReceipt
                teamId={teamId ?? 0n}
                value={receipt ?? emptyReceipt}
                onChange={onReceiptChange}
                shippingCode={shippingCode}
                onShippingCodeChange={onShippingCodeChange}
              />
            </GridItem>
          )}
        </Grid>
      </Card.Body>
    </Card.Root>
  );
}
