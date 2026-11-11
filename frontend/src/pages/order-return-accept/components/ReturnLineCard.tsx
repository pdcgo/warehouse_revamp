import type { ReactNode } from "react";
import { Box, Card, Field, Flex, Grid, Icon, Input, Spacer, Stack, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { ClipboardCheck, Printer, TriangleAlert } from "lucide-react";

import type { OrderItem, OrderReturnLabel } from "../../../gen/warehouse/selling/v1/order_pb";
import { CopyText } from "../../../components/chrome/CopyText";
import { CharCount } from "../../../components/inputs/CharCount";
import { QuantityInput } from "../../../components/inputs/QuantityInput";
import { ProductListItem } from "../../../components/products/ProductListItem";
import type { ReturnLineDraft, ReturnLineState } from "../draft";
import { ReturnPlacementPanel } from "./ReturnPlacementPanel";

/** The note's limit — the proto's `OrderReturnAcceptLine.note` max_len, so the box stops where the server would refuse. */
const NOTE_MAX = 200;

// ONE LINE OF THE PARCEL, in Accept Delivery's three columns (a-counted-line-is-three-columns): WHAT IT IS · WHAT CAME
// BACK · WHERE IT GOES. They stack below `xl`, as Accept Delivery's do — a rack picker needs the room.
//
// The crew types TWO numbers, both blank for a whole parcel: what is NOT in the box, and what is in it but too damaged to
// sell. The sound units are worked out and shown, never typed. A borrowed line also says the code to print — the
// selling team's own product it comes back as — so the label is stuck on while the units are in hand
// (a-returned-borrowed-unit-is-relabelled-at-the-accept). Once either number is above 0 the line takes ONE optional
// note — "sobek di jahitan" — kept on its door row and copied onto the order's warehouse note for the platform claim
// (a-return-door-row-carries-an-optional-note); a line with neither has no note field.
export function ReturnLineCard({
  item,
  draft,
  st,
  relabel,
  warehouseId,
  imageUrl,
  thumbnailUrl,
  update,
}: {
  item: OrderItem;
  draft: ReturnLineDraft;
  st: ReturnLineState;
  relabel?: OrderReturnLabel;
  warehouseId: bigint;
  imageUrl?: string;
  thumbnailUrl?: string;
  update: (fn: (d: ReturnLineDraft) => ReturnLineDraft) => void;
}) {
  const { t } = useTranslation();
  const id = item.id;

  return (
    <Card.Root data-testid={`return-accept-line-${id}`} data-borrowed={relabel ? "true" : undefined}>
      <Card.Body>
        <Grid
          templateColumns={{ base: "1fr", xl: "minmax(0, 3fr) minmax(0, 4fr) minmax(0, 4fr)" }}
          gap="card"
          alignItems="stretch"
        >
          {/* 1 — WHAT IT IS. Read-only. The name and code are the line's — what the parcel's label says. */}
          <Stack gap="card" alignSelf="start" minW="0">
            <ProductListItem
              product={{
                id: item.productId,
                productCode: item.productCode,
                name: item.name,
                defaultImageUrl: imageUrl,
                defaultImageThumbnailUrl: thumbnailUrl,
              }}
            />

            <Text fontSize="sm" fontWeight="bold" data-testid={`return-accept-ordered-${id}`}>
              {t("picking.returnAccept.ordered", { count: item.quantity })}
            </Text>

            {relabel && (
              <Box
                borderWidth="1px"
                borderColor="brand.muted"
                bg="brand.subtle"
                borderRadius="md"
                px="3"
                py="2"
                data-testid={`return-accept-relabel-${id}`}
              >
                <Stack gap="0.5">
                  <Text fontSize="xs" color="fg.muted">
                    {t("picking.returnAccept.relabelTitle")}
                  </Text>
                  <Flex align="center" gap="2">
                    <Icon as={Printer} boxSize="4" color="fg.muted" />
                    <CopyText
                      value={relabel.ownProductCode}
                      mono
                      fontSize="lg"
                      testId={`return-accept-relabel-code-${id}`}
                    />
                  </Flex>
                  <Text fontSize="sm" truncate>
                    {relabel.ownProductName}
                  </Text>
                  <Text fontSize="xs" color="fg.muted" data-testid={`return-accept-relabel-count-${id}`}>
                    {st.sound > 0
                      ? t("picking.returnAccept.relabelCount", { count: st.sound, code: item.productCode })
                      : t("picking.returnAccept.relabelNone")}
                  </Text>
                </Stack>
              </Box>
            )}
          </Stack>

          {/* 2 — WHAT CAME BACK. Two typed numbers, then what they mean. */}
          <Box borderWidth="1px" borderColor="border" borderRadius="md" p="card" h="full">
            <Stack gap="card">
              <Flex align="center" gap="2">
                <Icon as={ClipboardCheck} boxSize="4" color="brand.fg" />
                <Text fontSize="sm" fontWeight="bold">
                  {t("picking.returnAccept.cameBack")}
                </Text>
              </Flex>

              <Flex gap="card" wrap="wrap" align="flex-start">
                <Field.Root invalid={st.over > 0} w="auto">
                  <Field.Label>{t("picking.returnAccept.missing")}</Field.Label>
                  <QuantityInput
                    min={0}
                    width="16"
                    value={draft.missing}
                    placeholder="0"
                    aria-label={t("picking.returnAccept.missingOf", { name: item.name })}
                    testId={`return-accept-missing-${id}`}
                    onChange={(missing) => update((d) => ({ ...d, missing }))}
                  />
                  <Field.HelperText>{t("picking.returnAccept.missingHint")}</Field.HelperText>
                </Field.Root>

                <Field.Root invalid={st.over > 0} w="auto">
                  <Field.Label>{t("picking.returnAccept.broken")}</Field.Label>
                  <QuantityInput
                    min={0}
                    width="16"
                    value={draft.broken}
                    placeholder="0"
                    aria-label={t("picking.returnAccept.brokenOf", { name: item.name })}
                    testId={`return-accept-broken-${id}`}
                    onChange={(broken) => update((d) => ({ ...d, broken }))}
                  />
                  <Field.HelperText>{t("picking.returnAccept.brokenHint")}</Field.HelperText>
                </Field.Root>
              </Flex>

              {st.over > 0 && (
                <ErrorLine testId={`return-accept-over-${id}`}>
                  {t("picking.returnAccept.over", { count: st.ordered })}
                </ErrorLine>
              )}

              {/* THE DOOR ROW'S NOTE — only once something is broken or missing; blank is fine. */}
              {st.broken + st.missing > 0 && (
                <Field.Root>
                  <Field.Label>{t("picking.returnAccept.note")}</Field.Label>
                  <Input
                    size="sm"
                    value={draft.note}
                    maxLength={NOTE_MAX}
                    placeholder={t("picking.returnAccept.notePlaceholder")}
                    aria-label={t("picking.returnAccept.noteOf", { name: item.name })}
                    data-testid={`return-accept-note-${id}`}
                    onChange={(e) => update((d) => ({ ...d, note: e.target.value }))}
                  />
                  <Flex w="full" justify="space-between" gap="2">
                    <Field.HelperText>{t("picking.returnAccept.noteHint")}</Field.HelperText>
                    <CharCount value={draft.note} max={NOTE_MAX} />
                  </Flex>
                </Field.Root>
              )}

              {/* WORKED OUT — read-only. A figure not known yet reads —, never a different card. */}
              <Stack gap="2" borderTopWidth="1px" borderColor="border" pt="card">
                <Outcome
                  label={t("picking.returnAccept.sound")}
                  value={st.over > 0 ? "—" : String(st.sound)}
                  testId={`return-accept-sound-${id}`}
                  strong
                />
                <Outcome
                  label={t("picking.returnAccept.thrownAway")}
                  value={st.over > 0 ? "—" : String(st.broken)}
                  testId={`return-accept-thrown-${id}`}
                />
                <Outcome
                  label={t("picking.returnAccept.missingOut")}
                  value={st.over > 0 ? "—" : String(st.missing)}
                  testId={`return-accept-missing-count-${id}`}
                />
              </Stack>
            </Stack>
          </Box>

          {/* 3 — WHERE IT GOES. */}
          <ReturnPlacementPanel itemId={id} warehouseId={warehouseId} draft={draft} st={st} update={update} />
        </Grid>
      </Card.Body>
    </Card.Root>
  );
}

function Outcome({ label, value, testId, strong }: { label: string; value: string; testId: string; strong?: boolean }) {
  return (
    <Flex align="baseline" gap="2">
      <Text fontSize="sm" color={strong ? undefined : "fg.muted"}>
        {label}
      </Text>
      <Spacer />
      <Text fontWeight="bold" minW="8" textAlign="end" data-testid={testId}>
        {value}
      </Text>
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
