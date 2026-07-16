import { Badge, Text } from "@chakra-ui/react";
import { courierName, useShippingCatalogue } from "../shipping/catalogue";

// The STANDARD colour for each courier, so a courier always looks the same everywhere it is shown
// (#126). One place owns the mapping; every view renders through ShippingBadge.
//
// Keyed by the courier CODE, not the name: the code is the stable key a shipment stores, while the
// name is server data an admin can edit from the channels page.
//
// The colours are brand-ish (JNE's blue, J&T's red, SiCepat's orange, …). There are more couriers
// than Chakra has palettes, so the tail shares one with a brand-mate — sicepat/lion are both orange,
// wahana/idexpress both green, tiki/ncs both cyan. The LABEL is what identifies a courier; the
// colour only helps it stand out, so a shared palette costs nothing.
const COURIER_COLORS: Record<string, string> = {
  jne: "blue",
  jnt: "red",
  sicepat: "orange",
  anteraja: "teal",
  ninja: "purple",
  pos: "yellow",
  tiki: "cyan",
  wahana: "green",
  lion: "orange",
  idexpress: "green",
  sap: "pink",
  ncs: "cyan",
};

// An unknown code (a courier added after this map was written) is gray — never a crash, and never a
// misleading borrowed colour.
function courierColor(code: string): string {
  return COURIER_COLORS[code] ?? "gray";
}

// ShippingBadge renders a shipment's courier as a Chakra Badge in its standard colour (#126).
// This is THE way to show a shipment type — never render the courier code as bare text.
export const description =
  "A shipment's courier as a standard-coloured Chakra Badge (JNE=blue, J&T=red, …); no courier renders “—”.";

export function ShippingBadge({ code }: { code: string }) {
  const { couriers } = useShippingCatalogue();

  // A shipment can legitimately have no courier — a restock request need not be shipped. Show the
  // same muted "—" the call sites showed before, never an empty badge.
  if (!code) {
    return (
      <Text as="span" color="fg.muted">
        —
      </Text>
    );
  }

  return (
    <Badge colorPalette={courierColor(code)} data-testid={`shipping-badge-${code}`}>
      {courierName(couriers, code)}
    </Badge>
  );
}
