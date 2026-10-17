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
  IconButton,
  Input,
  Portal,
  Spinner,
  Stack,
  Text,
} from "@chakra-ui/react";
import { Lock, Pencil, Split, Undo2, X } from "lucide-react";

import { rpcError } from "../../../api/clients";
import { toaster } from "../../../components/feedback/Toaster";
import { QuantityInput } from "../../../components/inputs/QuantityInput";
import { RackSelect } from "../../../components/pickers/RackSelect";
import { ProductListItem } from "../../../components/products/ProductListItem";
import { NotImplemented } from "../../../features/pending/NotImplemented";
import { useRackCodes, useRackContents, useRackMove } from "../../../features/racks/queries";
import type { Rack, RackStockLine } from "../../../gen/warehouse/inventory/v1/rack_pb";
import { RACK_DETAIL_PENDING } from "../pending";

// ONE DESTINATION OF ONE PRODUCT. A product starts with one leg; "Split to Another Rack" adds more
// (a-move-is-one-rack-to-one-or-more-racks). A leg that is not `custom` goes to the dialog's default rack.
interface Leg {
  key: number;
  quantity: string;
  custom: boolean;
  // A rack id as a string, "" = not chosen. Read only when `custom`.
  to: string;
}

const firstLeg = (): Leg => ({ key: 0, quantity: "", custom: false, to: "" });

const units = (leg: Leg) => {
  const n = Number(leg.quantity);
  return Number.isInteger(n) && n > 0 ? n : 0;
};

