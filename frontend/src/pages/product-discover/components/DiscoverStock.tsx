import { useTranslation } from "react-i18next";
import { HStack, Icon, Portal, Stack, Text, Tooltip } from "@chakra-ui/react";
import type { LucideIcon } from "lucide-react";
import { PackageCheck, Truck } from "lucide-react";

import type { OwnerStockRow } from "../../../features/products/adapt";
import { NotImplemented } from "../../../features/pending/NotImplemented";
import { LOW_STOCK_PCS, STOCK_STATUS_TONE, readyStatus } from "../../../features/products/stockAge";
import { DISCOVER_PENDING } from "../pending";
import { sampleStock } from "../../../features/products/discoverSample";

// THE STOCK ON A DISCOVER CARD (owner: *"di cardnya ada stok ready dan stok ongoing, teksnya tooltips saja, kasih icon
// untuk stocknya"*, `a-discover-card-shows-its-stock`) — two figures, each an icon and a count, what they are in a tooltip:
//
//   ✓▢ 79 pcs   🚚 12 pcs       ready to sell · on its way to the warehouse
//   (✓▢ 3 pcs)  🚚 12 pcs       running low — the ready figure HIGHLIGHTED
//
// RUNNING LOW IS HIGHLIGHTED (owner: *"stock menipis ada highlight"*, `a-discover-card-highlights-low-stock`) — the product
// page's rule, shared (`readyStatus`): under LOW_STOCK_PCS ready, a pill in the warning tone; none, in the error tone. Out
// of stock is the card worth noticing, not one to hide. Its tooltip says which, and why.
//
// ⚠ Another team's figures are a SAMPLE (pending.ts `cardStock`): OwnerStockByIds answers only for the caller's own goods.
// The caller's own products show real figures — and a dash where the read said nothing, never a zero it did not claim.
export function DiscoverStock({
  productId,
  own,
  stock,
}: {
  productId: bigint;
  own: boolean;
  /** The owner's figures — only ever for an own product. */
  stock?: OwnerStockRow;
}) {
  const { t } = useTranslation();
  const figures = own
    ? { ready: stock?.readyQty, ongoing: stock?.ongoingQty }
    : sampleStock(productId);
  const status = readyStatus(figures.ready);
  // The highlight's words — "Hampir habis — Stok siap kurang dari 5 pcs …", under the figure's own name.
  const why =
    status === "low" || status === "out"
      ? `${t(`products.detail.highlight.status.${status}`)} — ${t(`products.detail.highlight.why.${status}`, { n: LOW_STOCK_PCS })}`
      : undefined;

  return (
    <HStack gap="3" fontSize="xs" color="fg.muted" data-testid={`discover-stock-${productId}`}>
      <Figure
        icon={PackageCheck}
        qty={figures.ready}
        hint={t("discover.stock.readyHint")}
        why={why}
        label={t("discover.stock.ready")}
        tone={why ? STOCK_STATUS_TONE[status!] : undefined}
        status={status}
        testId={`discover-stock-ready-${productId}`}
      />
      <Figure
        icon={Truck}
        qty={figures.ongoing}
        hint={t("discover.stock.ongoingHint")}
        label={t("discover.stock.ongoing")}
        testId={`discover-stock-ongoing-${productId}`}
      />
      {!own && <NotImplemented list={DISCOVER_PENDING} id="cardStock" />}
    </HStack>
  );
}

function Figure({
  icon,
  qty,
  hint,
  why,
  label,
  tone,
  status,
  testId,
}: {
  icon: LucideIcon;
  qty: bigint | undefined;
  hint: string;
  /** Why it is highlighted — a second line in the tooltip. */
  why?: string;
  /** Its name, for the spoken label ("Siap 79 pcs"). */
  label: string;
  /** The highlight's tone — set only when the figure is running low or out. */
  tone?: string;
  status?: string;
  testId: string;
}) {
  const { t } = useTranslation();
  const text = qty === undefined ? "—" : t("products.stat.pcs", { n: qty.toString() });

  return (
    <Tooltip.Root openDelay={100} closeDelay={80}>
      <Tooltip.Trigger asChild>
        <HStack
          gap="1"
          // THE HIGHLIGHT — a pill in the status's tone, bold, so a low figure is seen before it is read.
          {...(tone
            ? { bg: `${tone}.subtle`, color: `${tone}.fg`, fontWeight: "bold", px: "1.5", py: "0.5", borderRadius: "full" }
            : {})}
          aria-label={why ? `${label} ${text}, ${why}` : `${label} ${text}`}
          data-status={status}
          data-testid={testId}
        >
          <Icon as={icon} boxSize="3.5" />
          <Text as="span">{text}</Text>
        </HStack>
      </Tooltip.Trigger>
      <Portal>
        <Tooltip.Positioner>
          <Tooltip.Content>
            <Stack gap="0.5">
              <Text>{hint}</Text>
              {why && <Text fontWeight="bold">{why}</Text>}
            </Stack>
          </Tooltip.Content>
        </Tooltip.Positioner>
      </Portal>
    </Tooltip.Root>
  );
}
