import { useState } from "react";
import type { ReactNode } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Button,
  CloseButton,
  Dialog,
  Flex,
  Input,
  Portal,
  Stack,
  Table,
  Text,
} from "@chakra-ui/react";
import { restockClient, rpcError } from "../api/clients";
import type { RestockRequest } from "../gen/warehouse/inventory/v1/restock_request_pb";
import { toaster } from "../components/Toaster";

interface RestockReceiveDialogProps {
  request: RestockRequest;
  teamId: bigint;
  onDone: () => void;
  trigger: ReactNode;
}

// The gap between what was asked for and what arrived, as a phrase — "" when they match. Both the
// live hint in this dialog and the badge on the finished record (the detail page) read it from here,
// so the same discrepancy can never be phrased two ways.
export function deltaLabel(t: TFunction, asked: bigint, arrived: bigint): string {
  if (arrived === asked) return "";
  if (arrived < asked) return t("restock.receive.short", { n: (asked - arrived).toString() });
  return t("restock.receive.over", { n: (arrived - asked).toString() });
}

// A count is held as a STRING while editing, because blank is not 0 — and here that distinction has
// teeth. `0` is a legitimate count (the line never turned up); BLANK means nobody has counted it
// yet. Submitting a blank as 0 would silently write off a line no one looked at, which is the exact
// failure the server refuses an incomplete `lines` array to prevent. So a blank is INVALID, not
// zero: to say nothing arrived you type 0 and mean it.
function isCounted(raw: string): boolean {
  if (raw.trim() === "") return false;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0;
}

// Only ever called on a string `isCounted` has already accepted. There is deliberately no upper
// bound — 11 against 10 asked is over-delivery, which is real, and a cap would only force the person
// counting to write down a number they can see is wrong.
function toReceived(raw: string): bigint {
  if (!isCounted(raw)) return 0n;
  return BigInt(Number(raw));
}

function prefill(request: RestockRequest): Record<string, string> {
  const counts: Record<string, string> = {};
  for (const item of request.items) {
    counts[item.id.toString()] = item.quantity.toString();
  }
  return counts;
}

