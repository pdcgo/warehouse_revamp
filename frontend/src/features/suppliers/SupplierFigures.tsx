import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Badge, HStack, Icon, Stack, Table, Text, VisuallyHidden } from "@chakra-ui/react";
import { PackageCheck, ShoppingCart } from "lucide-react";

import { formatUnixDate } from "../../lib/datetime";
import { NotImplemented } from "../pending/NotImplemented";
import { SUPPLIER_LIST_PENDING } from "./listPending";
import { type SampleSupplierFigures, units } from "./sampleSupplierFigures";

export const description =
  "Two figures — every unit sold with the last order under it, and every unit ready with the last restock under it — for a supplier, one of its stores or one of its products: as a table's two columns, as two lines in a phone block, or as one row of small pale badges on a card — an icon and the units, no dates; Terjual indigo, Siap green. Sample figures, each carrying the ⚠ mark its page hands in; nothing to count (a supplier with no store) is a dash in a table and on a card, and no lines in a block.";

// THE FIGURES (`the-supplier-list-shows-sales-and-ready-stock`, `sales-are-all-time-with-their-last-dates`), drawn the
// same on the supplier list, on Discover (`discover-shows-the-same-figures-and-filters`) and on the supplier's page, for
// a store and a product (`the-detail-tabs-show-sold-and-ready`):
//
//   table                                        a phone block                         a Discover card
//   Terjual ⚠1           Siap ⚠2                 Terjual 4.135 · pesanan 3 Okt 2026 ⚠1   [🛒 4.135] ⚠1  [✓ 155] ⚠2
//        4.135               155                 Siap 155 · restok 30 Sep 2026      ⚠2
//   pesanan 3 Okt 2026  restok 30 Sep 2026
//
// The units right-aligned, and under them, muted, the last time it moved — one fact read twice, so one cell
// (one-context-per-column-and-never-three-lines). A row that already says when it was restocked (a product's
// *Terakhir dibeli*) has no restock date under Siap.
//
// THE MARKS ARE THE PAGE'S — a badge's number is its position in the PAGE's pending list, so each page hands its own in.

/** Each figure's ⚠ mark, as the page numbers it. */
export interface FigureMarks {
  sold: ReactNode;
  ready: ReactNode;
}

/** The marks on the supplier list and on Discover, which share one pending list. */
export const LIST_FIGURE_MARKS: FigureMarks = {
  sold: <NotImplemented list={SUPPLIER_LIST_PENDING} id="sold" />,
  ready: <NotImplemented list={SUPPLIER_LIST_PENDING} id="ready" />,
};

/** The two column headings, each carrying its ⚠ number. */
export function SupplierFigureHeaders({ marks }: { marks: FigureMarks }) {
  const { t } = useTranslation();

  return (
    <>
      {(["sold", "ready"] as const).map((kind) => (
        <Table.ColumnHeader key={kind} textAlign="end">
          <HStack gap="1" justify="end">
            {t(`suppliers.table.${kind}`)}
            {marks[kind]}
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
export function SupplierFigureCells({
  figures,
  id,
  testIdPrefix,
}: {
  figures: SampleSupplierFigures | null;
  id: bigint | string;
  testIdPrefix: string;
}) {
  const { t } = useTranslation();

  return (
    <>
      <FigureCell
        value={figures?.sold}
        last={figures ? t("suppliers.lastOrder", { date: formatUnixDate(figures.lastOrderAt) }) : undefined}
        testId={`${testIdPrefix}-sold-${id}`}
      />
      <FigureCell
        value={figures?.ready}
        last={
          figures?.lastRestockAt !== undefined
            ? t("suppliers.lastRestock", { date: formatUnixDate(figures.lastRestockAt) })
            : undefined
        }
        testId={`${testIdPrefix}-ready-${id}`}
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
export function SupplierFigureIcons({
  figures,
  marks,
  testId,
}: {
  figures: SampleSupplierFigures | null;
  marks: FigureMarks;
  testId: string;
}) {
  const { t } = useTranslation();

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
      {value !== undefined && marks[kind]}
    </HStack>
  );

  return (
    <HStack gap="3" data-testid={testId}>
      {figure("sold", ShoppingCart, "primary", figures?.sold)}
      {figure("ready", PackageCheck, "success", figures?.ready)}
    </HStack>
  );
}

/** A line each, with its mark — nothing when there is nothing to count. */
export function SupplierFigureLines({
  figures,
  marks,
  testId,
}: {
  figures: SampleSupplierFigures | null;
  marks: FigureMarks;
  testId: string;
}) {
  const { t } = useTranslation();

  if (!figures) return null;

  return (
    <Stack gap="0.5" fontSize="sm" color="fg.muted" data-testid={testId}>
      <HStack gap="1.5" wrap="wrap">
        <Text>
          {t("suppliers.table.sold")} {units(figures.sold)} ·{" "}
          {t("suppliers.lastOrder", { date: formatUnixDate(figures.lastOrderAt) })}
        </Text>
        {marks.sold}
      </HStack>
      <HStack gap="1.5" wrap="wrap">
        <Text>
          {t("suppliers.table.ready")} {units(figures.ready)}
          {figures.lastRestockAt !== undefined &&
            ` · ${t("suppliers.lastRestock", { date: formatUnixDate(figures.lastRestockAt) })}`}
        </Text>
        {marks.ready}
      </HStack>
    </Stack>
  );
}
