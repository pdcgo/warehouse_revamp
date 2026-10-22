import type { ReactNode } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Badge, Box, Button, Card, Field, Flex, Grid, HStack, Icon, Input, Span, Spacer, Stack, Text } from "@chakra-ui/react";
import { Check, ClipboardCheck, EyeOff, Lock, RotateCcw, Scale, Send } from "lucide-react";

import { rpcError } from "../../../api/clients";
import { OpnameDraftType, type OpnameRow, OpnameRowStatus } from "../../../gen/warehouse/inventory/v1/opname_pb";
import { ProductListItem } from "../../../components/products/ProductListItem";
import { QuantityInput } from "../../../components/inputs/QuantityInput";
import { differenceOf, draftOf, lostAfterBroken, surplusOf } from "../../../features/opname/adapt";
import { OpnameDifference, OpnameDraftBadge, OpnameDrafts, OpnameRowStateBadge } from "../../../features/opname/OpnameBadges";
import { useCountOpnameRow, useMarkOpnameRowCounted } from "../../../features/opname/queries";

// ONE PRODUCT ON THE RACK, in three columns — the frame Accept Delivery gives a line of the box (owner): WHAT IT IS ·
// YOUR COUNT · THE DIFFERENCE. The frame never changes shape: a figure not known yet reads "—" (or "hidden", for the book
// before the count is in), so a rack is scanned down one column at a time. The columns stack below `lg`.
//
// The four steps (opname.md §How Staff Work On Session, a-row-is-marked-counted-after-its-drafts):
//
//   1. count BLIND — the book figure is not on the screen, nor in the answer that fills it (a-count-is-blind-then-
//      revealed). Sellable units only: a torn one comes off the rack (a-count-is-of-sellable-units).
//   2. REVEALED — expected, counted, the difference. One recount, which replaces the count (a-row-keeps-only-its-latest-count).
//   3. the DRAFTS — short: the system's lost, and how many of those are broken; over: the system's surplus. Every draft
//      needs its reason (a-difference-needs-its-reason-on-the-draft, a-short-rack-gets-a-lost-draft-from-the-system).
//   4. MARK COUNTED — read-only after, until the admin sends it back (a-counted-row-is-read-only-until-sent-back).
//
// Unlike Accept Delivery there is no one button for the whole rack: the reveal is per product, because the server has
// to take the blind count before it shows the book.
export function CountRowCard({
  row,
  teamId,
  teamName,
  imageUrl,
  thumbnailUrl,
}: {
  row: OpnameRow;
  teamId: bigint;
  teamName: string;
  imageUrl?: string;
  thumbnailUrl?: string;
}) {
  const { t } = useTranslation();
  const count = useCountOpnameRow();
  const mark = useMarkOpnameRowCounted();

  const [typed, setTyped] = useState("");
  const [recounting, setRecounting] = useState(false);
  const [broken, setBroken] = useState("");
  const [brokenNote, setBrokenNote] = useState("");
  const [lostNote, setLostNote] = useState(draftOf(row, OpnameDraftType.LOST)?.note ?? "");
  const [surplusNote, setSurplusNote] = useState(draftOf(row, OpnameDraftType.SURPLUS)?.note ?? "");
  const [error, setError] = useState("");

  const counted = row.status === OpnameRowStatus.COUNTED;
  const short = row.revealed && row.systemStockCount > row.recountedStockCount;
  const brokenN = broken === "" ? 0n : BigInt(broken);
  const lost = row.revealed ? lostAfterBroken(row, brokenN) : 0n;
  const surplus = row.revealed ? surplusOf(row) : 0n;
  const missingReason = (brokenN > 0n && brokenNote.trim() === "") || (lost > 0n && lostNote.trim() === "") || (surplus > 0n && surplusNote.trim() === "");
  const counting = !row.revealed || recounting;

  function submitCount() {
    if (typed === "") return;
    setError("");
    count.mutate(
      { teamId, rowId: row.id, count: BigInt(typed) },
      {
        onSuccess: () => {
          setTyped("");
          setRecounting(false);
        },
        onError: (err) => setError(rpcError(err)),
      },
    );
  }

  function markCounted() {
    if (missingReason) return;
    setError("");
    mark.mutate(
      {
        teamId,
        rowId: row.id,
        brokenCount: brokenN,
        brokenNote: brokenN > 0n ? brokenNote.trim() : "",
        lostNote: lost > 0n ? lostNote.trim() : "",
        surplusNote: surplus > 0n ? surplusNote.trim() : "",
      },
      { onError: (err) => setError(rpcError(err)) },
    );
  }

  return (
    <Card.Root data-testid={`opname-count-row-${row.id}`}>
      <Card.Body>
        <Grid templateColumns={{ base: "1fr", lg: "minmax(0, 3fr) minmax(0, 4fr) minmax(0, 4fr)" }} gap="card" alignItems="stretch">
          {/* 1 — WHAT IT IS. Nothing here is typed: the name and SKU are the snapshot's, only the picture is looked up —
              at the shelf the picture is recognised before the SKU. */}
          <Stack gap="card" alignSelf="start" minW="0">
            <ProductListItem
              product={{
                id: row.productId,
                sku: row.productSku,
                name: row.productName,
                defaultImageUrl: imageUrl,
                defaultImageThumbnailUrl: thumbnailUrl,
              }}
              teamName={teamName}
            />
            <HStack gap="2" wrap="wrap">
              <OpnameRowStateBadge row={row} />
              {row.foundHere && (
                <Badge variant="outline" colorPalette="gray" data-testid={`opname-count-found-here-${row.id}`}>
                  {t("opnameSession.count.foundHere")}
                </Badge>
              )}
            </HStack>
            {error && (
              <Alert.Root status="error" size="sm" data-testid={`opname-count-error-${row.id}`}>
                <Alert.Indicator />
                <Alert.Content>
                  <Alert.Description>{error}</Alert.Description>
                </Alert.Content>
              </Alert.Root>
            )}
          </Stack>

          {/* 2 — YOUR COUNT. The box while counting, then the three figures. */}
          <Panel
            icon={ClipboardCheck}
            title={t("opnameSession.count.yourCount")}
            aside={
              row.revealed &&
              !counted &&
              !row.recounted &&
              !recounting && (
                <Button size="xs" variant="ghost" onClick={() => setRecounting(true)} data-testid={`opname-count-recount-${row.id}`}>
                  <Icon as={RotateCcw} boxSize="4" />
                  {t("opnameSession.count.recount")}
                </Button>
              )
            }
          >
            {!counted && counting && (
              <Field.Root required>
                <Field.Label>
                  {t(recounting ? "opnameSession.count.recountLabel" : "opnameSession.count.countLabel")}
                  <Field.RequiredIndicator />
                </Field.Label>
                <Flex gap="2" align="center" wrap="wrap">
                  <QuantityInput value={typed} onChange={setTyped} min={0} width="9rem" testId={`opname-count-input-${row.id}`} />
                  <Button colorPalette="brand" disabled={typed === ""} loading={count.isPending} onClick={submitCount} data-testid={`opname-count-submit-${row.id}`}>
                    <Icon as={Send} boxSize="4" />
                    {t(recounting ? "opnameSession.count.submitRecount" : "opnameSession.count.submit")}
                  </Button>
                </Flex>
              </Field.Root>
            )}

            {/* The figures — the same three lines in every state. */}
            <Stack gap="2" borderTopWidth={!counted && counting ? "1px" : undefined} borderColor="border" pt={!counted && counting ? "card" : undefined}>
              <Figure label={t("opnameSession.count.counted")}>
                {row.revealed ? (
                  <Span data-testid={`opname-count-counted-${row.id}`}>{row.recountedStockCount.toString()}</Span>
                ) : (
                  "—"
                )}
              </Figure>
              <Figure label={t("opnameSession.count.expected")}>
                {row.revealed ? (
                  <Span data-testid={`opname-count-expected-${row.id}`}>{row.systemStockCount.toString()}</Span>
                ) : (
                  <HStack gap="1" color="fg.muted" fontWeight="normal" fontSize="sm" data-testid={`opname-count-hidden-${row.id}`}>
                    <Icon as={EyeOff} boxSize="3.5" />
                    <Span>{t("opnameSession.count.hidden")}</Span>
                  </HStack>
                )}
              </Figure>
              <Figure label={t("opnameSession.count.difference")}>
                {row.revealed ? <OpnameDifference value={differenceOf(row)} testId={`opname-count-difference-${row.id}`} /> : "—"}
              </Figure>
            </Stack>
          </Panel>

          {/* 3 — THE DIFFERENCE. The numbers are the system's; staff say how many are broken, and why. */}
          <Panel
            muted
            icon={Scale}
            title={t("opnameSession.count.theDifference")}
            aside={
              row.revealed ? (
                <OpnameDifference value={differenceOf(row)} />
              ) : (
                <Badge colorPalette="gray" data-testid={`opname-count-count-first-${row.id}`}>
                  {t("opnameSession.count.countFirst")}
                </Badge>
              )
            }
          >
            {!row.revealed && (
              <Text fontSize="sm" color="fg.muted">
                {t("opnameSession.count.revealHint")}
              </Text>
            )}

            {row.revealed && !counted && recounting && (
              <Text fontSize="sm" color="fg.muted">
                {t("opnameSession.count.recounting")}
              </Text>
            )}

            {row.revealed && !counted && !recounting && (
              <Stack gap="card" data-testid={`opname-count-drafts-${row.id}`}>
                {differenceOf(row) === 0n && (
                  <Text fontSize="sm" color="fg.muted" data-testid={`opname-count-matches-${row.id}`}>
                    {t("opnameSession.count.matches")}
                  </Text>
                )}
                {short && (
                  <Field.Root>
                    <Field.Label>{t("opnameSession.count.brokenLabel")}</Field.Label>
                    <QuantityInput value={broken} onChange={setBroken} min={0} width="9rem" testId={`opname-count-broken-${row.id}`} />
                    <Field.HelperText>{t("opnameSession.count.brokenHelp")}</Field.HelperText>
                  </Field.Root>
                )}
                {(brokenN > 0n || lost > 0n || surplus > 0n) && (
                  <Stack gap="2">
                    {brokenN > 0n && (
                      <ReasonLine
                        type={OpnameDraftType.BROKEN}
                        units={brokenN}
                        value={brokenNote}
                        onChange={setBrokenNote}
                        placeholder={t("opnameSession.count.brokenExample")}
                        testId={`opname-count-broken-note-${row.id}`}
                      />
                    )}
                    {lost > 0n && (
                      <ReasonLine
                        type={OpnameDraftType.LOST}
                        units={lost}
                        value={lostNote}
                        onChange={setLostNote}
                        placeholder={t("opnameSession.count.lostExample")}
                        testId={`opname-count-lost-note-${row.id}`}
                      />
                    )}
                    {surplus > 0n && (
                      <ReasonLine
                        type={OpnameDraftType.SURPLUS}
                        units={surplus}
                        value={surplusNote}
                        onChange={setSurplusNote}
                        placeholder={t("opnameSession.count.surplusExample")}
                        testId={`opname-count-surplus-note-${row.id}`}
                      />
                    )}
                  </Stack>
                )}
                <Stack gap="1" align={{ base: "stretch", lg: "flex-end" }}>
                  <Button colorPalette="brand" disabled={missingReason} loading={mark.isPending} onClick={markCounted} data-testid={`opname-count-mark-${row.id}`}>
                    <Icon as={Check} boxSize="4" />
                    {t("opnameSession.count.markCounted")}
                  </Button>
                  {missingReason && (
                    <Text fontSize="xs" color="fg.muted" data-testid={`opname-count-needs-reason-${row.id}`}>
                      {t("opnameSession.count.needsReason")}
                    </Text>
                  )}
                </Stack>
              </Stack>
            )}

            {/* 4. COUNTED — read-only. */}
            {counted && (
              <Stack gap="2">
                {row.drafts.length === 0 ? (
                  <Text fontSize="sm" color="fg.muted">
                    {t("opnameSession.count.matches")}
                  </Text>
                ) : (
                  <OpnameDrafts drafts={row.drafts} testId={`opname-count-final-drafts-${row.id}`} />
                )}
                <HStack gap="1" color="fg.muted" fontSize="xs">
                  <Icon as={Lock} boxSize="3" />
                  <Span>{t("opnameSession.count.readOnly")}</Span>
                </HStack>
              </Stack>
            )}
          </Panel>
        </Grid>
      </Card.Body>
    </Card.Root>
  );
}