// RestockReceiveDialog is how a warehouse ACCEPTS a restock (#133). Accepting is COUNTING: a request
// is a promise, a delivery is a fact, and the two disagree often enough that the system refuses to
// assume they match. There is no "accept as asked" shortcut here because there is none in the
// contract — `lines` must name every line of the request exactly once, or the server refuses it.
//
// Each Arrived field is PREFILLED with the asked quantity: everything turning up is the common case,
// so the person adjusts only what differs. That is a convenience, not an assumption — the number is
// on screen, it is editable, and confirming means someone looked at it.
export function RestockReceiveDialog({ request, teamId, onDone, trigger }: RestockReceiveDialogProps) {
  const { t } = useTranslation();

  const [open, setOpen] = useState(false);
  const [counts, setCounts] = useState<Record<string, string>>(() => prefill(request));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Opening re-prefills from the row as it is NOW. The dialog outlives its own open state (the
  // trigger keeps it mounted in the row), so without this a second open would still show whatever
  // was typed into the first — including a half-finished count from a request that has since
  // reloaded underneath it.
  function openChange(next: boolean) {
    if (next) {
      setCounts(prefill(request));
      setError("");
    }
    setOpen(next);
  }

  const complete = request.items.every((item) => isCounted(counts[item.id.toString()] ?? ""));

  const askedTotal = request.items.reduce((sum, item) => sum + item.quantity, 0n);
  const arrivedTotal = request.items.reduce(
    (sum, item) => sum + toReceived(counts[item.id.toString()] ?? ""),
    0n,
  );
  const differing = request.items.filter((item) => {
    const raw = counts[item.id.toString()] ?? "";
    return isCounted(raw) && toReceived(raw) !== item.quantity;
  }).length;

  async function confirm() {
    setBusy(true);
    setError("");

    try {
      // Every line, exactly once — built from `request.items` rather than from the `counts` map, so
      // the payload's shape comes from the REQUEST and cannot silently drop a line the map missed.
      await restockClient.restockRequestFulfill({
        teamId,
        requestId: request.id,
        lines: request.items.map((item) => ({
          itemId: item.id,
          receivedQuantity: toReceived(counts[item.id.toString()] ?? ""),
        })),
      });

      toaster.create({ type: "success", title: t("restock.toast.fulfilled") });
      setOpen(false);
      onDone();
    } catch (err) {
      // Rendered IN the dialog, not thrown at a toast: the count is still on screen and still
      // correct, so the person should be able to read the reason and retry without re-counting.
      setError(rpcError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(e) => openChange(e.open)} size="lg">
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>

      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content data-testid="restock-receive-dialog">
            <Dialog.Header>
              <Dialog.Title>{t("restock.receive.title")}</Dialog.Title>
            </Dialog.Header>

            <Dialog.Body>
              <Stack gap="card">
                <Text fontSize="sm" color="fg.muted">
                  {t("restock.receive.intro")}
                </Text>

                {error && (
                  <Text color="red.fg" fontSize="sm" data-testid="restock-receive-error">
                    {error}
                  </Text>
                )}

                <Table.Root size="sm" data-testid="restock-receive-items">
                  <Table.Header>
                    <Table.Row>
                      <Table.ColumnHeader>{t("restock.table.product")}</Table.ColumnHeader>
                      <Table.ColumnHeader textAlign="end">
                        {t("restock.receive.asked")}
                      </Table.ColumnHeader>
                      <Table.ColumnHeader textAlign="end">
                        {t("restock.receive.arrived")}
                      </Table.ColumnHeader>
                    </Table.Row>
                  </Table.Header>

                  <Table.Body>
                    {request.items.map((item) => {
                      const key = item.id.toString();
                      const raw = counts[key] ?? "";
                      const counted = isCounted(raw);
                      const hint = counted ? deltaLabel(t, item.quantity, toReceived(raw)) : "";

                      return (
                        <Table.Row key={key} data-testid={`restock-receive-line-${item.id}`}>
                          <Table.Cell>
                            <Stack gap="0" minW="0">
                              <Text fontWeight="medium">{item.sku}</Text>
                              <Text fontSize="xs" color="fg.muted" lineClamp={1}>
                                {item.name}
                              </Text>
                            </Stack>
                          </Table.Cell>

                          <Table.Cell textAlign="end" data-testid={`restock-receive-asked-${item.id}`}>
                            {item.quantity.toString()}
                          </Table.Cell>

                          <Table.Cell textAlign="end">
                            <Stack gap="1" align="end">
                              <Input
                                type="number"
                                min="0"
                                w="24"
                                textAlign="end"
                                value={raw}
                                aria-label={t("restock.receive.arrivedFor", { sku: item.sku })}
                                data-testid={`restock-receive-qty-${item.id}`}
                                onChange={(e) =>
                                  setCounts((prev) => ({ ...prev, [key]: e.target.value }))
                                }
                              />

                              {/* Two DIFFERENT things to say, and only one can be true. A blank is
                                  the blocker (nothing has been counted); a delta is information
                                  about a count that HAS been made. */}
                              {!counted ? (
                                <Text
                                  fontSize="xs"
                                  color="red.fg"
                                  data-testid={`restock-receive-uncounted-${item.id}`}
                                >
                                  {t("restock.receive.uncounted")}
                                </Text>
                              ) : (
                                hint && (
                                  <Text
                                    fontSize="xs"
                                    color="orange.fg"
                                    data-testid={`restock-receive-delta-${item.id}`}
                                  >
                                    {hint}
                                  </Text>
                                )
                              )}
                            </Stack>
                          </Table.Cell>
                        </Table.Row>
                      );
                    })}
                  </Table.Body>
                </Table.Root>

                {/* The summary exists to make a discrepancy impossible to confirm by accident: the
                    person is about to receive `arrivedTotal` pieces into stock, not `askedTotal`. */}
                <Flex align="center" justify="space-between" gap="card" wrap="wrap">
                  <Text fontSize="sm" color="fg.muted" data-testid="restock-receive-summary">
                    {t("restock.receive.summary", {
                      asked: askedTotal.toString(),
                      arrived: arrivedTotal.toString(),
                    })}
                  </Text>

                  {differing > 0 ? (
                    <Badge colorPalette="orange" data-testid="restock-receive-differing">
                      {t("restock.receive.differing", { n: differing })}
                    </Badge>
                  ) : (
                    complete && (
                      <Badge colorPalette="green" data-testid="restock-receive-matches">
                        {t("restock.receive.matches")}
                      </Badge>
                    )
                  )}
                </Flex>
              </Stack>
            </Dialog.Body>

            <Dialog.Footer>
              <Dialog.ActionTrigger asChild>
                <Button variant="outline">{t("common.cancel")}</Button>
              </Dialog.ActionTrigger>

              <Button
                colorPalette="brand"
                loading={busy}
                disabled={!complete}
                onClick={() => void confirm()}
                data-testid="restock-receive-confirm"
              >
                {t("restock.receive.confirm")}
              </Button>
            </Dialog.Footer>

            <Dialog.CloseTrigger asChild>
              <CloseButton size="sm" />
            </Dialog.CloseTrigger>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
