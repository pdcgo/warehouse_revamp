import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Card, HStack, Stack, Table, Text } from "@chakra-ui/react";

import type { RestockRequest, RestockRequestItem } from "../../../gen/warehouse/inventory/v1/restock_request_pb";
import { RestockProblemType, RestockRequestStatus } from "../../../gen/warehouse/inventory/v1/restock_request_pb";
import { lineTotal, unitPrice } from "../../../features/restock/lines";
import {
  askedQuantity,
  brokenQuantity,
  goodQuantity,
  missingQuantity,
  problemNotes,
  problemValue,
} from "../../../features/restock/summary";
import { LineSupplier, useLineSuppliers } from "../../../features/restock/LineSupplier";
import { useProductsByIds } from "../../../features/products/queries";
import { NotImplemented } from "../../../features/pending/NotImplemented";
import { ProductListItem } from "../../../components/products/ProductListItem";
import { formatRupiah } from "../../../lib/money";
import { RESTOCK_SELLING_DETAIL_PENDING as PENDING } from "../pending";

export interface ProductsPanelProps {
  request: RestockRequest;
  /** The READING team — whose catalogue the covers are looked up in. */
  teamId: bigint | undefined;
}

// PRODUCTS — WHAT WAS ORDERED, WHERE IT WAS BOUGHT, AND WHAT THE BOX HELD.
//
// Per line: the product and the selling team's note on it (three-notes-one-writer-each), the supplier and store it
// was bought from — a deleted one still named, badged (a-deleted-supplier-still-shows-with-a-badge) — then the count:
//
//   ordered  — the line's count
//   received — what was in the box, broken units included (any-warehouse-member-counts-what-arrived)
//   good     — received − broken: what became stock
//   broken   — typed at the door, with the warehouse's note
//   missing  — ordered − received, worked out, never typed (a-short-unit-at-the-door-is-missing)
//
// Broken and missing each carry what the units were WORTH — filled by the system from the line, never typed
// (the-problem-price-is-filled-by-the-system) — because that is the figure this team claims from the supplier.
//
// No PLACE column: which shelf inside the warehouse a line went to is not a fact a buyer acts on, and the warehouse's
// placements are not readable from this team (RackList is scoped to the warehouse).
//
// Before the warehouse counts, the count columns read "—" — NOT COUNTED YET — never the 0 the fields hold, which would
// say "nothing arrived" about a box nobody has opened.
export function ProductsPanel({ request, teamId }: ProductsPanelProps) {
  const { t } = useTranslation();

  const counted = request.status === RestockRequestStatus.ACCEPTED;
  const items = request.items;

  const covers = useProductsByIds({
    teamId,
    productIds: useMemo(() => items.map((item) => item.productId), [items]),
  });
  const { suppliers, channels } = useLineSuppliers(teamId, items);

  const good = items.reduce((sum, item) => sum + goodQuantity(item), 0n);

  return (
    <Card.Root maxW="full" overflow="hidden" data-testid="restock-detail-products">
      <Card.Body>
        <Stack gap="card">
          <Text fontSize="sm" fontWeight="medium" color="fg.muted">
            {t("restock.detail.products")}
          </Text>

          {/* The table scrolls, not the page — see the three layers in index.tsx (minW="0" on the panel, maxW on the
              card, this scroll area). */}
          <Table.ScrollArea>
            <Table.Root size="sm" data-testid="restock-detail-items">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>
                    <HStack gap="1.5">
                      {t("restock.detail.product")}
                      <NotImplemented list={PENDING} id="lineNote" />
                    </HStack>
                  </Table.ColumnHeader>
                  <Table.ColumnHeader>
                    <HStack gap="1.5">
                      {t("restock.detail.supplier")}
                      <NotImplemented list={PENDING} id="lineSupplier" />
                    </HStack>
                  </Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">{t("restock.detail.ordered")}</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">{t("restock.detail.received")}</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">{t("restock.detail.good")}</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end" data-testid="restock-detail-col-broken">
                    <HStack gap="1.5" justify="end">
                      {t("restock.problem.broken")}
                      <NotImplemented list={PENDING} id="problemNotes" />
                    </HStack>
                  </Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end" data-testid="restock-detail-col-missing">
                    <HStack gap="1.5" justify="end">
                      {t("restock.problem.missing")}
                      <NotImplemented list={PENDING} id="problemNotes" />
                    </HStack>
                  </Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">{t("restock.detail.unitPrice")}</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">{t("restock.detail.lineTotal")}</Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {items.map((item) => {
                  const cover = covers.data?.get(item.productId.toString());

                  return (
                    <Table.Row key={item.id.toString()} data-testid={`restock-detail-item-${item.productId}`}>
                      <Table.Cell minW="64">
                        <Stack gap="1">
                          <ProductListItem
                            product={{
                              id: item.productId,
                              sku: item.sku,
                              name: item.name,
                              defaultImageUrl: cover?.defaultImageUrl,
                              defaultImageThumbnailUrl: cover?.defaultImageThumbnailUrl,
                            }}
                          />
                          {item.note && (
                            <Text
                              fontSize="xs"
                              color="fg.muted"
                              lineClamp={2}
                              title={item.note}
                              data-testid={`restock-detail-line-note-${item.productId}`}
                            >
                              {t("restock.detail.lineNote", { note: item.note })}
                            </Text>
                          )}
                        </Stack>
                      </Table.Cell>
                      <Table.Cell minW="48">
                        <LineSupplier
                          supplierId={item.supplierId}
                          supplierChannelId={item.supplierChannelId}
                          suppliers={suppliers}
                          channels={channels}
                          testId={`restock-detail-supplier-${item.productId}`}
                        />
                      </Table.Cell>
                      <Table.Cell textAlign="end">{item.count.toString()}</Table.Cell>
                      <CountCell
                        counted={counted}
                        value={item.receivedCount}
                        bold={counted && item.receivedCount !== item.count}
                        testId={`restock-detail-received-${item.productId}`}
                      />
                      <CountCell
                        counted={counted}
                        value={goodQuantity(item)}
                        testId={`restock-detail-good-${item.productId}`}
                      />
                      <ProblemCell item={item} type={RestockProblemType.BROKEN} testId={`restock-detail-broken-${item.productId}`} />
                      <ProblemCell item={item} type={RestockProblemType.MISSING} testId={`restock-detail-missing-${item.productId}`} />
                      <Table.Cell textAlign="end">{formatRupiah(unitPrice(item))}</Table.Cell>
                      <Table.Cell textAlign="end">{formatRupiah(lineTotal(item))}</Table.Cell>
                    </Table.Row>
                  );
                })}
              </Table.Body>
            </Table.Root>
          </Table.ScrollArea>

          {counted && (
            <Text fontSize="sm" color="fg.muted" textAlign="end">
              {t("restock.detail.goodOfOrdered")}:{" "}
              <Text as="span" fontWeight="medium" color="fg" data-testid="restock-detail-good-total">
                {good.toString()} / {askedQuantity(items).toString()}
              </Text>
            </Text>
          )}
        </Stack>
      </Card.Body>
    </Card.Root>
  );
}

