import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Box,
  Button,
  CloseButton,
  Dialog,
  Field,
  Flex,
  Icon,
  Input,
  Portal,
  Stack,
  Text,
} from "@chakra-ui/react";
import { PackageCheck, Printer } from "lucide-react";

import { rpcError } from "../../../api/clients";
import type { Order, OrderReturnLabel } from "../../../gen/warehouse/selling/v1/order_pb";
import { CopyText } from "../../../components/chrome/CopyText";
import { CharCount } from "../../../components/inputs/CharCount";
import { CurrencyInput } from "../../../components/inputs/CurrencyInput";
import { QuantityInput } from "../../../components/inputs/QuantityInput";
import { toaster } from "../../../components/feedback/Toaster";
import { useAcceptReturn } from "../../../features/orders/queries";

export const description =
  "Accept Return: the warehouse has the returned parcel in its hands. The whole order comes back — a unit missing from the box is named on its line, and noted on the order for customer service to claim. The courier's charge at the door is entered only if it asked one, with what it was for. Once accepted, a borrowed product's label to print is shown, one per unit in hand.";

/** The note's limit — the proto's `courier_charge_note` max_len, so the box stops where the server would refuse. */
const NOTE_MAX = 200;

// THE RETURN ACCEPT (the-accept-is-the-status-return-completed) — `return → return_completed`, the warehouse's act.
//
// ⚠ TWO STEPS IN ONE DIALOG. The form, then — only when the order has a borrowed line — the labels to print
// (a-returned-borrowed-unit-is-relabelled-at-the-accept). They are answered by the ACCEPT, so they cannot be shown before
// it, and they are shown before the dialog closes because the person is holding the units right now. An order of the
// team's own products has none, and the dialog closes on the accept.
//
// ⚠ IT IS MOUNTED WHATEVER THE STATUS. The accept invalidates the order, which re-reads as `return_completed` — the page
// takes the Accept button away, and a dialog mounted under that button would vanish with the labels still unread.
//
// The parcel is WHOLE (a-return-is-never-partial): there is no "how many came back" per line, only what did NOT — empty,
// the common case. The courier's charge is optional (a-return-may-carry-the-couriers-ask) and its note required once it
// is above 0 (an-incidental-line-must-say-what-it-was-for), said the moment the amount is typed.
export function AcceptReturnDialog({
  open,
  onOpenChange,
  teamId,
  order,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The order's warehouse — the team accepting it. */
  teamId: bigint;
  order: Order;
}) {
  const { t } = useTranslation();
  const accept = useAcceptReturn();

  // Per line, what did NOT come back — as typed; "" is nothing missing.
  const [missing, setMissing] = useState<Record<string, string>>({});
  const [charge, setCharge] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  // The accept's answer: the labels to print. `null` until accepted.
  const [labels, setLabels] = useState<OrderReturnLabel[] | null>(null);

  // A fresh form every time it opens, so a cancelled attempt never leaks into the next one.
  useEffect(() => {
    if (!open) return;

    setMissing({});
    setCharge("");
    setNote("");
    setError(null);
    setLabels(null);
  }, [open]);

  const amount = charge === "" ? 0n : BigInt(charge);
  const charged = amount > 0n;
  const noteMissing = charged && note.trim() === "";
  const busy = accept.isPending;

  const missingLines = order.items
    .map((item) => ({ orderItemId: item.id, quantity: Number(missing[item.id.toString()] || "0") }))
    .filter((line) => line.quantity > 0);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    try {
      const res = await accept.mutateAsync({
        teamId,
        orderId: order.id,
        missingLines,
        courierCharge: amount,
        courierChargeNote: charged ? note.trim() : "",
      });

      toaster.create({ type: "success", title: t("picking.acceptReturn.accepted") });

      if (res.labels.length > 0) {
        setLabels(res.labels);
        return;
      }

      onOpenChange(false);
    } catch (err) {
      setError(rpcError(err));
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(e) => onOpenChange(e.open)} placement="center" size={{ base: "full", md: "lg" }}>
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content data-testid="accept-return-dialog">
            {labels ? (
              <LabelsStep labels={labels} onDone={() => onOpenChange(false)} />
            ) : (
              <form onSubmit={submit}>
                <Dialog.Header>
                  <Dialog.Title>{t("picking.acceptReturn.title", { id: order.id.toString() })}</Dialog.Title>
                </Dialog.Header>

                <Dialog.Body>
                  <Stack gap="section">
                    <Text fontSize="sm" color="fg.muted">
                      {t("picking.acceptReturn.intro")}
                    </Text>

                    {/* THE LINES — each as a block, so the dialog reads the same at a phone's width. */}
                    <Stack gap="card" data-testid="accept-return-lines">
                      <Stack gap="0.5">
                        <Text fontWeight="bold">{t("picking.acceptReturn.linesTitle")}</Text>
                        <Text fontSize="xs" color="fg.muted">
                          {t("picking.acceptReturn.linesHint")}
                        </Text>
                      </Stack>

                      {order.items.map((item) => {
                        const key = item.id.toString();

                        return (
                          <Flex
                            key={key}
                            gap="card"
                            align="center"
                            justify="space-between"
                            wrap="wrap"
                            borderWidth="1px"
                            borderColor="border.muted"
                            rounded="md"
                            px="3"
                            py="2"
                            data-testid={`accept-return-line-${key}`}
                          >
                            <Stack gap="0" minW="0" flex="1">
                              <Text truncate>{item.name}</Text>
                              <Text fontSize="xs" color="fg.muted">
                                {item.productCode} · {t("picking.acceptReturn.ordered", { count: item.quantity })}
                              </Text>
                            </Stack>

                            <Field.Root w="auto">
                              <Field.Label fontSize="xs">{t("picking.acceptReturn.missing")}</Field.Label>
                              <QuantityInput
                                value={missing[key] ?? ""}
                                onChange={(value) => setMissing((prev) => ({ ...prev, [key]: value }))}
                                min={0}
                                max={item.quantity}
                                placeholder="0"
                                aria-label={t("picking.acceptReturn.missingOf", { name: item.name })}
                                testId={`accept-return-missing-${key}`}
                              />
                            </Field.Root>
                          </Flex>
                        );
                      })}

                      {missingLines.length > 0 && (
                        <Text fontSize="xs" color="warning.fg" data-testid="accept-return-short">
                          {t("picking.acceptReturn.shortHint")}
                        </Text>
                      )}
                    </Stack>

                    {/* THE COURIER'S ASK AT THE DOOR — rarely asked, so empty by default. */}
                    <Stack gap="field" data-testid="accept-return-courier">
                      <Stack gap="0.5">
                        <Text fontWeight="bold">{t("picking.acceptReturn.courierTitle")}</Text>
                        <Text fontSize="xs" color="fg.muted">
                          {t("picking.acceptReturn.courierHint")}
                        </Text>
                      </Stack>

                      <Field.Root>
                        <Field.Label>{t("picking.acceptReturn.courierAmount")}</Field.Label>
                        <CurrencyInput value={charge} onChange={setCharge} data-testid="accept-return-charge" />
                      </Field.Root>

                      <Field.Root required={charged} invalid={noteMissing}>
                        <Field.Label>
                          {t("picking.acceptReturn.courierNote")}
                          <Field.RequiredIndicator />
                        </Field.Label>
                        <Input
                          value={note}
                          maxLength={NOTE_MAX}
                          placeholder={t("picking.acceptReturn.courierNotePlaceholder")}
                          data-testid="accept-return-charge-note"
                          onChange={(e) => setNote(e.target.value)}
                        />
                        <Flex w="full" justify="space-between" gap="2">
                          {noteMissing ? (
                            <Field.ErrorText data-testid="accept-return-charge-note-error">
                              {t("picking.acceptReturn.courierNoteRequired")}
                            </Field.ErrorText>
                          ) : (
                            <Box />
                          )}
                          <CharCount value={note} max={NOTE_MAX} />
                        </Flex>
                      </Field.Root>
                    </Stack>

                    {error && (
                      <Text color="fg.error" fontSize="sm" data-testid="accept-return-error">
                        {error}
                      </Text>
                    )}
                  </Stack>
                </Dialog.Body>

                <Dialog.Footer>
                  <Dialog.ActionTrigger asChild>
                    <Button variant="outline" disabled={busy}>
                      {t("common.cancel")}
                    </Button>
                  </Dialog.ActionTrigger>
                  <Button
                    type="submit"
                    colorPalette="brand"
                    loading={busy}
                    disabled={noteMissing}
                    data-testid="accept-return-submit"
                  >
                    <Icon as={PackageCheck} boxSize="4" />
                    {t("picking.action.acceptReturn")}
                  </Button>
                </Dialog.Footer>
              </form>
            )}

            <Dialog.CloseTrigger asChild>
              <CloseButton size="sm" />
            </Dialog.CloseTrigger>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}

