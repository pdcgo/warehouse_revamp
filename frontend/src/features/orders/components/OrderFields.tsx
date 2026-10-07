import type { ReactNode } from "react";
import { Stack, Text } from "@chakra-ui/react";

import type { OrderAddress } from "../../../gen/warehouse/selling/v1/order_pb";

// The labelled fields an order is read through — shared by BOTH ends of an order (#151): the selling
// team's Info panel and the warehouse crew's order screen.
//
// They live in features/ rather than beside either page because two pages use them (CLAUDE.md). They
// were page-scoped to pages/order-detail/components/ while only the seller read an order; the moment
// the warehouse screen grew a delivery block they became a domain component, and leaving them where
// they were is how one page's directory quietly turns into a domain module.

// `value` is a ReactNode, not a string: most fields are plain text, but some render a component (the
// courier is a ShippingBadge). An empty string still falls back to the same "—" as before; a
// component decides its own empty state.
export function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Stack gap="0.5" minW="0">
      <Text fontSize="xs" fontWeight="medium" color="fg.muted" textTransform="uppercase">
        {label}
      </Text>
      <Text as="div" fontSize="sm" lineClamp={3}>
        {value || "—"}
      </Text>
    </Stack>
  );
}

// The order's FROZEN address (#118), read straight off the snapshot — the names are stored alongside
// the codes, so this renders a years-old order without asking region_service anything.
//
// Every part is optional (the address itself is), so each line is rendered only if it has content and
// an absent/blank address falls back to the same "—" every other empty field shows.
//
// ⚠ NOT line-clamped, unlike Field. On the warehouse screen this is what somebody copies onto a parcel,
// and an address truncated at three lines with an ellipsis is a parcel sent to the wrong place.
export function AddressField({ label, address }: { label: string; address?: OrderAddress }) {
  const street = address?.addressLine ?? "";
  const kodePos = address?.kodePos ?? "";
  // Narrowest first — how an address is read aloud: "Keude Bakongan, Bakongan, Kabupaten Aceh
  // Selatan, Aceh".
  const region = [
    address?.desaName,
    address?.kecamatanName,
    address?.kabupatenName,
    address?.provinsiName,
  ]
    .filter((part) => part)
    .join(", ");

  return (
    <Stack gap="0.5" minW="0">
      <Text fontSize="xs" fontWeight="medium" color="fg.muted" textTransform="uppercase">
        {label}
      </Text>

      {street === "" && region === "" && kodePos === "" ? (
        <Text fontSize="sm">—</Text>
      ) : (
        <Stack gap="0" data-testid="order-detail-address">
          {street !== "" && <Text fontSize="sm">{street}</Text>}
          {region !== "" && <Text fontSize="sm">{region}</Text>}
          {kodePos !== "" && <Text fontSize="sm">{kodePos}</Text>}
        </Stack>
      )}
    </Stack>
  );
}
