import { useTranslation } from "react-i18next";
import { Card, HStack, Span, Stack, Table, Text } from "@chakra-ui/react";

import type { RestockRequest, RestockRequestItem } from "../../../gen/warehouse/inventory/v1/restock_request_pb";
import { RestockProblemType, RestockRequestStatus } from "../../../gen/warehouse/inventory/v1/restock_request_pb";
import { useRackCodes } from "../../../features/racks/queries";
import { lineTotal, placementLabel, unitPrice } from "../../../features/restock/lines";
import {
  askedQuantity,
  brokenQuantity,
  goodQuantity,
  missingQuantity,
  problemNotes,
  problemValue,
} from "../../../features/restock/summary";
import { LineSupplier, useLineSuppliers } from "../../../features/restock/LineSupplier";
import { NotImplemented } from "../../../features/pending/NotImplemented";
import { formatRupiah } from "../../../lib/money";
import { RESTOCK_WAREHOUSE_DETAIL_PENDING as PENDING } from "../pending";

// THE LINES, AS THE WAREHOUSE COUNTED THEM — what was ordered, where it was bought, what the box held, and WHERE the good
// units went.
//
// The same count columns as the selling team's Products tab — ordered · received · good · broken · missing — because
// this is the side that WROTE them at the door, and the two must read the same record the same way. Broken and missing
// carry this warehouse's note and the value the system filled (the-problem-price-is-filled-by-the-system); missing is
// worked out, never typed (a-short-unit-at-the-door-is-missing).
//
// PLACEMENT is this page's own column: counting and shelving are one act, and every good unit is on a placement
// (there-is-no-unplaced-pile) — shown by its CODE, which is what is painted on the aisle. It appears once accepted;
// before then nothing has been put anywhere, and an em dash would invite the crew to wonder which shelf they forgot.
export function LinesCard({ request, teamId }: { request: RestockRequest; teamId: bigint }) {
  const { t } = useTranslation();

  const counted = request.status === RestockRequestStatus.ACCEPTED;
  const items = request.items;

  const rackCodes = useRackCodes({ warehouseId: request.warehouseId, enabled: counted });
  const codes = rackCodes.data ?? {};
  const { suppliers, channels } = useLineSuppliers(teamId, items);

  const good = items.reduce((sum, item) => sum + goodQuantity(item), 0n);

  return (
    <Card.Root maxW="full" overflow="hidden" data-testid="restock-detail-products">
      <Card.Body>
        <Stack gap="card">
          <Text fontSize="sm" fontWeight="medium" color="fg.muted">
            {t("restock.detail.products")}
          </Text>

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
                  {counted && <Table.ColumnHeader>{t("restock.detail.placement")}</Table.ColumnHeader>}
                  <Table.ColumnHeader textAlign="end">{t("restock.detail.unitPrice")}</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">{t("restock.detail.lineTotal")}</Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {items.map((item) => (
                  <Table.Row key={item.id.toString()} data-testid={`restock-detail-item-${item.productId}`}>
                    {/* sku and name come from the LINE — the snapshot of what was ordered. No picture: the product
                        lives in the selling team's catalogue. */}
                    <Table.Cell minW="56">
                      <Stack gap="0.5">
                        <Span fontWeight="medium" lineClamp={2}>
                          {item.name}
                        </Span>
                        <Span fontSize="xs" color="fg.muted">
                          {item.sku}
                        </Span>
                        {item.note && (
                          <Span
                            fontSize="xs"
                            color="fg.muted"
                            lineClamp={2}
                            title={item.note}
                            data-testid={`restock-detail-line-note-${item.productId}`}
                          >
                            {t("restock.detail.lineNote", { note: item.note })}
                          </Span>
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
                    <CountCell counted={counted} value={goodQuantity(item)} testId={`restock-detail-good-${item.productId}`} />
                    <ProblemCell item={item} type={RestockProblemType.BROKEN} testId={`restock-detail-broken-${item.productId}`} />
                    <ProblemCell item={item} type={RestockProblemType.MISSING} testId={`restock-detail-missing-${item.productId}`} />
                    {counted && (
                      <Table.Cell data-testid={`restock-detail-placement-${item.productId}`}>
                        {placementLabel(t, item, codes) || "—"}
                      </Table.Cell>
                    )}
                    <Table.Cell textAlign="end">{formatRupiah(unitPrice(item))}</Table.Cell>
                    <Table.Cell textAlign="end">{formatRupiah(lineTotal(item))}</Table.Cell>
                  </Table.Row>
                ))}
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

// How many, what they were worth (system-filled), and this warehouse's note. A zero is an em dash.
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
