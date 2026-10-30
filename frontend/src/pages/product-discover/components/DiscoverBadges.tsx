import { useTranslation } from "react-i18next";
import { Badge, Box, HStack, Icon } from "@chakra-ui/react";
import { NotImplemented } from "../../../features/pending/NotImplemented";
import { type LockMode, lockIconOf, lockModeOf, useLockLabel } from "../../../features/products/ProductLock";
import { DIVISION } from "../division";
import { DISCOVER_PENDING } from "../pending";
import { sampleDivision } from "../sampleMock";

// EVERY BADGE ON THE COVER HAS ITS OWN COLOUR (owner: *"warnanya kurang jelas"*) — the first version drew Umum and a
// minimum in the same dark grey, two different facts that read as one.
//
// THE DIVISION — its colour and icon from division.ts (`prioritas-is-primary-riset-is-warning`); solid, WHITE text on all
// three — warning's own contrast text is dark, and the owner wants the three read alike (*"riset teksnya putih juga"*).

// THE LOCK IS RED, BOTH WAYS (owner: *"untuk lock warnanya jangan hitam"*, of a pale amber *"kuning tidak kelihatan"*,
// then *"merah saja"*) — the error tone, solid, since anything pale is lost over a picture. Its icon and its words tell the
// two apart: 🔒 Dikunci, ↘ Min N pcs.
const LOCK_PALETTE: Record<Exclude<LockMode, "open">, string> = {
  always: "error",
  min: "error",
};

// THE BADGES ON A DISCOVER CARD — ON THE COVER, its top-left corner (owner: *"keterangannya kurang terlihat, kasih di atas
// sendiri"*): small grey badges in the foot's row, beside the team's, were read last or not at all. SOLID, so they hold
// against any picture:
//
//   ┌────────────────────────────────┐
//   │ [★ Prioritas] ⚠ [🔒 Dikunci]   │   ← over the cover
//   │             cover              │
//   └────────────────────────────────┘
//
// THE DIVISION (owner: *"di card juga ada badge sesuai tipe prioritas, riset dan umum"*, `a-discover-card-shows-its-
// division-and-lock`) — a SAMPLE until it is stored (pending.ts `divisionBadge`); a product without one carries none.
//
// THE LOCK (owner: *"kasih keterangan ini locked atau tidak, baik yang locked dan yang min, yang min ada keterangan min
// berapa"*) — the product list's icons (ProductLock, `one-lock-three-ways`): **Min N pcs** for a minimum, and for a lock
// just **Dikunci** (owner: *"selalu dikunci jadi dikunci saja"*) — on a card the badge says the state, where the list's
// editor says the option ("Selalu dikunci") beside the other two. Nothing for an open product — the absence says it is
// open. ⚠ The server leaves a locked product out of Discover (pending.ts `locked`).
export function DiscoverBadges({
  product,
}: {
  product: { id: bigint; crossLocked: boolean; reservedStock: number };
}) {
  const { t } = useTranslation();
  const lockLabel = useLockLabel();
  // UMUM CARRIES NO BADGE (owner: *"di card tidak perlu badge untuk yang umum"*) — it is the ordinary case, and a badge on
  // every ordinary card would drown the two that mean something. Its chip stays on the filter.
  const sampled = sampleDivision(product.id);
  const division = sampled === "general" ? undefined : sampled;
  const mode = lockModeOf(product);

  return (
    <>
      {division && (
        <HStack gap="1">
          <Badge
            size="sm"
            variant="solid"
            colorPalette={DIVISION[division].palette}
            color="white"
            data-testid={`discover-division-badge-${product.id}`}
          >
            <Icon as={DIVISION[division].icon} boxSize="3" />
            {t(`discover.division.${division}`)}
          </Badge>
          {/* On the page's ground, so the ⚠ reads over any picture — bare, it was lost against the cover. */}
          <Box bg="bg" borderRadius="l2" lineHeight="0">
            <NotImplemented list={DISCOVER_PENDING} id="divisionBadge" />
          </Box>
        </HStack>
      )}
      {mode !== "open" && (
        <Badge
          size="sm"
          colorPalette={LOCK_PALETTE[mode]}
          variant="solid"
          color="white"
          data-testid={`discover-lock-${product.id}`}
          data-mode={mode}
        >
          <Icon as={lockIconOf(mode)} boxSize="3" />
          {mode === "always" ? t("discover.lock.always") : lockLabel(product)}
        </Badge>
      )}
    </>
  );
}
