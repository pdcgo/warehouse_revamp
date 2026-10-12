import { Box, Card, Flex, Separator, SimpleGrid, Stack, Stat, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";

import type { RestockRequest } from "../../../gen/warehouse/inventory/v1/restock_request_pb";
import { ShippingBadge } from "../../../components/badges/ShippingBadge";
import { TeamItem } from "../../../components/entity/TeamItem";
import { UserItem } from "../../../components/entity/UserItem";
import { NotImplemented } from "../../../features/pending/NotImplemented";
import { useRestockActors } from "../../../features/restock/queries";
import { committedValue, goodsTotal } from "../../../features/restock/summary";
import { useShipmentChannelsByIds } from "../../../features/shipment/queries";
import { useTeamDetail } from "../../../features/teams/queries";
import { formatRupiah } from "../../../lib/money";
import { RESTOCK_ACCEPT_PENDING } from "../pending";

function formatDate(unix: bigint): string {
  if (unix <= 0n) return "";

  return new Date(Number(unix) * 1000).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// THE RESTOCK BEING COUNTED, read-only, as three cards (owner): WHO sent it · THE PARCEL it came in · WHAT IT IS WORTH.
// Everything here is already on the record; the person at the door reads it and types nothing.
//
// The money card keeps the courier's charge OUT of the total (the-couriers-charge-stays-out-of-total): the total is
// what the selling team paid when it raised the restock, and the charge the warehouse paid at the door is its own debt,
// shown on its own line as owed by the selling team.
export function AcceptSummary({ request, courierCharge }: { request: RestockRequest; courierCharge: bigint }) {
  const { t } = useTranslation();

  const requester = useTeamDetail({ teamId: request.requestingTeamId, enabled: request.requestingTeamId > 0n });
  const actors = useRestockActors([request.createdByUserId]);
  const creator = actors.data?.get(request.createdByUserId.toString());
  const channels = useShipmentChannelsByIds([request.shipmentId]);
  const courier = channels.data?.get(request.shipmentId.toString());

  return (
    // The 7xl cap is HERE and nowhere else (owner): read-only blocks of short values strung across a wide monitor
    // read as nothing; the counting below keeps the full width.
    <SimpleGrid columns={{ base: 1, lg: 3 }} gap="card" maxW="7xl" alignItems="stretch">
      {/* 1 — WHO. The team that raised it and the person who did — "who do I ask about this?" is the first question a
          short count produces. */}
      <Card.Root>
        <Card.Body>
          <Stack gap="card">
            <Stack gap="0.5">
              <Text fontSize="xs" color="fg.muted">
                {t("restock.accept.summary.restock")}
              </Text>
              <Text fontSize="lg" fontWeight="bold" data-testid="accept-restock-id">
                #{request.id.toString()}
              </Text>
            </Stack>

            <Separator />

            <Stack gap="0.5" data-testid="accept-team">
              <Text fontSize="xs" color="fg.muted">
                {t("restock.accept.summary.team")}
              </Text>
              <TeamItem
                team={{
                  teamId: request.requestingTeamId,
                  teamName: requester.data?.name,
                  teamType: requester.data?.type,
                }}
              />
            </Stack>

            <Stack gap="0.5" data-testid="accept-created-by">
              <Text fontSize="xs" color="fg.muted">
                {t("restock.accept.summary.raisedBy")}
              </Text>
              {creator ? (
                <UserItem user={creator} />
              ) : (
                <Text color="fg.muted">
                  {request.createdByUserId === 0n
                    ? "—"
                    : t("restock.table.userRef", { id: request.createdByUserId.toString() })}
                </Text>
              )}
            </Stack>
          </Stack>
        </Card.Body>
      </Card.Root>

      {/* 2 — THE PARCEL. What finds the box (the-receipt-is-the-tracking-number) and what proves what was paid
          (a-restock-has-one-invoice). */}
      <Card.Root>
        <Card.Body>
          <Stack gap="card">
            <Text fontSize="xs" fontWeight="bold" color="fg.muted">
              {t("restock.accept.summary.parcel")}
            </Text>

            <SimpleGrid columns={2} gap="card">
              <SummaryField
                label={t("restock.accept.summary.tracking")}
                value={request.receipt || "—"}
                testId="accept-receipt"
              />
              <Stack gap="0.5">
                <Flex gap="1" align="center">
                  <Text fontSize="xs" color="fg.muted">
                    {t("restock.accept.summary.courier")}
                  </Text>
                  <NotImplemented list={RESTOCK_ACCEPT_PENDING} id="courier" />
                </Flex>
                <Box data-testid="accept-courier-name">
                  <ShippingBadge code={courier?.code ?? ""} />
                </Box>
              </Stack>
              <SummaryField
                label={t("restock.accept.summary.invoice")}
                value={request.invoiceRefId || "—"}
                testId="accept-invoice"
              />
              <SummaryField label={t("restock.accept.summary.raised")} value={formatDate(request.createdAtUnix) || "—"} />
              {request.arrivedAtUnix > 0n && (
                <SummaryField
                  label={t("restock.accept.summary.signedFor")}
                  value={formatDate(request.arrivedAtUnix)}
                  testId="accept-signed-for"
                />
              )}
            </SimpleGrid>

            {request.note && (
              <Stack gap="0.5" borderTopWidth="1px" borderColor="border" pt="card">
                <Text fontSize="xs" color="fg.muted">
                  {t("restock.accept.summary.note")}
                </Text>
                <Text data-testid="accept-note">{request.note}</Text>
              </Stack>
            )}
          </Stack>
        </Card.Body>
      </Card.Root>

      {/* 3 — WHAT IT IS WORTH, as Stats: the figures that say whether the invoice in the courier's hand matches. */}
      <Card.Root>
        <Card.Body>
          <Stack gap="card">
            <Text fontSize="xs" fontWeight="bold" color="fg.muted">
              {t("restock.accept.summary.value")}
            </Text>

            <SimpleGrid columns={2} gap="card">
              <Stat.Root size="sm">
                <Stat.Label>{t("restock.accept.summary.goods")}</Stat.Label>
                <Stat.ValueText data-testid="accept-goods-total">{formatRupiah(goodsTotal(request.items))}</Stat.ValueText>
              </Stat.Root>

              <Stat.Root size="sm">
                <Stat.Label>{t("restock.accept.summary.shipping")}</Stat.Label>
                <Stat.ValueText data-testid="accept-shipping-total">{formatRupiah(request.shipmentCost)}</Stat.ValueText>
              </Stat.Root>
            </SimpleGrid>

            <Stat.Root size="md">
              <Stat.Label>{t("restock.accept.summary.total")}</Stat.Label>
              <Stat.ValueText data-testid="accept-grand-total">{formatRupiah(committedValue(request))}</Stat.ValueText>
              <Stat.HelpText>{t("restock.accept.summary.totalHint")}</Stat.HelpText>
            </Stat.Root>

            <Separator />

            {/* OUTSIDE the total, on purpose — the warehouse paid it, later, from its own money. */}
            <Stat.Root size="sm">
              <Stat.Label>{t("restock.accept.summary.courierOwed")}</Stat.Label>
              <Stat.ValueText data-testid="accept-courier-owed">{formatRupiah(courierCharge)}</Stat.ValueText>
              <Stat.HelpText>{t("restock.accept.summary.courierOwedHint")}</Stat.HelpText>
            </Stat.Root>
          </Stack>
        </Card.Body>
      </Card.Root>
    </SimpleGrid>
  );
}

function SummaryField({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <Stack gap="0.5" minW="0">
      <Text fontSize="xs" color="fg.muted">
        {label}
      </Text>
      <Text data-testid={testId} wordBreak="break-word">
        {value}
      </Text>
    </Stack>
  );
}