// MoveGoodsDialog moves goods off THIS rack onto one or more racks of the same warehouse — staff reorganizing space
// (docs/business/inventory/placement_decision.md):
//
//   a-move-is-one-rack-to-one-or-more-racks   a default rack fills every line; any line may change it; a product
//                                             may be split over several racks — never back onto this one.
//   a-move-is-all-or-nothing                  one write for every line: refused whole, and the error names the
//                                             product. A product being counted is locked at 0.
//   the-move-dialog-shows-stock-count-only-for-now   each line's ceiling is its stock count, with no waiting note.
//   a-move-writes-one-transaction-per-owning-team    invisible here — the server splits by owner.
//
// Every product starts at 0 and "Move Everything" fills them, rather than every product starting full: a stray
// click on Move then moves nothing instead of the whole rack.
export function MoveGoodsDialog({
  warehouseId,
  rack,
  teamNames,
  open,
  onOpenChange,
  onMoved,
}: {
  warehouseId: bigint;
  rack: Rack;
  teamNames: Map<string, string>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMoved: () => void;
}) {
  const { t } = useTranslation();

  const contents = useRackContents({ warehouseId, rackId: rack.id, enabled: open });
  const lines = contents.data?.lines ?? [];
  const products = contents.data?.products ?? new Map();

  const codesQuery = useRackCodes({ warehouseId, enabled: open });
  const codes = codesQuery.data ?? {};

  const [defaultTo, setDefaultTo] = useState("");
  const [legs, setLegs] = useState<Record<string, Leg[]>>({});
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  // A fresh dialog every time it opens: a move half-typed and cancelled is not a draft to come back to.
  useEffect(() => {
    if (!open) return;
    setDefaultTo("");
    setLegs({});
    setNote("");
    setError("");
  }, [open]);

  const move = useRackMove();

  const legsOf = (productId: bigint) => legs[productId.toString()] ?? [firstLeg()];
  const setLegsOf = (productId: bigint, next: Leg[]) =>
    setLegs((prev) => ({ ...prev, [productId.toString()]: next }));

  const nameOf = (line: RackStockLine) =>
    products.get(line.productId.toString())?.name ??
    t("racks.detail.productUnknown", { id: line.productId.toString() });

  const resolvedTo = (leg: Leg) => (leg.custom ? leg.to : defaultTo);
  const codeOf = (rackId: string) => codes[rackId] ?? `#${rackId}`;

  // Everything the Move button waits on, worked out once, in the order a person would fix it.
  const plan = useMemo(() => {
    const out: { productId: bigint; quantity: bigint; toRackId: bigint }[] = [];
    const problems: string[] = [];
    const destinations = new Set<string>();
    let total = 0;
    let productCount = 0;

    for (const line of lines) {
      const productLegs = legs[line.productId.toString()] ?? [firstLeg()];
      const sum = productLegs.reduce((acc, leg) => acc + units(leg), 0);
      if (sum === 0) continue;

      productCount++;
      total += sum;

      if (line.counting) {
        problems.push(t("racks.move.problem.counting", { name: nameOf(line) }));
        continue;
      }

      if (BigInt(sum) > line.onHand) {
        problems.push(t("racks.move.problem.tooMany", { name: nameOf(line), count: Number(line.onHand) }));
      }

      const seen = new Set<string>();
      for (const leg of productLegs) {
        if (units(leg) === 0) continue;

        const to = resolvedTo(leg);
        if (to === "") {
          problems.push(t("racks.move.problem.noRack", { name: nameOf(line) }));
          continue;
        }
        if (seen.has(to)) {
          problems.push(t("racks.move.problem.twice", { name: nameOf(line), code: codeOf(to) }));
          continue;
        }

        seen.add(to);
        destinations.add(to);
        out.push({ productId: line.productId, quantity: BigInt(units(leg)), toRackId: BigInt(to) });
      }
    }

    // Problems are de-duplicated: two default legs with no default rack say the same thing once.
    return { lines: out, problems: [...new Set(problems)], total, productCount, rackCount: destinations.size };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, legs, defaultTo, products, codes, t]);

  const canSubmit = plan.total > 0 && plan.problems.length === 0 && !move.isPending;

  function moveEverything() {
    const next: Record<string, Leg[]> = { ...legs };

    for (const line of lines) {
      if (line.counting) continue;

      const productLegs = legsOf(line.productId);
      const others = productLegs.slice(1).reduce((acc, leg) => acc + units(leg), 0);
      const rest = Math.max(0, Number(line.onHand) - others);
      next[line.productId.toString()] = [{ ...productLegs[0]!, quantity: String(rest) }, ...productLegs.slice(1)];
    }

    setLegs(next);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;

    setError("");
    const moved = plan.total;

    move.mutate(
      { teamId: warehouseId, fromRackId: rack.id, lines: plan.lines, description: note.trim() },
      {
        onSuccess: () => {
          toaster.create({ type: "success", title: t("racks.move.done", { count: moved, code: rack.code }) });
          onMoved();
          onOpenChange(false);
        },
        // ALL OR NOTHING: a refusal means nothing moved, and the message names the product to fix.
        onError: (err) => setError(rpcError(err)),
      },
    );
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(e) => onOpenChange(e.open)}
      size={{ base: "full", md: "lg" }}
      scrollBehavior="inside"
    >
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content data-testid="move-goods-dialog">
            <form onSubmit={submit} style={{ display: "contents" }}>
              <Dialog.Header>
                <Dialog.Title>{t("racks.move.title", { code: rack.code })}</Dialog.Title>
              </Dialog.Header>

              <Dialog.Body>
                <Stack gap="card">
                  {error && (
                    <Alert.Root status="error" data-testid="move-error">
                      <Alert.Indicator />
                      <Alert.Content>
                        <Alert.Title>{t("racks.move.refused")}</Alert.Title>
                        <Alert.Description>{error}</Alert.Description>
                      </Alert.Content>
                    </Alert.Root>
                  )}

                  <Field.Root required>
                    <Field.Label>{t("racks.move.defaultTo")}</Field.Label>
                    <RackSelect
                      warehouseId={warehouseId}
                      value={defaultTo}
                      onChange={setDefaultTo}
                      allowUnplaced={false}
                      excludeRackId={rack.id}
                      testId="move-default-to"
                    />
                    <Field.HelperText>{t("racks.move.defaultToHelp")}</Field.HelperText>
                  </Field.Root>

                  <HStack justify="space-between">
                    <Text fontWeight="bold" fontSize="sm">
                      {t("racks.move.products", { code: rack.code })}
                    </Text>
                    <Button
                      size="xs"
                      variant="outline"
                      data-testid="move-everything"
                      disabled={lines.length === 0}
                      onClick={moveEverything}
                    >
                      {t("racks.move.everything")}
                    </Button>
                  </HStack>

                  {contents.isPending ? (
                    <Spinner colorPalette="brand" />
                  ) : contents.isError ? (
                    <Text color="error.fg" data-testid="move-contents-error">
                      {rpcError(contents.error)}
                    </Text>
                  ) : lines.length === 0 ? (
                    <Text color="fg.muted" data-testid="move-empty">
                      {t("racks.move.empty")}
                    </Text>
                  ) : (
                    <Stack gap="field">
                      {lines.map((line) => {
                        const product = products.get(line.productId.toString());
                        const productLegs = legsOf(line.productId);
                        const pid = line.productId.toString();

                        return (
                          <Box
                            key={pid}
                            borderWidth="1px"
                            borderColor="border"
                            borderRadius="md"
                            p="3"
                            data-testid={`move-line-${pid}`}
                          >
                            <Stack gap="2">
                              <HStack justify="space-between" align="start" gap="3">
                                <ProductListItem
                                  product={product ?? { id: line.productId, name: nameOf(line) }}
                                  teamName={product ? teamNames.get(product.teamId.toString()) : undefined}
                                />
                                <Text fontSize="sm" color="fg.muted" flexShrink={0} data-testid={`move-stock-${pid}`}>
                                  {t("racks.move.onRack", { count: Number(line.onHand) })}
                                </Text>
                              </HStack>

                              {line.counting ? (
                                // LOCKED AT 0, not hidden: the product is still on the rack, and saying why it
                                // cannot move is the difference between a rule and a bug (a-move-is-all-or-nothing).
                                <HStack gap="2" data-testid={`move-counting-${pid}`}>
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
                                <>
                                  {productLegs.map((leg, i) => {
                                    const others = productLegs.reduce(
                                      (acc, l) => (l.key === leg.key ? acc : acc + units(l)),
                                      0,
                                    );
                                    const max = Math.max(0, Number(line.onHand) - others);
                                    const update = (patch: Partial<Leg>) =>
                                      setLegsOf(
                                        line.productId,
                                        productLegs.map((l) => (l.key === leg.key ? { ...l, ...patch } : l)),
                                      );

                                    return (
                                      <HStack key={leg.key} gap="2" wrap="wrap" data-testid={`move-leg-${pid}-${i}`}>
                                        <QuantityInput
                                          value={leg.quantity}
                                          onChange={(quantity) => update({ quantity })}
                                          min={0}
                                          max={max}
                                          aria-label={t("racks.move.quantity", { name: nameOf(line) })}
                                          testId={`move-qty-${pid}-${i}`}
                                        />
                                        <Text fontSize="sm" color="fg.muted">
                                          {t("racks.move.to")}
                                        </Text>

                                        {leg.custom ? (
                                          <>
                                            <Box minW="44" flex="1">
                                              <RackSelect
                                                warehouseId={warehouseId}
                                                value={leg.to}
                                                onChange={(to) => update({ to })}
                                                allowUnplaced={false}
                                                excludeRackId={rack.id}
                                                testId={`move-to-${pid}-${i}`}
                                              />
                                            </Box>
                                            {i === 0 && (
                                              <IconButton
                                                size="xs"
                                                variant="ghost"
                                                aria-label={t("racks.move.useDefault")}
                                                data-testid={`move-use-default-${pid}-${i}`}
                                                onClick={() => update({ custom: false, to: "" })}
                                              >
                                                <Icon as={Undo2} boxSize="4" />
                                              </IconButton>
                                            )}
                                          </>
                                        ) : (
                                          <>
                                            <Text fontSize="sm" fontWeight="medium" data-testid={`move-to-default-${pid}-${i}`}>
                                              {defaultTo ? codeOf(defaultTo) : t("racks.move.noDefault")}
                                            </Text>
                                            <Text fontSize="xs" color="fg.muted">
                                              {t("racks.move.defaultMark")}
                                            </Text>
                                            <Button
                                              size="xs"
                                              variant="ghost"
                                              data-testid={`move-change-${pid}-${i}`}
                                              onClick={() => update({ custom: true, to: "" })}
                                            >
                                              <Icon as={Pencil} boxSize="3" />
                                              {t("racks.move.changeRack")}
                                            </Button>
                                          </>
                                        )}

                                        {i > 0 && (
                                          <IconButton
                                            size="xs"
                                            variant="ghost"
                                            aria-label={t("racks.move.remove")}
                                            data-testid={`move-remove-${pid}-${i}`}
                                            onClick={() =>
                                              setLegsOf(
                                                line.productId,
                                                productLegs.filter((l) => l.key !== leg.key),
                                              )
                                            }
                                          >
                                            <Icon as={X} boxSize="4" />
                                          </IconButton>
                                        )}
                                      </HStack>
                                    );
                                  })}

                                  <Button
                                    size="xs"
                                    variant="ghost"
                                    alignSelf="flex-start"
                                    data-testid={`move-split-${pid}`}
                                    onClick={() =>
                                      setLegsOf(line.productId, [
                                        ...productLegs,
                                        {
                                          key: Math.max(...productLegs.map((l) => l.key)) + 1,
                                          quantity: "",
                                          custom: true,
                                          to: "",
                                        },
                                      ])
                                    }
                                  >
                                    <Icon as={Split} boxSize="3" />
                                    {t("racks.move.split")}
                                  </Button>
                                </>
                              )}
                            </Stack>
                          </Box>
                        );
                      })}
                    </Stack>
                  )}

                  <Field.Root>
                    <Field.Label>{t("racks.move.note")}</Field.Label>
                    <Input
                      value={note}
                      maxLength={500}
                      placeholder={t("racks.move.notePlaceholder")}
                      data-testid="move-note"
                      onChange={(e) => setNote(e.target.value)}
                    />
                  </Field.Root>

                  {plan.problems.map((problem) => (
                    <Text key={problem} fontSize="sm" color="error.fg" data-testid="move-problem">
                      {problem}
                    </Text>
                  ))}

                  {plan.total > 0 && plan.problems.length === 0 && (
                    <Text fontSize="sm" data-testid="move-summary">
                      {t("racks.move.summary", {
                        units: plan.total,
                        products: plan.productCount,
                        racks: plan.rackCount,
                      })}
                    </Text>
                  )}
                </Stack>
              </Dialog.Body>

              <Dialog.Footer>
                <Dialog.ActionTrigger asChild>
                  <Button variant="outline" data-testid="move-cancel">
                    {t("racks.move.cancel")}
                  </Button>
                </Dialog.ActionTrigger>
                <Button
                  type="submit"
                  colorPalette="brand"
                  disabled={!canSubmit}
                  loading={move.isPending}
                  data-testid="move-submit"
                >
                  {t("racks.move.submit")}
                </Button>
              </Dialog.Footer>
            </form>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
