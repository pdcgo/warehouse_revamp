import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, Collapsible, Flex, HStack, Icon, Separator, Stack, Text } from "@chakra-ui/react";
import { ChevronDown } from "lucide-react";

import { formatRupiahNumber } from "../../../lib/money";
import { type LineDraft, lineMoney, perPiece, toQty, totals } from "../draft";

// THE MONEY, as the selling team agrees to it: each line at its typed total, the goods, the shipping it paid, and their
// sum. Never the courier's charge at the door — that is the warehouse's, entered at accept and owed back as its own
// debt (the-couriers-charge-stays-out-of-total), and the card says so rather than leaving somebody to wonder why the
// accepted restock later shows a number this one did not.
export function SummaryCard({ lines, shippingCost }: { lines: LineDraft[]; shippingCost: string }) {
  const { t } = useTranslation();
  const { goods, shipping, total } = totals(lines, shippingCost);

  // WHILE THE PRODUCTS FOLD OR UNFOLD, NOTHING SCROLLS (owner: *"collapse muncul scrollbar dan mengganggu"*,
  // the-summary-folds-without-a-scrollbar). The fold animates the list's box from its height to nothing; the list,
  // free to shrink inside it, was squeezed below its rows the whole way and drew a scrollbar for those 200ms — at
  // every width. Its overflow is held hidden from the toggle until the animation ends — or 400ms at most, because with
  // reduced motion there is no animation and so no end to wait for, and a list that never scrolls again is worse.
  const [moving, setMoving] = useState(false);
  useEffect(() => {
    if (!moving) return;
    const done = setTimeout(() => setMoving(false), 400);

    return () => clearTimeout(done);
  }, [moving]);

  // `minH="0"` down the chain lets the card SHRINK inside a height-capped column — the sticky money column, which
  // caps itself at the window — so that its line list, the one part that scrolls, gives way first. With no cap (a
  // phone's single column) nothing shrinks and nothing scrolls.
  return (
    <Card.Root data-testid="restock-summary" minH="0" flexShrink={1}>
      <Card.Body minH="0" display="flex" flexDirection="column">
        <Stack gap="card" minH="0" flex="1">
          {/* THE PRODUCTS FOLD AWAY (owner: *"rincian produk di kanan bisa di collapse"*, the-summary-folds-its-products) —
              the heading is the switch; folded, the card is the money alone. Open to start with. The fold carries the
              shrink chain on (`minH="0"`), so the list still gives way in a capped column. */}
          <Collapsible.Root
            defaultOpen
            onOpenChange={() => setMoving(true)}
            display="flex"
            flexDirection="column"
            minH="0"
            flexShrink={1}
          >
            <Collapsible.Trigger
              display="flex"
              alignItems="center"
              justifyContent="space-between"
              gap="card"
              w="full"
              cursor="pointer"
              css={{ "&[data-state=open] .summary-chevron": { transform: "rotate(180deg)" } }}
              data-testid="restock-summary-toggle"
            >
              <HStack gap="1.5">
                <Text fontSize="sm" fontWeight="bold" color="fg.muted">
                  {t("restock.form.summary.products")}
                </Text>
                <Icon as={ChevronDown} boxSize="4" color="fg.muted" className="summary-chevron" transition="transform 120ms" />
              </HStack>
              <Text fontSize="sm" fontWeight="bold" data-testid="restock-summary-count">
                {lines.length}
              </Text>
            </Collapsible.Trigger>

            <Collapsible.Content
              display="flex"
              flexDirection="column"
              minH="0"
              onAnimationEnd={() => setMoving(false)}
              data-testid="restock-summary-products-list"
            >
              <Stack gap="card" pt="card" minH="0">
                <Separator />

                {lines.length === 0 ? (
                  <Text fontSize="sm" color="fg.muted">
                    {t("restock.form.summary.none")}
                  </Text>
                ) : (
                  // The card sticks beside the lines, so a long restock's list scrolls INSIDE it — the total, the note and the
                  // button under it must never be pushed past the window's foot (owner: *"perincian sticky berarti"*). It
                  // takes what the window leaves, at least two lines' worth.
                  // The gutter is kept (layerStyle scrollList), so the amounts never jump sideways when a bar comes or goes.
                  <Stack
                    gap="card"
                    minH="5rem"
                    flexShrink={1}
                    layerStyle="scrollList"
                    overflowY={moving ? "hidden" : "auto"}
                    data-moving={moving || undefined}
                    data-testid="restock-summary-lines"
                  >
                    {lines.map((line) => (
                      <Flex key={line.productId.toString()} gap="card" justify="space-between" align="start">
                        <Stack gap="0" flex="1" minW="0">
                          <Text fontSize="sm" lineClamp={1}>
                            {line.name || line.sku}
                          </Text>
                          <Text fontSize="xs" color="fg.muted">
                            {toQty(line.count)} × {t("restock.form.perPiece", { price: formatRupiahNumber(perPiece(line)) })}
                          </Text>
                        </Stack>
                        <Text fontSize="sm" flexShrink={0}>
                          {formatRupiahNumber(lineMoney(line))}
                        </Text>
                      </Flex>
                    ))}
                  </Stack>
                )}
              </Stack>
            </Collapsible.Content>
          </Collapsible.Root>

          <Separator />

          <Flex align="center" justify="space-between" gap="card">
            <Text fontSize="sm" color="fg.muted">
              {t("restock.form.summary.goods")}
            </Text>
            <Text fontSize="sm" fontWeight="bold" data-testid="restock-summary-products">
              {formatRupiahNumber(goods)}
            </Text>
          </Flex>

          <Flex align="center" justify="space-between" gap="card">
            <Text fontSize="sm" color="fg.muted">
              {t("restock.form.summary.shipping")}
            </Text>
            <Text fontSize="sm" fontWeight="bold" data-testid="restock-summary-shipping">
              {formatRupiahNumber(shipping)}
            </Text>
          </Flex>

          <Separator />

          <Flex align="center" justify="space-between" gap="card">
            <Text fontWeight="bold">{t("restock.form.summary.total")}</Text>
            <Text fontSize="lg" fontWeight="bold" data-testid="restock-summary-total">
              {formatRupiahNumber(total)}
            </Text>
          </Flex>

          <Text fontSize="xs" color="fg.muted" data-testid="restock-summary-courier-note">
            {t("restock.form.summary.courierNote")}
          </Text>
        </Stack>
      </Card.Body>
    </Card.Root>
  );
}