// A column of the card: an icon and a title, something on the right, and the body — Accept Delivery's boxed column.
function Panel({
  icon,
  title,
  aside,
  muted,
  children,
}: {
  icon: typeof ClipboardCheck;
  title: string;
  aside?: ReactNode;
  muted?: boolean;
  children: ReactNode;
}) {
  return (
    <Box borderWidth="1px" borderColor="border" borderRadius="md" bg={muted ? "bg.muted" : undefined} p="card" h="full">
      <Stack gap="card">
        <Flex align="center" gap="2" minH="6">
          <Icon as={icon} boxSize="4" color="brand.fg" />
          <Text fontSize="sm" fontWeight="bold">
            {title}
          </Text>
          <Spacer />
          {aside}
        </Flex>
        {children}
      </Stack>
    </Box>
  );
}

// One figure: its name on the left, the number on the right.
function Figure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Flex align="baseline" gap="2">
      <Text fontSize="sm">{label}</Text>
      <Spacer />
      <Box fontWeight="bold" fontVariantNumeric="tabular-nums" textAlign="end">
        {children}
      </Box>
    </Flex>
  );
}

// A draft and its reason on one line: the kind, the units, and why.
function ReasonLine({
  type,
  units,
  value,
  onChange,
  placeholder,
  testId,
}: {
  type: OpnameDraftType;
  units: bigint;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  testId: string;
}) {
  const { t } = useTranslation();

  return (
    <Field.Root required>
      <Flex gap="2" align="center" w="full">
        <Field.Label flexShrink={0} minW="20" mb="0">
          <OpnameDraftBadge type={type} />
          <Span fontVariantNumeric="tabular-nums">{units.toString()}</Span>
          <Field.RequiredIndicator />
        </Field.Label>
        <Input flex="1" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={t("opnameSession.count.why")} maxLength={500} data-testid={testId} />
      </Flex>
    </Field.Root>
  );
}
