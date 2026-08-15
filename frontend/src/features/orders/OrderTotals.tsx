import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Card, Flex, Separator, Stack, Text } from "@chakra-ui/react";
import { formatRupiah } from "../../lib/money";

export interface OrderTotalsProps {
  /** data-testid prefix — "order-create" on the form, "draft" on a draft. */
  idPrefix?: string;
  subtotal: bigint;
  total: bigint;
  /** A row between the subtotal and the total. The order form passes nothing; a DRAFT passes its
   * shipping cost, which is a real term of a draft's sum because the scrape read one. */
  shipping?: ReactNode;
  /** The submit control, rendered under the total. A slot rather than a `canSave` prop: this card
   * knows about money, not about whether the form is valid. */
  action?: ReactNode;
}

// The money card: what the lines come to, and what the order is placed at.
//
// The order form is down to two rows. The marketplace figure moved to its own card, and the SHIPPING
// COST is gone from that form entirely (owner) — with nothing on the page able to set it, a permanent
// "Rp 0" row would be a term of the sum that never moves, which reads as a broken field rather than
// an absent one. So `total` is `subtotal` there, and the row is a SLOT rather than a deletion: a
// draft carries the shipping the marketplace charged and fills it.
//
// The arithmetic is done HERE for display only — the order stores what the server writes. `total` is
// still sent, and stays sent, because a marketplace's buyer-paid total legitimately differs from
// what the lines add up to once vouchers and coin subsidies are in play.
export function OrderTotals(props: OrderTotalsProps) {
  const { idPrefix = "order-create", subtotal, total, shipping, action } = props;
  const { t } = useTranslation();

  return (
    <Card.Root>
      <Card.Body>
        <Stack gap="card">
          <Flex align="center" gap="card">
            <Text color="fg.muted">{t("orders.subtotal")}</Text>
            <Text data-testid={`${idPrefix}-subtotal`}>{formatRupiah(subtotal)}</Text>
          </Flex>

          {shipping}

          <Separator />

          <Flex align="center" gap="card">
            <Text fontWeight="semibold">{t("orders.total")}</Text>
            <Text fontWeight="semibold" data-testid={`${idPrefix}-total`}>
              {formatRupiah(total)}
            </Text>
          </Flex>

          {/* The submit sits WITH the total, not at the bottom of the page. On a long order the button
              used to be several screens below the number it commits, so the last thing seen before
              placing an order was a line item rather than what the buyer is paying. */}
          {action}
        </Stack>
      </Card.Body>
    </Card.Root>
  );
}
