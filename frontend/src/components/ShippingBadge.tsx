import { Badge } from "./ui/Badge";
import type { BadgePalette } from "./ui/Badge";
import { courierName, useShippingCatalogue } from "../features/shipping/catalogue";

// The STANDARD colour for each courier, so a courier always looks the same everywhere it is shown
// (#126). One place owns the mapping; every view renders through ShippingBadge.
//
// Keyed by the courier CODE, not the name: the code is the stable key a shipment stores, while the
// name is server data an admin can edit from the channels page.
//
// The colours are the couriers' house hues (JNE blue, J&T red, SiCepat orange, Anteraja teal, POS
// yellow, TIKI/NCS cyan, SAP pink, …). Where two share a colour they share a palette — sicepat/lion
// orange, wahana/idexpress green, tiki/ncs cyan; the LABEL identifies the courier and the colour only
// helps it stand out, so a shared palette costs nothing (#126).
const COURIER_COLORS: Record<string, BadgePalette> = {
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
function courierColor(code: string): BadgePalette {
  return COURIER_COLORS[code] ?? "gray";
}

// ShippingBadge renders a shipment's courier as a Badge in its standard colour (#126).
// This is THE way to show a shipment type — never render the courier code as bare text.
export const description =
  "A shipment's courier as a standard-coloured Badge (JNE=blue, J&T=red, …); no courier renders “—”.";

export function ShippingBadge({ code }: { code: string }) {
  const { couriers } = useShippingCatalogue();

  // A shipment can legitimately have no courier — a restock request need not be shipped. Show the
  // same muted "—" the call sites showed before, never an empty badge.
  if (!code) {
    return <span className="text-fg-muted">—</span>;
  }

  return (
    <Badge colorPalette={courierColor(code)} data-testid={`shipping-badge-${code}`}>
      {courierName(couriers, code)}
    </Badge>
  );
}
