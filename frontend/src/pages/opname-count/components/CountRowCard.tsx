import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Card, Field, HStack, Icon, Input, Span, Stack, Text } from "@chakra-ui/react";
import { Check, Lock, RotateCcw, Send } from "lucide-react";

import { rpcError } from "../../../api/clients";
import { OpnameDraftType, type OpnameRow, OpnameRowStatus } from "../../../gen/warehouse/inventory/v1/opname_pb";
import { QuantityInput } from "../../../components/inputs/QuantityInput";
import { differenceOf, draftOf, lostAfterBroken, surplusOf } from "../../../features/opname/adapt";
import { OpnameDifference, OpnameDraftBadge, OpnameDrafts, OpnameRowStateBadge } from "../../../features/opname/OpnameBadges";
import { useCountOpnameRow, useMarkOpnameRowCounted } from "../../../features/opname/queries";

// ONE PRODUCT ON THE RACK, as its counter works it (opname.md §How Staff Work On Session, a-row-is-marked-counted-after-
// its-drafts):
//
//   1. count BLIND — the product's name and an empty box; the book figure is not on the screen, nor in the answer that
//      fills it (a-count-is-blind-then-revealed). Sellable units only: a torn one comes off the rack (a-count-is-of-
//      sellable-units).
//   2. REVEALED — expected, counted, the difference. One recount, which replaces the count (a-row-keeps-only-its-latest-count).
//   3. the DRAFTS — short: the system's lost, and how many of those are broken; over: the system's surplus. Every draft
//      needs its reason (a-difference-needs-its-reason-on-the-draft, a-short-rack-gets-a-lost-draft-from-the-system).
//   4. MARK COUNTED — read-only after, until the admin sends it back (a-counted-row-is-read-only-until-sent-back).
export function CountRowCard({ row, teamId, teamName }: { row: OpnameRow; teamId: bigint; teamName: string }) {
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
  const brokenN = broken === "" ? 0n : BigInt(broken);
  const lost = row.revealed ? lostAfterBroken(row, brokenN) : 0n;
  const surplus = row.revealed ? surplusOf(row) : 0n;
  const missingReason = (brokenN > 0n && brokenNote.trim() === "") || (lost > 0n && lostNote.trim() === "") || (surplus > 0n && surplusNote.trim() === "");

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

  const countBox = (
    <HStack gap="2" align="flex-end" wrap="wrap">
      <Field.Root w="auto">
        <Field.Label>{t(recounting ? "opnameSession.count.recountLabel" : "opnameSession.count.countLabel")}</Field.Label>
        <QuantityInput value={typed} onChange={setTyped} min={0} width="9rem" testId={`opname-count-input-${row.id}`} />
      </Field.Root>
      <Button size="sm" colorPalette="brand" disabled={typed === ""} loading={count.isPending} onClick={submitCount} data-testid={`opname-count-submit-${row.id}`}>
        <Icon as={Send} boxSize="4" />
        {t(recounting ? "opnameSession.count.submitRecount" : "opnameSession.count.submit")}
      </Button>
    </HStack>
  );

  return (
    <Card.Root variant="outline" size="sm" data-testid={`opname-count-row-${row.id}`}>
      <Card.Body gap="3">
        <HStack justify="space-between" align="flex-start" gap="2">
          <Stack gap="0" minW="0">
            <Span fontWeight="bold">{row.productName}</Span>
            <Span fontSize="xs" color="fg.muted">
              {row.productSku} · {teamName}
              {row.foundHere && ` · ${t("opnameSession.count.foundHere")}`}
            </Span>
          </Stack>
          <OpnameRowStateBadge row={row} />
        </HStack>

        {error && (
          <Alert.Root status="error" size="sm" data-testid={`opname-count-error-${row.id}`}>
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Description>{error}</Alert.Description>
            </Alert.Content>
          </Alert.Root>
        )}

        {/* 1. BLIND — nothing of the book on screen. */}
        {!row.revealed && countBox}

        {/* 2. REVEALED. */}
        {row.revealed && (
          <HStack gap="4" wrap="wrap" data-testid={`opname-count-reveal-${row.id}`}>
            <Text fontSize="sm">
              {t("opnameSession.count.expected")}{" "}
              <Span fontWeight="bold" data-testid={`opname-count-expected-${row.id}`}>
                {row.systemStockCount.toString()}
              </Span>
            </Text>
            <Text fontSize="sm">
              {t("opnameSession.count.counted")}{" "}
              <Span fontWeight="bold" data-testid={`opname-count-counted-${row.id}`}>
                {row.recountedStockCount.toString()}
              </Span>
            </Text>
            <Text fontSize="sm">
              {t("opnameSession.count.difference")} <OpnameDifference value={differenceOf(row)} testId={`opname-count-difference-${row.id}`} />
            </Text>
          </HStack>
        )}

        {row.revealed && !counted && !row.recounted && !recounting && (
          <Button size="xs" variant="outline" alignSelf="flex-start" onClick={() => setRecounting(true)} data-testid={`opname-count-recount-${row.id}`}>
            <Icon as={RotateCcw} boxSize="4" />
            {t("opnameSession.count.recount")}
          </Button>
        )}
        {row.revealed && !counted && recounting && countBox}

        {/* 3. THE DRAFTS — the numbers are the system's; staff say how many are broken, and why. */}
        {row.revealed && !counted && !recounting && (
          <Stack gap="3" data-testid={`opname-count-drafts-${row.id}`}>
            {(lost > 0n || brokenN > 0n || row.systemStockCount > row.recountedStockCount) && (
              <Field.Root>
                <Field.Label>{t("opnameSession.count.brokenLabel")}</Field.Label>
                <QuantityInput value={broken} onChange={setBroken} min={0} width="9rem" testId={`opname-count-broken-${row.id}`} />
                <Field.HelperText>{t("opnameSession.count.brokenHelp")}</Field.HelperText>
              </Field.Root>
            )}
            {brokenN > 0n && (
              <ReasonField
                type={OpnameDraftType.BROKEN}
                units={brokenN}
                value={brokenNote}
                onChange={setBrokenNote}
                placeholder={t("opnameSession.count.brokenExample")}
                testId={`opname-count-broken-note-${row.id}`}
              />
            )}
            {lost > 0n && (
              <ReasonField
                type={OpnameDraftType.LOST}
                units={lost}
                value={lostNote}
                onChange={setLostNote}
                placeholder={t("opnameSession.count.lostExample")}
                testId={`opname-count-lost-note-${row.id}`}
              />
            )}
            {surplus > 0n && (
              <ReasonField
                type={OpnameDraftType.SURPLUS}
                units={surplus}
                value={surplusNote}
                onChange={setSurplusNote}
                placeholder={t("opnameSession.count.surplusExample")}
                testId={`opname-count-surplus-note-${row.id}`}
              />
            )}
            <Button
              size="sm"
              colorPalette="brand"
              alignSelf="flex-start"
              disabled={missingReason}
              loading={mark.isPending}
              onClick={markCounted}
              data-testid={`opname-count-mark-${row.id}`}
            >
              <Icon as={Check} boxSize="4" />
              {t("opnameSession.count.markCounted")}
            </Button>
            {missingReason && (
              <Text fontSize="xs" color="fg.muted" data-testid={`opname-count-needs-reason-${row.id}`}>
                {t("opnameSession.count.needsReason")}
              </Text>
            )}
          </Stack>
        )}

        {/* 4. COUNTED — read-only. */}
        {counted && (
          <Stack gap="2">
            <OpnameDrafts drafts={row.drafts} testId={`opname-count-final-drafts-${row.id}`} />
            <HStack gap="1" color="fg.muted" fontSize="xs">
              <Icon as={Lock} boxSize="3" />
              <Span>{t("opnameSession.count.readOnly")}</Span>
            </HStack>
          </Stack>
        )}
      </Card.Body>
    </Card.Root>
  );
}

function ReasonField({
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
      <Field.Label>
        <HStack gap="2">
          <OpnameDraftBadge type={type} />
          <Span fontVariantNumeric="tabular-nums">{units.toString()}</Span>
          <Span>{t("opnameSession.count.why")}</Span>
        </HStack>
        <Field.RequiredIndicator />
      </Field.Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} maxLength={500} data-testid={testId} />
    </Field.Root>
  );
}
