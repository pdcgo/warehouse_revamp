import type { ReactNode } from "react";
import { Box, Card, Grid, SimpleGrid, Stack, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";

import type { RestockRequest } from "../../../gen/warehouse/inventory/v1/restock_request_pb";
import { ShippingBadge } from "../../../components/badges/ShippingBadge";
import { TeamItem } from "../../../components/entity/TeamItem";
import { UserItem } from "../../../components/entity/UserItem";
import { useRestockActors } from "../../../features/restock/queries";
import { useShipmentChannelsByIds } from "../../../features/shipment/queries";
import { useTeamDetail } from "../../../features/teams/queries";
// In the app's language and Jakarta time, never the browser's (a-date-speaks-the-apps-language,
// a-table-date-is-short-and-every-time-is-wib) — "—" for a date that never happened.
import { formatUnixDate } from "../../../lib/datetime";

// THE RESTOCK BEING COUNTED, read-only, as two cards: WHO sent it · THE PARCEL it came in. Everything here is already on
// the record; the person at the door reads it and types nothing.
//
// NO VALUE CARD (owner: *"nilai tidak perlu, kecuali ongkir yang dibayar gudang"*,
// the-accept-info-is-who-the-parcel-and-the-ongkir-it-paid) — the goods, the shipping and the total are the selling team's
// purchase. The ongkir the warehouse paid is said in the courier's charge section, not here (owner: *"di paket ongkir
// hilangkan"*, the-cod-paid-is-said-in-its-own-section).
export function AcceptSummary({
  request,
  narrow = false,
}: {
  request: RestockRequest;
  /** In the info column beside the lines — the cards one under another. */
  narrow?: boolean;
}) {
  const { t } = useTranslation();

  const requester = useTeamDetail({ teamId: request.requestingTeamId, enabled: request.requestingTeamId > 0n });
  const actors = useRestockActors([request.createdByUserId]);
  const creator = actors.data?.get(request.createdByUserId.toString());
  const channels = useShipmentChannelsByIds([request.shipmentId]);
  const courier = channels.data?.get(request.shipmentId.toString());

  return (
    // The 7xl cap is HERE and nowhere else (owner): read-only blocks of short values strung across a wide monitor
    // read as nothing; the counting keeps the full width. In the info column the column is the cap.
    <SimpleGrid
      columns={narrow ? 1 : { base: 1, lg: 2 }}
      gap={narrow ? "section" : "card"}
      maxW={narrow ? undefined : "5xl"}
      alignItems="stretch"
    >
      {/* 1 — WHO, SIMPLY (owner: *"id restok, tim dan usernya simpel saja, gambarnya kecil"*): one line each — the
          restock's number, the team that raised it, the person who did — small avatars, names alone. "Who do I ask about
          this?" is the first question a short count produces. */}
      <Card.Root>
        <Card.Body>
          <Grid templateColumns="auto minmax(0, 1fr)" columnGap="card" rowGap="2" alignItems="center">
            <FactLabel>{t("restock.accept.summary.restock")}</FactLabel>
            <Text fontSize="sm" fontWeight="bold" data-testid="accept-restock-id">
              #{request.id.toString()}
            </Text>

            <FactLabel>{t("restock.accept.summary.team")}</FactLabel>
            <Box minW="0" data-testid="accept-team">
              <TeamItem
                size="xs"
                team={{ teamId: request.requestingTeamId, teamName: requester.data?.name, teamType: requester.data?.type }}
              />
            </Box>

            <FactLabel>{t("restock.accept.summary.raisedBy")}</FactLabel>
            <Box minW="0" data-testid="accept-created-by">
              {creator ? (
                <UserItem size="xs" user={creator} />
              ) : (
                <Text fontSize="sm" color="fg.muted">
                  {request.createdByUserId === 0n
                    ? "—"
                    : t("restock.table.userRef", { id: request.createdByUserId.toString() })}
                </Text>
              )}
            </Box>
          </Grid>
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
              <SummaryField
                label={t("restock.accept.summary.courier")}
                value={<ShippingBadge code={courier?.code ?? ""} />}
                testId="accept-courier-name"
              />
              <SummaryField
                // The store's reference, by the word the selling pages use (the-store-reference-is-the-order-id) — kept on
                // Terima (terima-keeps-the-order-id).
                label={t("restock.accept.summary.orderId")}
                value={request.invoiceRefId || "—"}
                testId="accept-invoice"
              />
              <SummaryField label={t("restock.accept.summary.raised")} value={formatUnixDate(request.createdAtUnix)} />
              {request.arrivedAtUnix > 0n && (
                <SummaryField
                  label={t("restock.accept.summary.signedFor")}
                  value={formatUnixDate(request.arrivedAtUnix)}
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
    </SimpleGrid>
  );
}

function FactLabel({ children }: { children: ReactNode }) {
  return (
    <Text fontSize="xs" color="fg.muted">
      {children}
    </Text>
  );
}

function SummaryField({ label, value, testId }: { label: string; value: ReactNode; testId?: string }) {
  return (
    <Stack gap="0.5" minW="0">
      <Text fontSize="xs" color="fg.muted">
        {label}
      </Text>
      <Box data-testid={testId} wordBreak="break-word">
        {value}
      </Box>
    </Stack>
  );
}
