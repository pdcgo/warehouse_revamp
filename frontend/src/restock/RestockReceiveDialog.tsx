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
import { RackSelect, UNPLACED } from "../components/RackSelect";

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

// A place is owed exactly when goods arrived — the server's rule, mirrored: `received_quantity > 0`
// REQUIRES a place, `== 0` ignores one. An UNCOUNTED line owes nothing yet: it is already blocked by
// the count itself, and until someone writes a number down there is no question of where goods went.
function needsPlace(raw: string): boolean {
  return isCounted(raw) && toReceived(raw) > 0n;
}

// Counted zero — someone looked and the line was not there. NOT the same as an uncounted blank, and
// the distinction is the same one `isCounted` draws: 0 is an answer, blank is the absence of one. It
// is what disables a line's picker, so the screen says "nothing arrived, nowhere to put it" instead
// of asking a question with no meaningful answer.
function noneArrived(raw: string): boolean {
  return isCounted(raw) && toReceived(raw) === 0n;
}

// onePlacement turns RackSelect's plain string into the line's placements (#154).
//
// The contract takes a LIST now — a delivery of 100 does not go on one shelf — but this dialog still
// asks for one place per line, so it sends a list of one. Splitting a line across several shelves is
// the Accept SCREEN's job (#157); building it here would mean designing that screen inside a dialog.
//
// Total over the picker's two legal answers only: `""` (unanswered) has no encoding, because the
// contract cannot say "somewhere", and `complete` blocks Confirm long before a blank could reach here.
// A placement as the request builder wants it — a plain init object, like every other message here.
type PlacementInit = {
  place: { case: "unplaced"; value: true } | { case: "rackId"; value: bigint };
  quantity: bigint;
};

function onePlacement(place: string, quantity: bigint): PlacementInit[] {
  const where: PlacementInit["place"] =
    place === UNPLACED
      ? { case: "unplaced", value: true }
      : { case: "rackId", value: BigInt(place) };

  return [{ place: where, quantity }];
}

function prefill(request: RestockRequest): Record<string, string> {
  const counts: Record<string, string> = {};
  for (const item of request.items) {
    counts[item.id.toString()] = item.quantity.toString();
  }
  return counts;
}

// Every place starts UNANSWERED — deliberately not prefilled, unlike the counts beside them. The two
// look symmetrical and are not: a prefilled count is a claim the REQUEST already made (10 were asked
// for) offered back for confirmation, whereas a prefilled place would invent an answer only the
// person holding the box has. Guessing the shelf is precisely what naming one exists to prevent.
function prefillPlaces(request: RestockRequest): Record<string, string> {
  const places: Record<string, string> = {};
  for (const item of request.items) {
    places[item.id.toString()] = "";
  }
  return places;
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
  const [places, setPlaces] = useState<Record<string, string>>(() => prefillPlaces(request));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Opening re-prefills from the row as it is NOW. The dialog outlives its own open state (the
  // trigger keeps it mounted in the row), so without this a second open would still show whatever
  // was typed into the first — including a half-finished count from a request that has since
  // reloaded underneath it.
  function openChange(next: boolean) {
    if (next) {
      setCounts(prefill(request));
      setPlaces(prefillPlaces(request));
      setError("");
    }
    setOpen(next);
  }

  // The server's two rules in one pass, per line: it must be counted, and if anything arrived it must
  // say where it went. A line counted 0 needs no place — nothing turned up, so there is nowhere to put
  // it. This stays the ONE Confirm guard on purpose: a second one beside it is how a screen's idea of
  // "ready to send" drifts from the handler's idea of "acceptable".
  const complete = request.items.every((item) => {
    const key = item.id.toString();
    const raw = counts[key] ?? "";

    if (!isCounted(raw)) return false;
    return !needsPlace(raw) || (places[key] ?? "") !== "";
  });

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
        lines: request.items.map((item) => {
          const key = item.id.toString();
          const receivedQuantity = toReceived(counts[key] ?? "");

          // A line that never turned up carries NO place. The server would ignore one anyway, but the
          // picker beside a zeroed count may still hold a rack someone chose before writing the 0 —
          // and sending that would file a claim that goods went to a shelf they never reached.
          if (receivedQuantity === 0n) {
            return { itemId: item.id, receivedQuantity };
          }

          return {
            itemId: item.id,
            receivedQuantity,
            placements: onePlacement(places[key] ?? "", receivedQuantity),
          };
        }),
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
    // `xl`, not `lg`: naming the place adds a whole picker per row, and a table of SKU + two numbers
    // + a select does not fit the narrower shelf without the counts and the places crowding.
    <Dialog.Root open={open} onOpenChange={(e) => openChange(e.open)} size="xl">
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

                {/* The table scrolls inside its OWN box: the place picker makes the row wide, and a
                    narrow viewport must scroll this table sideways rather than the whole dialog. */}
                <Table.ScrollArea>
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
                        {/* Count then place, left to right, in the order the act happens: you open the
                            box, you count what is in it, you carry it to a shelf. */}
                        <Table.ColumnHeader>{t("restock.receive.place")}</Table.ColumnHeader>
                      </Table.Row>
                    </Table.Header>

                    <Table.Body>
                      {request.items.map((item) => {
                        const key = item.id.toString();
                        const raw = counts[key] ?? "";
                        const counted = isCounted(raw);
                        const hint = counted ? deltaLabel(t, item.quantity, toReceived(raw)) : "";
                        const place = places[key] ?? "";
                        const placeMissing = needsPlace(raw) && place === "";

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

                            {/* RackSelect hardcodes its own testid, so the CELL carries the per-line
                                one — otherwise every row's picker answers to `rack-select` alike. */}
                            <Table.Cell data-testid={`restock-receive-place-${item.id}`}>
                              <Stack gap="1" minW="52">
                                <RackSelect
                                  warehouseId={teamId}
                                  value={place}
                                  disabled={noneArrived(raw)}
                                  onChange={(next) =>
                                    setPlaces((prev) => ({ ...prev, [key]: next }))
                                  }
                                />

                                {/* Says WHY Confirm is dark, the same way "Not counted" does for the
                                    number beside it. Without it a disabled button is a disabled button,
                                    and the missing answer is somewhere in a table of ten rows. */}
                                {placeMissing && (
                                  <Text
                                    fontSize="xs"
                                    color="red.fg"
                                    data-testid={`restock-receive-unplaced-${item.id}`}
                                  >
                                    {t("restock.receive.noPlace")}
                                  </Text>
                                )}
                              </Stack>
                            </Table.Cell>
                          </Table.Row>
                        );
                      })}
                    </Table.Body>
                  </Table.Root>
                </Table.ScrollArea>

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
