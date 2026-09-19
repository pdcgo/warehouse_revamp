import type { ReactNode } from "react";
import { HStack, Icon, Stack, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { MapPin, Phone } from "lucide-react";

/** A customer's address, names only.
 *
 * Deliberately a STRUCTURAL type rather than an import of `OrderAddress`: the same names are carried
 * by the order's frozen snapshot (selling/v1 `OrderAddress`), by a draft's, and by `AddressPicker`'s
 * in-progress `AddressValue`. All three satisfy this, so a form can render the customer it is still
 * typing with the same component that renders a two-year-old order — and this component never has to
 * track another service's contract to do it. */
export interface CustomerAddress {
  desaName?: string;
  kecamatanName?: string;
  kabupatenName?: string;
  provinsiName?: string;
  addressLine?: string;
  kodePos?: string;
}

export interface CustomerLineItemProps {
  /** The customer's name — the ONLY field an order requires (`OrderCreate` rejects an empty one).
   *
   * Blank is still a real state to render: a draft scraped off a marketplace push may arrive without
   * a readable customer, and that is precisely what `draftGaps` flags as `missingCustomer`. See
   * `missingLabel` for how it is shown. */
  name?: string;
  /** How to reach them. Rendered under the name when `showPhone` is on AND there is one. */
  phone?: string;
  /** Where the parcel goes. Rendered under the name when `showAddress` is on.
   *
   * ⚠ A SUMMARY, not the shipping label — see `showAddress`. */
  address?: CustomerAddress;

  /** Show the phone. DEFAULT ON: who the buyer is and how to reach them is the pair a customer row
   * is read for, and every list that shows a customer today would want both.
   *
   * ⚠ An empty phone still renders NOTHING — no dash, no icon, no reserved line — even with this on.
   * The flag says "this column has room for a phone", not "insist there is one". That is the
   * OPPOSITE of how a blank `name` behaves, on purpose: a missing name blocks the order and must be
   * seen, while a missing phone blocks nothing, and a column of "—" down forty rows is noise that
   * trains people to stop reading the field. */
  showPhone?: boolean;
  /** Show the address. DEFAULT OFF: a customer column in a list has room for a name and a phone, and
   * where the parcel goes is a different question from who the buyer is — a caller asks for it.
   *
   * It renders as ONE clamped line, narrowest first — the order an address is said aloud ("Dago,
   * Coblong, Kota Bandung, Jawa Barat").
   *
   * ⚠ IT IS A SUMMARY, AND IT DROPS THE STREET LINE AND THE POSTCODE. Anything somebody copies onto
   * a parcel must use `AddressField` (features/orders/components/OrderFields.tsx), which renders
   * every part and is unclamped for exactly that reason. */
  showAddress?: boolean;

  /** What to render instead of a name when there is none. Defaults to a muted "No customer".
   * Pass a plainer fallback where the blank is expected rather than wrong. */
  missingLabel?: string;
  /** Optional trailing content: actions, a check, etc. */
  action?: ReactNode;
  /** Presentation size. "md" (default) is the compact list row; "lg" enlarges the name for a
   * detail-page header, where the customer is the subject rather than one row. */
  size?: "md" | "lg";
  /** Suffix for this row's `data-testid` — usually the order or draft id. */
  testId?: string | number | bigint;
}

// CustomerLineItem is the shared way to show a customer: who the parcel is for, how to reach them
// and — optionally — roughly where it goes.
//
// A CUSTOMER IS NOT AN ENTITY IN THIS SYSTEM, and the props are flat because of it. There is no
// Customer message and no customers table: a name, a phone and an address are FROZEN onto each order
// (order.proto #118, the same decision the order makes about its money and its lines). Wrapping the
// fields in a `customer` object would draw a record that does not exist and invite somebody to go
// looking for the id it does not have.
//
// It is PRESENTATIONAL and fetches nothing — a list renders many of these, so any lookup here would
// be an N+1. Everything the app currently shows as a bare `{o.customerName}` cell (the order list,
// the pick queue, the draft list) is what this replaces.
//
// NO AVATAR (owner). UserItem and ProductListItem lead with one because they have something to show
// — an uploaded photo, a product's cover image. A customer has neither: they have no account and no
// image, so the only thing an avatar could render is initials, and a column of coloured initial
// circles is decoration that pushes the name it decorates to the right. The name IS the row.
export const description =
  "The shared way to show a customer — their name, and optionally their phone (on by default) and a one-line address summary (off by default), each behind its own flag so a caller shows only what its column has room for. A MISSING NAME is shown as “No customer” rather than a dash, because an order requires one and a draft without it cannot be promoted.";

export function CustomerLineItem({
  name,
  phone,
  address,
  showPhone = true,
  showAddress = false,
  missingLabel,
  action,
  size = "md",
  testId,
}: CustomerLineItemProps) {
  const { t } = useTranslation();
  const large = size === "lg";

  const display = name?.trim() ?? "";
  const missing = display === "";
  const label = missing ? (missingLabel ?? t("customerLineItem.missing")) : display;

  // "" is falsy, so plain truthiness is exactly right here — unlike a stock count, an absent phone
  // is the ordinary state and has nothing to report.
  const tel = showPhone ? (phone?.trim() ?? "") : "";

  // Narrowest first, matching AddressField. Every part is optional (the address itself is), so a
  // snapshot that only ever got a province still renders that one name instead of an empty line.
  const place = showAddress
    ? [address?.desaName, address?.kecamatanName, address?.kabupatenName, address?.provinsiName]
        .filter((part) => part)
        .join(", ")
    : "";

  return (
    <HStack gap="card" w="full" data-testid={`customer-line-item-${testId ?? ""}`}>
      <Stack gap="0.5" flex="1" minW="0">
        <Text
          fontWeight="medium"
          fontSize={large ? "lg" : undefined}
          color={missing ? "fg.muted" : undefined}
          fontStyle={missing ? "italic" : undefined}
          lineClamp={1}
          textAlign="start"
          data-testid={`customer-line-item-name-${testId ?? ""}`}
        >
          {label}
        </Text>

        {(tel !== "" || place !== "") && (
          <HStack gap="2" minW="0">
            {tel !== "" && (
              <HStack gap="1" flexShrink={0} data-testid={`customer-line-item-phone-${testId ?? ""}`}>
                <Icon as={Phone} boxSize="3" color="fg.muted" />
                {/* A phone number is dialled and pasted, so it never wraps or clamps mid-number. */}
                <Text fontSize="xs" color="fg.muted" whiteSpace="nowrap">
                  {tel}
                </Text>
              </HStack>
            )}
            {place !== "" && (
              <HStack gap="1" minW="0" data-testid={`customer-line-item-address-${testId ?? ""}`}>
                <Icon as={MapPin} boxSize="3" color="fg.muted" flexShrink={0} />
                <Text fontSize="xs" color="fg.muted" lineClamp={1}>
                  {place}
                </Text>
              </HStack>
            )}
          </HStack>
        )}
      </Stack>

      {action}
    </HStack>
  );
}
