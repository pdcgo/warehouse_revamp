import { useTranslation } from "react-i18next";
import { Box, Button, Popover, Portal, Stack, Table, Text } from "@chakra-ui/react";
import { formatRupiah } from "../lib/money";

// One priced line of goods — the shape every document in this system has a list of: a restock's
// items, an order's lines, a return's contents, a batch receipt's rows.
//
// Deliberately NOT a proto message. Each of those is a different generated type with a different
// field set, and typing this popover to one of them would mean the next caller either converts to a
// foreign message or forks the component. A caller maps its own rows to this once, at the call site.
export interface ProductLine {
  /** Stable key for the row — an id, a SKU, anything unique within the list. */
  id: string;
  sku: string;
  name: string;
  quantity: bigint;
  /**
   * Whole rupiah, THE LINE TOTAL (not the per-piece price — see #140: people buy in totals). The
   * unit price shown beside it is DERIVED from this and the quantity, and is openly a rounding.
   * Omit on every line, or pass `showPrices={false}`, for an unpriced list.
   */
  totalPrice?: bigint;
}

// ProductLinesPopover shows a document's full list of goods WITHOUT LEAVING THE LIST (owner).
//
// The problem it solves is specific: a table row can name one product out of eight, and "+7 more" is
// dead text — the reader still has to open a page to answer "is the blue one on this delivery?".
// This answers it in place.
//
// It lists EVERY line, including the one the row already names. A popover that started at the second
// product would read as if the first had been left out.
//
// A Popover rather than a Tooltip because the content is TABULAR: a person needs to read down it,
// and on touch a tooltip has no hover to open it with.
export const description =
  "A “+N more” trigger that opens a Popover listing a document's full product lines — SKU, name, qty, and optionally unit price / line total with a goods total. Used by the restock lists to show a whole delivery without leaving the table; map any row type to ProductLine[] at the call site.";

export function ProductLinesPopover({
  lines,
  label,
  showPrices = true,
  testId = "product-lines",
}: {
  lines: ProductLine[];
  /** The trigger's text — usually "SKU +N more". Already localised; this does not translate it. */
  label: string;
  /**
   * Whether the table prices the lines. Turn it OFF for an audience with no business seeing what
   * the goods cost — a warehouse's inbound queue is a counting job, not an invoice.
   */
  showPrices?: boolean;
  testId?: string;
}) {
  const { t } = useTranslation();

  const priced = showPrices && lines.some((l) => l.totalPrice !== undefined);
  const goodsTotal = lines.reduce((sum, l) => sum + (l.totalPrice ?? 0n), 0n);

  // What one piece cost, derived and openly a rounding: 10.000 over 3 pieces shows 3.333 while the
  // line still totals 10.000. The two columns can look a rupiah apart, and that is the honest
  // picture — the invoice said 10.000, and no per-piece figure divides it exactly.
  function unitPrice(line: ProductLine): bigint {
    if (line.totalPrice === undefined || line.quantity <= 0n) return 0n;

    return line.totalPrice / line.quantity;
  }

  return (
    <Popover.Root positioning={{ placement: "bottom-start" }} lazyMount unmountOnExit>
      <Popover.Trigger asChild>
        {/* A row is usually clickable, so the trigger stops the click here — opening the summary
            must not also navigate away from the list it is summarising. */}
        <Button
          variant="plain"
          size="xs"
          h="auto"
          px="0"
          fontWeight="normal"
          color="fg.muted"
          textDecoration="underline"
          textDecorationStyle="dotted"
          data-testid={`${testId}-more`}
          onClick={(e) => e.stopPropagation()}
        >
          {label}
        </Button>
      </Popover.Trigger>

      {/* Portalled: a table cell clips its overflow, so an in-flow popover would be cut off by the
          row it belongs to. */}
      <Portal>
        <Popover.Positioner>
          {/* WIDTH IS THE WHOLE FIGHT HERE. Popover.Content ships a narrow fixed width, and a
              five-column table inside it overlaps its own columns rather than growing the box. So
              the content sizes to its CONTENT (`w="auto"`), is floored wide enough that the headers
              do not wrap, and is capped by how much room the viewport actually has beside the
              trigger (`--available-width`, which the positioner sets) — never by a guess that is
              too wide on a phone.
              The table then scrolls sideways INSIDE that box rather than pushing it wider, so a
              delivery with long product names stays readable instead of running off the screen. */}
          <Popover.Content
            w="auto"
            minW="sm"
            maxW="min(var(--available-width), 42rem)"
            onClick={(e) => e.stopPropagation()}
          >
            <Popover.Arrow />
            <Popover.Body>
              <Stack gap="card" minW="0">
                <Text fontSize="xs" fontWeight="medium" color="fg.muted" textTransform="uppercase">
                  {t("productLines.title")}
                </Text>

                <Box overflowX="auto" maxW="full">
                  <Table.Root size="sm" data-testid={testId}>
                    <Table.Header>
                      <Table.Row>
                        <Table.ColumnHeader whiteSpace="nowrap">
                          {t("productLines.sku")}
                        </Table.ColumnHeader>
                        <Table.ColumnHeader>{t("productLines.name")}</Table.ColumnHeader>
                        <Table.ColumnHeader textAlign="end" whiteSpace="nowrap">
                          {t("productLines.qty")}
                        </Table.ColumnHeader>
                        {priced && (
                          <Table.ColumnHeader textAlign="end" whiteSpace="nowrap">
                            {t("productLines.unitPrice")}
                          </Table.ColumnHeader>
                        )}
                        {priced && (
                          <Table.ColumnHeader textAlign="end" whiteSpace="nowrap">
                            {t("productLines.lineTotal")}
                          </Table.ColumnHeader>
                        )}
                      </Table.Row>
                    </Table.Header>

                    <Table.Body>
                      {lines.map((line) => (
                        <Table.Row key={line.id}>
                          <Table.Cell whiteSpace="nowrap">{line.sku}</Table.Cell>
                          {/* The one column allowed to be long, so it is the one that wraps. */}
                          <Table.Cell minW="40">{line.name}</Table.Cell>
                          <Table.Cell textAlign="end">{line.quantity.toString()}</Table.Cell>
                          {priced && (
                            <Table.Cell textAlign="end" whiteSpace="nowrap">
                              {formatRupiah(unitPrice(line))}
                            </Table.Cell>
                          )}
                          {priced && (
                            <Table.Cell textAlign="end" whiteSpace="nowrap">
                              {formatRupiah(line.totalPrice ?? 0n)}
                            </Table.Cell>
                          )}
                        </Table.Row>
                      ))}
                    </Table.Body>

                    {/* The GOODS total, and only the goods: freight is charged on the document, not
                        on a line, so adding it to a column of line totals would produce a sum that
                        matches nothing on the invoice. The full bill belongs on the detail page. */}
                    {priced && (
                      <Table.Footer>
                        <Table.Row>
                          <Table.Cell colSpan={4} textAlign="end" fontWeight="medium">
                            {t("productLines.total")}
                          </Table.Cell>
                          <Table.Cell
                            textAlign="end"
                            fontWeight="semibold"
                            whiteSpace="nowrap"
                            data-testid={`${testId}-total`}
                          >
                            {formatRupiah(goodsTotal)}
                          </Table.Cell>
                        </Table.Row>
                      </Table.Footer>
                    )}
                  </Table.Root>
                </Box>
              </Stack>
            </Popover.Body>
          </Popover.Content>
        </Popover.Positioner>
      </Portal>
    </Popover.Root>
  );
}
