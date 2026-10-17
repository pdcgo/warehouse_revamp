import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Badge,
  Box,
  Button,
  Dialog,
  Field,
  HStack,
  Icon,
  Input,
  Portal,
  Spinner,
  Stack,
  Text,
} from "@chakra-ui/react";
import { Lock } from "lucide-react";

import { rpcError } from "../../../api/clients";
import { toaster } from "../../../components/feedback/Toaster";
import { QuantityInput } from "../../../components/inputs/QuantityInput";
import { ProductListItem } from "../../../components/products/ProductListItem";
import { NotImplemented } from "../../../features/pending/NotImplemented";
import { useRackContents, useRackSample } from "../../../features/racks/queries";
import type { Rack, RackStockLine } from "../../../gen/warehouse/inventory/v1/rack_pb";
import { RACK_DETAIL_PENDING } from "../pending";

const units = (raw: string | undefined) => {
  const n = Number(raw ?? "");
  return Number.isInteger(n) && n > 0 ? n : 0;
};

// RecordSampleDialog records a sample: a person asked at the warehouse, and staff took the goods off THIS rack and
// handed them over (docs/business/inventory/transaction_decision.md, placement_decision.md):
//
//   a-sample-is-handed-over-at-the-warehouse      goods going OUT, by hand — no order, no courier.
//   a-sample-names-the-rack-it-was-taken-from     the page's rack, never chosen here.
//   a-sample-is-recorded-on-rack-detail           this dialog, beside Move Goods.
//   a-handed-over-sample-is-final                 nothing here undoes it — the dialog says so before it is sent.
//
//   a-sample-is-a-stock-out-at-batch-value        no money moves and nobody on the owning team is asked to agree, so
//                                                 there is no "agreed by" field — the team sees the sample instead.
export function RecordSampleDialog({
  warehouseId,
  rack,
  teamNames,
  open,
  onOpenChange,
  onRecorded,
}: {
  warehouseId: bigint;
  rack: Rack;
  teamNames: Map<string, string>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRecorded: () => void;
}) {
  const { t } = useTranslation();

  const contents = useRackContents({ warehouseId, rackId: rack.id, enabled: open });
  const lines = contents.data?.lines ?? [];
  const products = contents.data?.products ?? new Map();

  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [recipient, setRecipient] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setQuantities({});
    setRecipient("");
    setNote("");
    setError("");
  }, [open]);

  const sample = useRackSample();

  const nameOf = (line: RackStockLine) =>
    products.get(line.productId.toString())?.name ??
    t("racks.detail.productUnknown", { id: line.productId.toString() });

  const plan = useMemo(() => {
    const out: { productId: bigint; quantity: bigint }[] = [];
    let total = 0;

    for (const line of lines) {
      const n = units(quantities[line.productId.toString()]);
      if (n === 0 || line.counting) continue;

      total += n;
      out.push({ productId: line.productId, quantity: BigInt(n) });
    }

    return { lines: out, total };
  }, [lines, quantities]);

  const recipientMissing = recipient.trim() === "";
  const canSubmit = plan.total > 0 && !recipientMissing && !sample.isPending;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;

    setError("");
    const given = plan.total;

    sample.mutate(
      {
        teamId: warehouseId,
        rackId: rack.id,
        lines: plan.lines,
        recipient: recipient.trim(),
        description: note.trim(),
      },
      {
        onSuccess: () => {
          toaster.create({ type: "success", title: t("racks.sample.done", { count: given, code: rack.code }) });
          onRecorded();
          onOpenChange(false);
        },
        onError: (err) => setError(rpcError(err)),
      },
    );
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(e) => onOpenChange(e.open)}
      size={{ base: "full", md: "md" }}
      scrollBehavior="inside"
    >
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content data-testid="record-sample-dialog">
            <form onSubmit={submit} style={{ display: "contents" }}>
              <Dialog.Header>
                <Dialog.Title>{t("racks.sample.title", { code: rack.code })}</Dialog.Title>
              </Dialog.Header>

              <Dialog.Body>
                <Stack gap="card">
                  {error && (
                    <Alert.Root status="error" data-testid="sample-error">
                      <Alert.Indicator />
                      <Alert.Content>
                        <Alert.Title>{t("racks.sample.refused")}</Alert.Title>
                        <Alert.Description>{error}</Alert.Description>
                      </Alert.Content>
                    </Alert.Root>
                  )}

                  {/* FINAL, said before it is sent: a sample is never rolled back (a-handed-over-sample-is-final). */}
                  <Text fontSize="sm" color="fg.muted" data-testid="sample-final">
                    {t("racks.sample.intro")}
                  </Text>

                  {contents.isPending ? (
                    <Spinner colorPalette="brand" />
                  ) : contents.isError ? (
                    <Text color="error.fg" data-testid="sample-contents-error">
                      {rpcError(contents.error)}
                    </Text>
                  ) : lines.length === 0 ? (
                    <Text color="fg.muted" data-testid="sample-empty">
                      {t("racks.sample.empty")}
                    </Text>
                  ) : (
                    <Stack gap="field">
                      {lines.map((line) => {
                        const product = products.get(line.productId.toString());
                        const pid = line.productId.toString();

                        return (
                          <Box
                            key={pid}
                            borderWidth="1px"
                            borderColor="border"
                            borderRadius="md"
                            p="3"
                            data-testid={`sample-line-${pid}`}
                          >
                            <Stack gap="2">
                              <HStack justify="space-between" align="start" gap="3">
                                <ProductListItem
                                  product={product ?? { id: line.productId, name: nameOf(line) }}
                                  teamName={product ? teamNames.get(product.teamId.toString()) : undefined}
                                />
                                <Text fontSize="sm" color="fg.muted" flexShrink={0}>
                                  {t("racks.move.onRack", { count: Number(line.onHand) })}
                                </Text>
                              </HStack>

                              {line.counting ? (
                                <HStack gap="2" data-testid={`sample-counting-${pid}`}>
                                  <Badge colorPalette="warning" variant="subtle">
                                    <Icon as={Lock} boxSize="3" />
                                    {t("racks.move.counting")}
                                  </Badge>
                                  <Text fontSize="xs" color="fg.muted">
                                    {t("racks.move.countingHelp")}
                                  </Text>
                                  <NotImplemented list={RACK_DETAIL_PENDING} id="countLock" />
                                </HStack>
                              ) : (
                                <HStack gap="2">
                                  <QuantityInput
                                    value={quantities[pid] ?? ""}
                                    onChange={(quantity) => setQuantities((prev) => ({ ...prev, [pid]: quantity }))}
                                    min={0}
                                    max={Number(line.onHand)}
                                    aria-label={t("racks.sample.quantity", { name: nameOf(line) })}
                                    testId={`sample-qty-${pid}`}
                                  />
                                  <Text fontSize="sm" color="fg.muted">
                                    {t("racks.sample.given")}
                                  </Text>
                                </HStack>
                              )}
                            </Stack>
                          </Box>
                        );
                      })}
                    </Stack>
                  )}

                  <Field.Root required invalid={plan.total > 0 && recipientMissing}>
                    <Field.Label>{t("racks.sample.recipient")}</Field.Label>
                    <Input
                      value={recipient}
                      maxLength={200}
                      placeholder={t("racks.sample.recipientPlaceholder")}
                      data-testid="sample-recipient"
                      onChange={(e) => setRecipient(e.target.value)}
                    />
                    <Field.HelperText>{t("racks.sample.recipientHelp")}</Field.HelperText>
                  </Field.Root>

                  <Field.Root>
                    <Field.Label>{t("racks.move.note")}</Field.Label>
                    <Input
                      value={note}
                      maxLength={500}
                      placeholder={t("racks.sample.notePlaceholder")}
                      data-testid="sample-note"
                      onChange={(e) => setNote(e.target.value)}
                    />
                  </Field.Root>

                  {plan.total > 0 && (
                    <Text fontSize="sm" data-testid="sample-summary">
                      {t("racks.sample.summary", { units: plan.total, products: plan.lines.length })}
                    </Text>
                  )}
                </Stack>
              </Dialog.Body>

              <Dialog.Footer>
                <Dialog.ActionTrigger asChild>
                  <Button variant="outline" data-testid="sample-cancel">
                    {t("racks.move.cancel")}
                  </Button>
                </Dialog.ActionTrigger>
                <Button
                  type="submit"
                  colorPalette="brand"
                  disabled={!canSubmit}
                  loading={sample.isPending}
                  data-testid="sample-submit"
                >
                  {t("racks.sample.submit")}
                </Button>
              </Dialog.Footer>
            </form>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
