import type { ReactNode } from "react";
import { Box, Button, Card, Field, Flex, Grid, Icon, Input, Spacer, Stack, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { ClipboardCheck, MessageSquareText, TriangleAlert } from "lucide-react";

import type { ProductPlace } from "../../../gen/warehouse/inventory/v1/inventory_pb";
import type { RestockRequestItem } from "../../../gen/warehouse/inventory/v1/restock_request_pb";
import type { SupplierChannel } from "../../../gen/warehouse/supplier/v1/supplier_channel_pb";
import { ProductListItem } from "../../../components/products/ProductListItem";
import { QuantityInput } from "../../../components/inputs/QuantityInput";
import { NotImplemented } from "../../../features/pending/NotImplemented";
import { LineSupplier } from "../../../features/restock/LineSupplier";
import type { SupplierRecord } from "../../../features/suppliers/adapt";
import { formatRupiah } from "../../../lib/money";
import type { LineDraft, LineState } from "../draft";
import { RESTOCK_ACCEPT_PENDING } from "../pending";
import { PlacementPanel } from "./PlacementPanel";

// ONE LINE OF THE BOX, in three columns (owner): WHAT IT IS · WHAT ARRIVED · WHERE IT GOES — the three questions asked at
// the door, side by side, so a long delivery is scanned down one column at a time. They stack below `xl`: a count, a
// note and a placement picker cannot share a row narrower than that and stay typeable.
//
// The person types TWO numbers (any-warehouse-member-counts-what-arrived) — what is in the box, and how many of those
// are broken. Good and missing are worked out and shown, never typed; their worth is filled from the line
// (the-problem-price-is-filled-by-the-system). There is no picker for a "kind" of problem: broken is a count, and a
// unit short in the box is missing by arithmetic (a-short-unit-at-the-door-is-missing).
export function LineCard({
  item,
  draft,
  st,
  warehouseId,
  imageUrl,
  thumbnailUrl,
  suppliers,
  channels,
  goodsPrice,
  hpp,
  recommendations,
  update,
}: {
  item: RestockRequestItem;
  draft: LineDraft;
  st: LineState;
  warehouseId: bigint;
  imageUrl?: string;
  thumbnailUrl?: string;
  suppliers: Record<string, SupplierRecord>;
  channels: Record<string, SupplierChannel>;
  goodsPrice: bigint;
  hpp: bigint;
  recommendations: ProductPlace[];
  update: (fn: (d: LineDraft) => LineDraft) => void;
}) {
  const { t } = useTranslation();
  const pid = item.productId;

  return (
    <Card.Root data-testid={`accept-line-${pid}`}>
      <Card.Body>
        <Grid
          templateColumns={{ base: "1fr", xl: "minmax(0, 3fr) minmax(0, 4fr) minmax(0, 4fr)" }}
          gap="card"
          alignItems="stretch"
        >
          {/* 1 — WHAT IT IS. Read-only: nothing in this column is typed. The name and SKU are the line's snapshot — what
              was ordered — and only the picture is looked up. */}
          <Stack gap="card" alignSelf="start" minW="0">
            <ProductListItem
              product={{
                id: pid,
                sku: item.sku,
                name: item.name,
                defaultImageUrl: imageUrl,
                defaultImageThumbnailUrl: thumbnailUrl,
              }}
            />

            {/* Where it was bought — per line, not per restock (a-line-names-the-channel-it-was-bought-from). */}
            <Flex gap="1" align="flex-start" minW="0">
              <LineSupplier
                supplierId={item.supplierId}
                supplierChannelId={item.supplierChannelId}
                suppliers={suppliers}
                channels={channels}
                testId={`accept-supplier-${pid}`}
              />
              <NotImplemented list={RESTOCK_ACCEPT_PENDING} id="lineSupplier" />
            </Flex>

            {/* "ORDERED 12" WITH THE SELLING TEAM'S WORD BESIDE IT. A line that says more than was first ordered was
                edited by the selling team (extra-units-are-added-by-the-selling-teams-edit), and the person counting
                should see why without asking. */}
            <Stack gap="1">
              <Text fontSize="sm" fontWeight="bold" data-testid={`accept-ordered-${pid}`}>
                {t("restock.accept.ordered", { n: item.count.toString() })}
              </Text>
              {item.note !== "" && (
                <Flex gap="1.5" align="flex-start" data-testid={`accept-line-note-${pid}`}>
                  <Icon as={MessageSquareText} boxSize="3.5" color="fg.muted" mt="0.5" flexShrink={0} />
                  <Text fontSize="xs" color="fg.muted" minW="0">
                    <Text as="span" fontWeight="bold">
                      {t("restock.accept.lineNote")}
                    </Text>{" "}
                    {item.note}
                  </Text>
                  <NotImplemented list={RESTOCK_ACCEPT_PENDING} id="lineNote" />
                </Flex>
              )}
            </Stack>

            {/* TWO prices (owner): the line's own per good piece, then the HPP with the shipping and the courier's
                charge folded in. The gap between them is what getting it here cost, and it moves as the charge is
                typed. No price until something is good — "Rp 0" would read as free. */}
            <Stack gap="1" borderTopWidth="1px" borderColor="border" pt="2">
              <PriceRow
                label={t("restock.accept.goodsPrice")}
                value={st.good > 0n ? t("restock.accept.perPiece", { price: formatRupiah(goodsPrice) }) : "—"}
                testId={`accept-goods-${pid}`}
                muted
              />
              <PriceRow
                label={t("restock.accept.hpp")}
                value={st.good > 0n ? t("restock.accept.perPiece", { price: formatRupiah(hpp) }) : "—"}
                testId={`accept-hpp-${pid}`}
              />
            </Stack>
          </Stack>

          {/* 2 — WHAT ARRIVED. Two typed numbers, then what they mean. */}
          <Box borderWidth="1px" borderColor="border" borderRadius="md" p="card" h="full">
            <Stack gap="card">
              <Flex align="center" gap="2">
                <Icon as={ClipboardCheck} boxSize="4" color="brand.fg" />
                <Text fontSize="sm" fontWeight="bold">
                  {t("restock.accept.count")}
                </Text>
              </Flex>

              <Flex gap="card" wrap="wrap" align="flex-start">
                <Field.Root required invalid={st.over > 0n} w="auto">
                  <Field.Label>
                    {t("restock.accept.received")}
                    <Field.RequiredIndicator />
                  </Field.Label>
                  <Flex gap="2" align="center">
                    {/* No `max`: a count above the line must SHOW, with its message — clamping it back would hide the
                        very thing the selling team has to be told. */}
                    <QuantityInput
                      min={0}
                      width="16"
                      value={draft.received}
                      aria-label={t("restock.accept.received")}
                      testId={`accept-received-${pid}`}
                      onChange={(received) => update((d) => ({ ...d, received }))}
                    />
                    <Button
                      size="xs"
                      variant="ghost"
                      data-testid={`accept-all-arrived-${pid}`}
                      onClick={() => update((d) => ({ ...d, received: item.count.toString() }))}
                    >
                      {t("restock.accept.allArrived")}
                    </Button>
                  </Flex>
                  <Field.HelperText>{t("restock.accept.receivedHint")}</Field.HelperText>
                </Field.Root>

                <Field.Root invalid={st.brokenOver} w="auto">
                  <Field.Label>{t("restock.accept.broken")}</Field.Label>
                  <QuantityInput
                    min={0}
                    width="16"
                    value={draft.broken}
                    aria-label={t("restock.accept.broken")}
                    testId={`accept-broken-${pid}`}
                    onChange={(broken) => update((d) => ({ ...d, broken }))}
                  />
                  <Field.HelperText>{t("restock.accept.brokenHint")}</Field.HelperText>
                </Field.Root>
              </Flex>

              {/* accept-refuses-more-than-the-line-says — the warehouse counts; the selling team decides what it owns. */}
              {st.over > 0n && (
                <ErrorLine testId={`accept-over-${pid}`}>
                  {t("restock.receive.over", { n: st.over.toString() })}
                </ErrorLine>
              )}
              {st.brokenOver && (
                <ErrorLine testId={`accept-broken-error-${pid}`}>
                  {t("restock.accept.brokenOverReceived", { n: st.received.toString() })}
                </ErrorLine>
              )}

              {/* WORKED OUT — read-only, filled by the system. */}
              <Stack gap="2" borderTopWidth="1px" borderColor="border" pt="card">
                <Outcome
                  label={t("restock.accept.good")}
                  value={st.counted && !st.brokenOver ? st.good.toString() : "—"}
                  testId={`accept-good-${pid}`}
                />

                <Outcome
                  label={t("restock.problem.broken")}
                  value={st.counted && !st.brokenOver ? st.broken.toString() : "—"}
                  worth={st.broken > 0n && !st.brokenOver ? st.brokenValue : undefined}
                  testId={`accept-broken-count-${pid}`}
                  worthTestId={`accept-broken-value-${pid}`}
                />
                {st.broken > 0n && !st.brokenOver && (
                  <ProblemNote
                    value={draft.brokenNote}
                    placeholder={t("restock.accept.brokenNote")}
                    testId={`accept-broken-note-${pid}`}
                    onChange={(brokenNote) => update((d) => ({ ...d, brokenNote }))}
                  />
                )}

                <Outcome
                  label={t("restock.problem.missing")}
                  value={st.counted && st.over === 0n ? st.missing.toString() : "—"}
                  worth={st.missing > 0n ? st.missingValue : undefined}
                  testId={`accept-missing-${pid}`}
                  worthTestId={`accept-missing-value-${pid}`}
                />
                {st.missing > 0n && (
                  <ProblemNote
                    value={draft.missingNote}
                    placeholder={t("restock.accept.missingNote")}
                    testId={`accept-missing-note-${pid}`}
                    onChange={(missingNote) => update((d) => ({ ...d, missingNote }))}
                  />
                )}
              </Stack>
            </Stack>
          </Box>

          {/* 3 — WHERE IT GOES. */}
          <PlacementPanel
            productId={pid}
            warehouseId={warehouseId}
            draft={draft}
            st={st}
            recommendations={recommendations}
            update={update}
          />
        </Grid>
      </Card.Body>
    </Card.Root>
  );
}

function PriceRow({ label, value, testId, muted }: { label: string; value: string; testId: string; muted?: boolean }) {
  return (
    <Flex align="baseline" gap="2">
      <Text fontSize="xs" color="fg.muted">
        {label}
      </Text>
      <Spacer />
      <Text fontSize="sm" color={muted ? "fg.muted" : undefined} fontWeight={muted ? undefined : "bold"} data-testid={testId}>
        {value}
      </Text>
    </Flex>
  );
}

// A worked-out figure: its name, the count, and — for a problem row — what it was worth, filled from the line.
function Outcome({
  label,
  value,
  worth,
  testId,
  worthTestId,
}: {
  label: string;
  value: string;
  worth?: bigint;
  testId: string;
  worthTestId?: string;
}) {
  const { t } = useTranslation();

  return (
    <Flex align="baseline" gap="2">
      <Text fontSize="sm">{label}</Text>
      <Spacer />
      {worth !== undefined && (
        <Text fontSize="xs" color="fg.muted" data-testid={worthTestId}>
          {t("restock.accept.worth", { value: formatRupiah(worth) })}
        </Text>
      )}
      <Text fontWeight="bold" minW="8" textAlign="end" data-testid={testId}>
        {value}
      </Text>
    </Flex>
  );
}

// The warehouse's optional word on a problem row (a-broken-reason-is-optional) — never what holds an accept up.
function ProblemNote({
  value,
  placeholder,
  testId,
  onChange,
}: {
  value: string;
  placeholder: string;
  testId: string;
  onChange: (value: string) => void;
}) {
  return (
    <Flex gap="1" align="center">
      <Input
        value={value}
        maxLength={200}
        placeholder={placeholder}
        data-testid={testId}
        onChange={(e) => onChange(e.target.value)}
      />
      <NotImplemented list={RESTOCK_ACCEPT_PENDING} id="problemNotes" />
    </Flex>
  );
}

function ErrorLine({ testId, children }: { testId: string; children: ReactNode }) {
  return (
    <Flex gap="1.5" align="flex-start" color="error.fg" data-testid={testId}>
      <Icon as={TriangleAlert} boxSize="4" mt="0.5" flexShrink={0} />
      <Text fontSize="sm">{children}</Text>
    </Flex>
  );
}