// THE LABELS TO PRINT (a-returned-borrowed-unit-is-relabelled-at-the-accept): each borrowed line's units come back as the
// selling team's own mapped product, so its code is printed and stuck over the lender's — a later pick scan then matches.
// One per unit in hand. The code is the thing typed into the label printer, so it is large and copies with a click.
function LabelsStep({ labels, onDone }: { labels: OrderReturnLabel[]; onDone: () => void }) {
  const { t } = useTranslation();

  return (
    <>
      <Dialog.Header>
        <Dialog.Title>{t("picking.acceptReturn.labelsTitle")}</Dialog.Title>
      </Dialog.Header>

      <Dialog.Body>
        <Stack gap="card">
          <Text fontSize="sm" color="fg.muted">
            {t("picking.acceptReturn.labelsIntro")}
          </Text>

          <Stack gap="card" data-testid="accept-return-labels">
            {labels.map((label) => (
              <Flex
                key={label.orderItemId.toString()}
                gap="card"
                align="center"
                justify="space-between"
                wrap="wrap"
                borderWidth="1px"
                borderColor="border.muted"
                rounded="md"
                px="3"
                py="2"
                data-testid={`accept-return-label-${label.orderItemId}`}
              >
                <Stack gap="0.5" minW="0" flex="1">
                  <Flex align="center" gap="2">
                    <Icon as={Printer} boxSize="4" color="fg.muted" />
                    <CopyText value={label.ownProductCode} mono fontSize="lg" testId={`accept-return-label-code-${label.orderItemId}`} />
                  </Flex>
                  <Text fontSize="sm" truncate>
                    {label.ownProductName}
                  </Text>
                  <Text fontSize="xs" color="fg.muted">
                    {t("picking.acceptReturn.labelOver", { code: label.borrowedProductCode })}
                  </Text>
                </Stack>

                <Badge colorPalette="brand" size="lg" data-testid={`accept-return-label-count-${label.orderItemId}`}>
                  {t("picking.acceptReturn.labelCount", { count: label.quantity })}
                </Badge>
              </Flex>
            ))}
          </Stack>
        </Stack>
      </Dialog.Body>

      <Dialog.Footer>
        <Button colorPalette="brand" onClick={onDone} data-testid="accept-return-done">
          {t("picking.acceptReturn.done")}
        </Button>
      </Dialog.Footer>
    </>
  );
}
