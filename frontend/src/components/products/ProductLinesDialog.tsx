import type { MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { Box, Button, CloseButton, Dialog, Flex, Portal, Stack, Table, Text, useBreakpointValue } from "@chakra-ui/react";
import { formatRupiahNumber } from "../../lib/money";

// One priced line of goods — the shape every document in this system has a list of: a restock's
// items, an order's lines, a return's contents, a batch receipt's rows.
//
// Deliberately NOT a proto message. Each of those is a different generated type with a different
// field set, and typing this dialog to one of them would mean the next caller either converts to a
// foreign message or forks the component. A caller maps its own rows to this once, at the call site.
export interface ProductLine {
  /** Stable key for the row — an id, a SKU, anything unique within the list. */
  id: string;
  productCode: string;
  name: string;
  quantity: bigint;
  /**
   * Rupiah as stored (a `double`), THE LINE TOTAL (not the per-piece price — see #140: people buy in totals). The
   * unit price shown beside it is DERIVED from this and the quantity, and is openly a rounding.
   * Omit on every line, or pass `showPrices={false}`, for an unpriced list.
   */
  totalPrice?: number;
}

// ProductLinesDialog shows a document's full list of goods WITHOUT LEAVING THE LIST (owner).
//
// The problem it solves is specific: a table row can name one product out of eight, and "+7 more" is
// dead text — the reader still has to open a page to answer "is the blue one on this delivery?".
// This answers it in place.
//
// It lists EVERY line, including the one the row already names. A list that started at the second
// product would read as if the first had been left out.
//
// A DIALOG, NOT A POPOVER (owner, on the restock list: *"tooltipsnya produk dibuat jadi modal saja"*,
// the-product-lines-open-in-a-dialog). It was a popover hanging off the "+N more" text — a table to read down, perched
// on a row, cut to whatever room the screen had beside it. A dialog gives the list the middle of the screen; on a phone
// each line is a block (a-phone-reads-each-line-as-a-block), never five columns in a scroll box.
export const description =
  "A “+N more” trigger that opens a Dialog listing a document's full product lines — SKU, name, qty, and optionally unit price / line total with a goods total; on a phone each line is a block. Used by the restock and transfer lists to show a whole delivery without leaving the table; map any row type to ProductLine[] at the call site. Its clicks never reach the row it sits on.";

// A row is usually clickable, and a portalled dialog's clicks still bubble through React to it — so every click here
// stops: opening the summary, reading it, closing it, must not also navigate away from the list it summarises.
const stop = (e: MouseEvent) => e.stopPropagation();

export function ProductLinesDialog({
  lines,
  label,
  showPrices = true,
  testId = "product-lines",
}: {
  lines: ProductLine[];
  /** The trigger's text — usually "SKU +N more". Already localised; this does not translate it. */
  label: string;
  /**
   * Whether the list prices the lines. Turn it OFF for an audience with no business seeing what
   * the goods cost — a warehouse's inbound queue is a counting job, not an invoice.
   */
  showPrices?: boolean;
  testId?: string;
}) {
  const { t } = useTranslation();
  const phone = useBreakpointValue({ base: true, md: false }) ?? false;

  const priced = showPrices && lines.some((l) => l.totalPrice !== undefined);
  const goodsTotal = lines.reduce((sum, l) => sum + (l.totalPrice ?? 0), 0);

  // What one piece cost, derived and openly a rounding: 10.000 over 3 pieces shows 3.333 while the
  // line still totals 10.000. The two columns can look a rupiah apart, and that is the honest
  // picture — the invoice said 10.000, and no per-piece figure divides it exactly.
  function unitPrice(line: ProductLine): number {
    if (line.totalPrice === undefined || line.quantity <= 0n) return 0;

    return line.totalPrice / Number(line.quantity);
  }

  // The GOODS total, and only the goods: freight is charged on the document, not on a line, so adding it to a column
  // of line totals would produce a sum that matches nothing on the invoice. The full bill belongs on the detail page.
  const total = priced && (
    // No rule of its own: the last line's already sits right above it, and a second made a double line (owner: *"modal
    // produk double line"*).
    <Flex justify="space-between" gap="3" fontWeight="bold" pt="1">
      <Text>{t("productLines.total")}</Text>
      <Text whiteSpace="nowrap" data-testid={`${testId}-total`}>
        {formatRupiahNumber(goodsTotal)}
      </Text>
    </Flex>
  );

  return (
    <Dialog.Root size="lg" lazyMount unmountOnExit scrollBehavior="inside">
      <Dialog.Trigger asChild>
        {/* AT THE TEXT'S LEFT EDGE (owner: *"produk more harusnya sama teks rata kiri"*) — in a column a button stretches to
            the cell's width and centres its label, which then floated under the line above it. */}
        <Button
          variant="plain"
          size="xs"
          h="auto"
          px="0"
          alignSelf="flex-start"
          justifyContent="flex-start"
          fontWeight="normal"
          color="fg.muted"
          textDecoration="underline"
          textDecorationStyle="dotted"
          data-testid={`${testId}-more`}
          onClick={stop}
        >
          {label}
        </Button>
      </Dialog.Trigger>

      <Portal>
        <Dialog.Backdrop onClick={stop} />
        <Dialog.Positioner onClick={stop}>
          <Dialog.Content data-testid={`${testId}-dialog`}>
            <Dialog.Header>
              <Dialog.Title>{t("productLines.title")}</Dialog.Title>
            </Dialog.Header>
            <Dialog.CloseTrigger asChild>
              <CloseButton size="sm" />
            </Dialog.CloseTrigger>

            <Dialog.Body pb="6">
              {phone ? (
                // A PHONE READS EACH LINE AS A BLOCK — the name at full width, then the SKU and the arithmetic.
                <Stack gap="3" data-testid={testId}>
                  {lines.map((line) => (
                    <Stack key={line.id} gap="0.5" pb="3" borderBottomWidth="1px" borderColor="border">
                      <Text fontWeight="bold">{line.name}</Text>
                      <Flex justify="space-between" gap="3" fontSize="sm">
                        <Text color="fg.muted" minW="0" truncate>
                          {line.productCode} · {line.quantity.toString()}
                          {priced && ` × ${formatRupiahNumber(unitPrice(line))}`}
                        </Text>
                        {priced && <Text whiteSpace="nowrap">{formatRupiahNumber(line.totalPrice ?? 0)}</Text>}
                      </Flex>
                    </Stack>
                  ))}
                  {total}
                </Stack>
              ) : (
                <Stack gap="card" minW="0">
                  <Box overflowX="auto" maxW="full">
                    <Table.Root size="sm" data-testid={testId}>
                      <Table.Header>
                        <Table.Row>
                          <Table.ColumnHeader whiteSpace="nowrap">{t("productLines.sku")}</Table.ColumnHeader>
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
                          // A row lights up under the pointer, every cell (a-table-row-lights-up).
                          <Table.Row key={line.id} css={{ _hover: { "& > td": { bg: "bg.muted" } } }}>
                            <Table.Cell whiteSpace="nowrap">{line.productCode}</Table.Cell>
                            {/* The one column allowed to be long, so it is the one that wraps. */}
                            <Table.Cell minW="40">{line.name}</Table.Cell>
                            <Table.Cell textAlign="end">{line.quantity.toString()}</Table.Cell>
                            {priced && (
                              <Table.Cell textAlign="end" whiteSpace="nowrap">
                                {formatRupiahNumber(unitPrice(line))}
                              </Table.Cell>
                            )}
                            {priced && (
                              <Table.Cell textAlign="end" whiteSpace="nowrap">
                                {formatRupiahNumber(line.totalPrice ?? 0)}
                              </Table.Cell>
                            )}
                          </Table.Row>
                        ))}
                      </Table.Body>
                    </Table.Root>
                  </Box>
                  {total}
                </Stack>
              )}
            </Dialog.Body>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
