import { useTranslation } from "react-i18next";
import { Badge, HStack, Icon, Stack, Table, Text, VisuallyHidden } from "@chakra-ui/react";
import { PackageCheck, ShoppingCart } from "lucide-react";

import { formatUnixDate } from "../../lib/datetime";
import { NotImplemented } from "../pending/NotImplemented";
import { SUPPLIER_LIST_PENDING } from "./listPending";
import { type FiguredSupplier, sampleFiguresFor, units } from "./sampleSupplierFigures";

export const description =
  "A supplier's two figures — every unit sold with the last order under it, and every unit ready with the last restock under it — as a table's two columns, as two lines in a phone block, or as one row of small pale badges on a card — an icon and the units, no dates; Terjual indigo, Siap green. Sample figures, each carrying its ⚠ mark; a supplier with no store has nothing to count, so a dash in a table and on a card, and no lines in a block.";

// A SUPPLIER'S FIGURES (`the-supplier-list-shows-sales-and-ready-stock`, `sales-are-all-time-with-their-last-dates`),
// drawn the same on the supplier list and on Discover (`discover-shows-the-same-figures-and-filters`):
//
//   table                                        a phone block                         a Discover card
//   Terjual ⚠1           Siap ⚠2                 Terjual 4.135 · pesanan 3 Okt 2026 ⚠1   [🛒 4.135] ⚠1  [✓ 155] ⚠2
//        4.135               155                 Siap 155 · restok 30 Sep 2026      ⚠2
//   pesanan 3 Okt 2026  restok 30 Sep 2026
//
// The units right-aligned, and under them, muted, the last time it moved — one fact read twice, so one cell
// (one-context-per-column-and-never-three-lines).

/** The two column headings, each carrying its ⚠ number. */
export function SupplierFigureHeaders() {
  const { t } = useTranslation();

  return (
    <>
      {(["sold", "ready"] as const).map((kind) => (
        <Table.ColumnHeader key={kind} textAlign="end">
          <HStack gap="1" justify="end">
            {t(`suppliers.table.${kind}`)}
            <NotImplemented list={SUPPLIER_LIST_PENDING} id={kind} />
          </HStack>
        </Table.ColumnHeader>
      ))}
    </>
  );
}

function FigureCell({ value, last, testId }: { value: number | undefined; last: string | undefined; testId: string }) {
  if (value === undefined) {
    return (
      <Table.Cell textAlign="end" data-testid={testId}>
        <Text color="fg.muted">—</Text>
      </Table.Cell>
    );
  }

  return (
    <Table.Cell textAlign="end" data-testid={testId}>
      <Text>{units(value)}</Text>
      {last && (
        <Text fontSize="xs" color="fg.muted" whiteSpace="nowrap">
          {last}
        </Text>
      )}
    </Table.Cell>
  );
}

/** The two cells of a row — `${testIdPrefix}-sold-${id}` and `${testIdPrefix}-ready-${id}`. */
export function SupplierFigureCells({ supplier, testIdPrefix }: { supplier: FiguredSupplier; testIdPrefix: string }) {
  const { t } = useTranslation();
  const figures = sampleFiguresFor(supplier);

  return (
    <>
      <FigureCell
        value={figures?.sold}
        last={figures ? t("suppliers.lastOrder", { date: formatUnixDate(figures.lastOrderAt) }) : undefined}
        testId={`${testIdPrefix}-sold-${supplier.id}`}
      />
      <FigureCell
        value={figures?.ready}
        last={figures ? t("suppliers.lastRestock", { date: formatUnixDate(figures.lastRestockAt) }) : undefined}
        testId={`${testIdPrefix}-ready-${supplier.id}`}
      />
    </>
  );
}

// THE FIGURES AS ICONS, ONE ROW (owner, on Discover's card: *"di card tidak ada ordered dan restocked date, terjual dan
// ready icon saja jadi 1 baris"*, `a-card-reads-its-figures-as-icons`) — a cart for every unit sold, a checked package for
// every unit ready (not the plain package, which is a product without a picture); no dates. The word is still there for
// a screen reader, and on hover.
//
// EACH A SMALL PALE BADGE (owner: *"terlalu besar, sama kasih sedikit highlight"*, `a-card-figure-is-a-pale-badge`) — the
// store badges' size, so the row is no taller than theirs; the units bold, in the text colour, the tint at half and the
// tone on the icon (`a-card-figure-is-toned-down`). Siap in `success`, the tone the app already
// gives ready stock (ProductListItem's badge); Terjual in `primary`, a tone with no status meaning. A store-less supplier
// reads a grey dash for each, unmarked, so every card has the row.
export function SupplierFigureIcons({ supplier, testId }: { supplier: FiguredSupplier; testId: string }) {
  const { t } = useTranslation();
  const figures = sampleFiguresFor(supplier);

  const figure = (kind: "sold" | "ready", icon: typeof ShoppingCart, tone: string, value: number | undefined) => (
    <HStack gap="1" data-testid={`${testId}-${kind}`}>
      {/* Toned down (owner: *"sedikit kurangi warnanya"*): the tint at half, the units in the text colour — the tone
          stays on the icon, which is what tells the two apart. */}
      {/* No size of its own — the theme's default, which is what the store badges above it use (12px text, 20px tall). */}
      <Badge
        variant="subtle"
        colorPalette={value === undefined ? "gray" : tone}
        bg="colorPalette.subtle/50"
        color="fg"
        gap="1"
        title={t(`suppliers.table.${kind}`)}
      >
        <Icon as={icon} boxSize="3" color="colorPalette.fg" aria-hidden="true" />
        <VisuallyHidden>{t(`suppliers.table.${kind}`)}</VisuallyHidden>
        <Text as="span" fontWeight="bold">
          {value === undefined ? "—" : units(value)}
        </Text>
      </Badge>
      {value !== undefined && <NotImplemented list={SUPPLIER_LIST_PENDING} id={kind} />}
    </HStack>
  );

  return (
    <HStack gap="3" data-testid={testId}>
      {figure("sold", ShoppingCart, "primary", figures?.sold)}
      {figure("ready", PackageCheck, "success", figures?.ready)}
    </HStack>
  );
}

/** A line each, with its mark — nothing for a supplier with no store. */
export function SupplierFigureLines({ supplier, testId }: { supplier: FiguredSupplier; testId: string }) {
  const { t } = useTranslation();
  const figures = sampleFiguresFor(supplier);

  if (!figures) return null;

  return (
    <Stack gap="0.5" fontSize="sm" color="fg.muted" data-testid={testId}>
      <HStack gap="1.5" wrap="wrap">
        <Text>
          {t("suppliers.table.sold")} {units(figures.sold)} ·{" "}
          {t("suppliers.lastOrder", { date: formatUnixDate(figures.lastOrderAt) })}
        </Text>
        <NotImplemented list={SUPPLIER_LIST_PENDING} id="sold" />
      </HStack>
      <HStack gap="1.5" wrap="wrap">
        <Text>
          {t("suppliers.table.ready")} {units(figures.ready)} ·{" "}
          {t("suppliers.lastRestock", { date: formatUnixDate(figures.lastRestockAt) })}
        </Text>
        <NotImplemented list={SUPPLIER_LIST_PENDING} id="ready" />
      </HStack>
    </Stack>
  );
}