function CountCell({ counted, value, bold, testId }: { counted: boolean; value: bigint; bold?: boolean; testId: string }) {
  return (
    <Table.Cell textAlign="end" color={counted ? undefined : "fg.muted"} data-testid={testId}>
      {counted ? (
        <Text as="span" fontWeight={bold ? "semibold" : "normal"}>
          {value.toString()}
        </Text>
      ) : (
        "—"
      )}
    </Table.Cell>
  );
}

// ONE PROBLEM FIGURE: how many, what they were worth (system-filled), and the warehouse's note on them. A zero is an em
// dash — on a line where nothing went wrong a row of zeroes draws the eye to what did NOT happen.
function ProblemCell({ item, type, testId }: { item: RestockRequestItem; type: RestockProblemType; testId: string }) {
  const { t } = useTranslation();
  const count = type === RestockProblemType.BROKEN ? brokenQuantity(item) : missingQuantity(item);

  if (count === 0n) {
    return (
      <Table.Cell textAlign="end" color="fg.muted" data-testid={testId}>
        —
      </Table.Cell>
    );
  }

  const note = problemNotes(item, type);

  return (
    <Table.Cell textAlign="end" data-testid={testId}>
      <Stack gap="0" align="end">
        <Text as="span" fontWeight="semibold" color="error.fg" data-testid={`${testId}-count`}>
          {count.toString()}
        </Text>
        <Text fontSize="xs" color="fg.muted" data-testid={`${testId}-value`}>
          {t("restock.detail.problemWorth", { amount: formatRupiah(problemValue(item, type)) })}
        </Text>
        {note && (
          <Text fontSize="xs" color="fg.muted" lineClamp={2} title={note} data-testid={`${testId}-note`}>
            {note}
          </Text>
        )}
      </Stack>
    </Table.Cell>
  );
}
