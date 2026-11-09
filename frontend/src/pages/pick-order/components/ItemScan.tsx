import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Button, Card, Flex, Icon, Stack, Text } from "@chakra-ui/react";
import { PackageCheck, ScanLine } from "lucide-react";

import type { OrderItem } from "../../../gen/warehouse/selling/v1/order_pb";
import { ScanInput } from "../../../features/picking/ScanInput";
import { NotImplemented } from "../../../features/pending/NotImplemented";
import { beep } from "../../../lib/beep";
import { PICK_ORDER_PENDING } from "../pending";

// THE ITEM SCANS LIVE ON THE PAGE (the-item-scans-live-on-the-page) — the same page the label opened, below the racks the
// walk read (the-pick-page-opens-first-by-the-label). Back at the table, every item is scanned:
//
//   a scan     counts its line up to the ordered quantity — an item not on the order, or one too many, is refused
//              with the wrong sound
//   saved      nothing, per scan: the count is this page's, and a reload starts it again (the goods are in the basket)
//   Set Picked on only once every line is exact — ONE write, processed → picked
//
// ⚠ PRODUCTS HAVE NO BARCODE (`barcode`, parked by the owner): an item is matched by its product code.
export function ItemScan({
  items,
  setting,
  onSetPicked,
}: {
  /** The order's lines — the detail read carries them. */
  items: OrderItem[];
  /** Set Picked is on its way. */
  setting: boolean;
  onSetPicked: () => void;
}) {
  const { t } = useTranslation();
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const [problem, setProblem] = useState("");

  const complete = useMemo(
    () => items.length > 0 && items.every((item) => (counts.get(String(item.id)) ?? 0) === item.quantity),
    [items, counts],
  );

  function scan(code: string) {
    const wanted = code.toLowerCase();
    // A product listed on two lines fills the first one still short, then the next.
    const lines = items.filter((line) => line.productCode.toLowerCase() === wanted);

    if (lines.length === 0) {
      beep("wrong");
      setProblem(t("picking.scan.unknown", { code }));
      return;
    }

    const line = lines.find((item) => (counts.get(String(item.id)) ?? 0) < item.quantity);

    if (!line) {
      beep("wrong");
      setProblem(t("picking.scan.over", { name: lines[0]!.name }));
      return;
    }

    beep("fulfilled");
    setProblem("");
    setCounts((prev) => new Map(prev).set(String(line.id), (prev.get(String(line.id)) ?? 0) + 1));
  }

  return (
    <Card.Root data-testid="pick-scan">
      <Card.Body>
        <Stack gap="card">
          <Flex align="center" gap="2">
            <Icon as={ScanLine} boxSize="4" color="fg.muted" />
            <Text fontSize="sm" color="fg.muted" textTransform="uppercase">
              {t("picking.scan.title")}
            </Text>
          </Flex>

          <Flex align="center" gap="1">
            <Text fontSize="sm" color="fg.muted">
              {t("picking.scan.help")}
            </Text>
            <NotImplemented list={PICK_ORDER_PENDING} id="barcode" />
          </Flex>

          <ScanInput onScan={scan} testId="pick-scan-input" label={t("picking.scan.title")} />

          {problem && (
            <Text color="error.fg" fontSize="sm" fontWeight="bold" data-testid="pick-scan-problem">
              {problem}
            </Text>
          )}

          <Stack gap="1" data-testid="pick-scan-lines">
            {items.map((item) => {
              const have = counts.get(String(item.id)) ?? 0;
              const exact = have === item.quantity;

              return (
                <Flex
                  key={String(item.id)}
                  align="center"
                  gap="3"
                  px="3"
                  py="2"
                  borderRadius="l2"
                  bg={exact ? "success.subtle" : "bg.subtle"}
                  data-testid={`pick-scan-line-${item.id}`}
                  data-code={item.productCode}
                  data-quantity={item.quantity}
                  data-exact={exact ? "true" : undefined}
                >
                  <Stack gap="0" flex="1" minW="0">
                    <Text fontSize="sm" lineClamp={1}>
                      {item.name}
                    </Text>
                    <Text fontSize="xs" color="fg.muted" fontFamily="mono">
                      {item.productCode}
                    </Text>
                  </Stack>
                  <Badge colorPalette={exact ? "success" : "gray"} variant="subtle" size="lg">
                    {have} / {item.quantity}
                  </Badge>
                </Flex>
              );
            })}
          </Stack>

          <Flex align="center" gap="card" wrap="wrap">
            {complete && (
              <Text color="success.fg" fontWeight="bold" data-testid="pick-scan-complete">
                {t("picking.scan.complete")}
              </Text>
            )}
            <Button
              ms="auto"
              colorPalette="brand"
              disabled={!complete}
              loading={setting}
              data-testid="pick-order-set-picked"
              onClick={onSetPicked}
            >
              <Icon as={PackageCheck} boxSize="4" />
              {t("picking.scan.setPicked")}
            </Button>
          </Flex>
        </Stack>
      </Card.Body>
    </Card.Root>
  );
}
