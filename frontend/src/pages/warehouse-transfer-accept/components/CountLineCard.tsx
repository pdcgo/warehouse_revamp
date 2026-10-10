import { useTranslation } from "react-i18next";
import { Badge, Box, Button, Card, Field, Flex, HStack, Icon, IconButton, Input, SimpleGrid, Span, Stack, Text } from "@chakra-ui/react";
import { Plus, Trash2 } from "lucide-react";

import type { WarehouseTransferItem } from "../../../gen/warehouse/inventory/v1/warehouse_transfer_pb";
import { QuantityInput } from "../../../components/inputs/QuantityInput";
import { RackSelect } from "../../../components/pickers/RackSelect";
import { type LineCount, goodOf, isCounted, missingOf, placedOf, problemOf, toCount } from "../count";

// ONE LINE OF THE COUNT: what is in the box, how many of those are broken, and where the good units go on B's racks.
// The missing units are worked out — sent minus arrived — never typed (broken-and-missing-at-the-door-are-problem-rows).
// Every good unit goes on a rack; there is no unplaced pile, so RackSelect offers none (there-is-no-unplaced-pile).
export function CountLineCard({
  item,
  line,
  warehouseId,
  onChange,
}: {
  item: WarehouseTransferItem;
  line: LineCount;
  /** B — the racks the good units go on are its own. */
  warehouseId: bigint;
  onChange: (line: LineCount) => void;
}) {
  const { t } = useTranslation();
  const counted = isCounted(line);
  const good = goodOf(line);
  const missing = missingOf(item, line);
  const problem = problemOf(item, line);
  const set = (patch: Partial<LineCount>) => onChange({ ...line, ...patch });

  const setPlacement = (i: number, patch: Partial<LineCount["placements"][number]>) =>
    set({ placements: line.placements.map((p, j) => (j === i ? { ...p, ...patch } : p)) });

  return (
    <Card.Root data-testid={`accept-line-${item.id}`}>
      <Card.Header>
        <Flex align="center" gap="card" wrap="wrap">
          <Stack gap="0" flex="1" minW="0">
            <Span fontWeight="bold">{item.name}</Span>
            <Span fontSize="xs" color="fg.muted">
              {item.sku}
            </Span>
          </Stack>
          <Badge variant="subtle" data-testid={`accept-line-${item.id}-sent`}>
            {t("warehouseTransfer.accept.sent", { count: item.count.toString() })}
          </Badge>
          {counted && problem === null && (
            <Badge colorPalette="success" data-testid={`accept-line-${item.id}-ok`}>
              {t("warehouseTransfer.accept.lineOk")}
            </Badge>
          )}
        </Flex>
      </Card.Header>
      <Card.Body>
        <Stack gap="card">
          <SimpleGrid columns={{ base: 1, md: 2 }} gap="card">
            <Field.Root required invalid={problem === "overSent"}>
              <Field.Label>
                {t("warehouseTransfer.accept.arrived")}
                <Field.RequiredIndicator />
              </Field.Label>
              <QuantityInput
                value={line.arrived}
                onChange={(arrived) => set({ arrived })}
                min={0}
                max={Number(item.count)}
                testId={`accept-line-${item.id}-arrived`}
              />
              <Field.HelperText>{t("warehouseTransfer.accept.arrivedHint")}</Field.HelperText>
              {problem === "overSent" && <Field.ErrorText>{t("warehouseTransfer.accept.overSent")}</Field.ErrorText>}
            </Field.Root>
            <Field.Root invalid={problem === "brokenOverArrived"}>
              <Field.Label>{t("warehouseTransfer.accept.broken")}</Field.Label>
              <QuantityInput
                value={line.broken}
                onChange={(broken) => set({ broken })}
                min={0}
                testId={`accept-line-${item.id}-broken`}
              />
              {problem === "brokenOverArrived" && (
                <Field.ErrorText>{t("warehouseTransfer.accept.brokenOverArrived")}</Field.ErrorText>
              )}
            </Field.Root>
          </SimpleGrid>

          {/* The two problem rows' notes, each shown only when its row will exist (a-transfer-problem-row-carries-a-note). */}
          {(toCount(line.broken) > 0n || missing > 0n) && (
            <SimpleGrid columns={{ base: 1, md: 2 }} gap="card">
              {toCount(line.broken) > 0n && (
                <Field.Root>
                  <Field.Label>{t("warehouseTransfer.accept.brokenNote")}</Field.Label>
                  <Input
                    value={line.brokenNote}
                    maxLength={200}
                    data-testid={`accept-line-${item.id}-broken-note`}
                    onChange={(e) => set({ brokenNote: e.target.value })}
                  />
                </Field.Root>
              )}
              {missing > 0n && (
                <Field.Root>
                  <Field.Label>{t("warehouseTransfer.accept.missingNote", { count: missing.toString() })}</Field.Label>
                  <Input
                    value={line.missingNote}
                    maxLength={200}
                    data-testid={`accept-line-${item.id}-missing-note`}
                    onChange={(e) => set({ missingNote: e.target.value })}
                  />
                </Field.Root>
              )}
            </SimpleGrid>
          )}

          {/* WHERE THE GOOD UNITS GO — every one of them, exactly. */}
          {counted && good > 0n && (
            <Stack gap="2" data-testid={`accept-line-${item.id}-placements`}>
              <HStack gap="2">
                <Text fontSize="sm" fontWeight="bold">
                  {t("warehouseTransfer.accept.putAway", { count: good.toString() })}
                </Text>
                <Span
                  fontSize="xs"
                  color={placedOf(line) === good ? "fg.muted" : "warning.fg"}
                  data-testid={`accept-line-${item.id}-placed`}
                >
                  {t("warehouseTransfer.accept.placed", { placed: placedOf(line).toString(), good: good.toString() })}
                </Span>
              </HStack>
              {line.placements.map((placement, i) => (
                <Flex key={i} gap="2" align="center">
                  <Box flex="1" minW="0">
                    <RackSelect
                      warehouseId={warehouseId}
                      value={placement.rackId}
                      onChange={(rackId) => setPlacement(i, { rackId })}
                      allowUnplaced={false}
                      placeholder={t("warehouseTransfer.accept.rackPlaceholder")}
                    />
                  </Box>
                  <QuantityInput
                    value={placement.quantity}
                    onChange={(quantity) => setPlacement(i, { quantity })}
                    min={0}
                    max={Number(good)}
                    testId={`accept-line-${item.id}-placement-${i}-qty`}
                  />
                  {line.placements.length > 1 && (
                    <IconButton
                      size="xs"
                      variant="ghost"
                      aria-label={t("warehouseTransfer.accept.removeRack")}
                      onClick={() => set({ placements: line.placements.filter((_, j) => j !== i) })}
                    >
                      <Icon as={Trash2} boxSize="4" />
                    </IconButton>
                  )}
                </Flex>
              ))}
              <Button
                size="xs"
                variant="ghost"
                alignSelf="flex-start"
                data-testid={`accept-line-${item.id}-add-rack`}
                onClick={() => set({ placements: [...line.placements, { rackId: "", quantity: "" }] })}
              >
                <Icon as={Plus} boxSize="4" />
                {t("warehouseTransfer.accept.addRack")}
              </Button>
            </Stack>
          )}
        </Stack>
      </Card.Body>
    </Card.Root>
  );
}
