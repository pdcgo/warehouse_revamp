import { useMemo } from "react";
import type { Dispatch } from "react";
import { useTranslation } from "react-i18next";
import { Button, Card, Field, Flex, SimpleGrid, Stack, Text } from "@chakra-ui/react";

import { MarketplaceBadge, marketplaceLabel } from "../../../components/badges/MarketplaceBadge";
import { DatePicker } from "../../../components/datetime/DatePicker";
import { CurrencyInput } from "../../../components/inputs/CurrencyInput";
import { MarketplaceInfoForm } from "../../../components/orders/MarketplaceInfoForm";
import type { MarketplaceInfoValue } from "../../../components/orders/MarketplaceInfoForm";
import { suggestMarketplace } from "../../../features/orders/form/checks";
import type { OrderFormAction, orderFormActions } from "../formState";

// THE ORDER INFORMATION CARD — the shop, the storefront's reference suggestion, the sell price and when the order
// happened: the page's own card, moved out of `OrderCreatePage` whole (#135) so it is memoised like the others
// (memoCards.ts) and a key typed in another card does not render its calendar. It reads only its slice of the form —
// the marketplace side and the order date — and writes through the form's stable setters.
export function OrderInfoCard({
  teamId,
  marketplace,
  orderDate,
  today,
  act,
  dispatch,
}: {
  teamId: bigint;
  marketplace: MarketplaceInfoValue;
  orderDate: string;
  /** Today, as the page read it on its last render — the order date's `max` (never in the future). */
  today: string;
  act: ReturnType<typeof orderFormActions>;
  dispatch: Dispatch<OrderFormAction>;
}) {
  const { t } = useTranslation();

  // WHICH STOREFRONT THE REFERENCE LOOKS LIKE (owner, rule 4) — offered only when the format names
  // exactly one and it is not the one already chosen. A suggestion that agrees with the field is
  // noise; one that cannot decide is a guess.
  const suggestedMarketplace = useMemo(() => {
    const hit = suggestMarketplace(marketplace.orderExternalRefId);
    return hit !== undefined && hit !== marketplace.marketplace ? hit : undefined;
  }, [marketplace.orderExternalRefId, marketplace.marketplace]);

  return (
    <Card.Root>
      {/* ORDER INFORMATION (owner) — the live form calls this card "Shop & Warehouse",
          which named its two controls. It now also carries the storefront's reference, what
          the storefront took and WHEN the order happened, and those are not a shop or a
          warehouse: they are what identifies this order. The live page keeps its own title
          (its key is untouched); this one is named for what it holds. */}
      <Card.Header>
        <Card.Title>{t("orderForm.source.title")}</Card.Title>
        <Card.Description>{t("orderForm.source.help")}</Card.Description>
      </Card.Header>
      <Card.Body>
        <SimpleGrid columns={{ base: 1, md: 2 }} gap="card" alignItems="start">
          <Stack gap="card">
            {/* ⚠ WITHOUT ITS MONEY FIELD. The same number is collected below under the name
                the rest of this screen uses for it — see the note there. */}
            <MarketplaceInfoForm
              teamId={teamId}
              value={marketplace}
              onChange={act.marketplace}
              required
              hideTotal
              hideOrderRef
            />

            {/* ⚠ WHAT THE REFERENCE LOOKS LIKE (owner, rule 4). One click applies it; it
                never applies itself, because a storefront chosen by a pattern is still a
                guess and the shop list below is scoped by this field. */}
            {suggestedMarketplace !== undefined && (
              <Flex align="center" gap="2" wrap="wrap" data-testid="order-marketplace-suggestion">
                <Text fontSize="xs" color="fg.muted">
                  {t("orderForm.source.looksLike")}
                </Text>
                <MarketplaceBadge marketplace={suggestedMarketplace} size="sm" />
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  data-testid="order-marketplace-suggestion-apply"
                  onClick={() =>
                    dispatch({ type: "marketplacePatch", patch: { marketplace: suggestedMarketplace } })
                  }
                >
                  {t("orderForm.source.useIt", { name: marketplaceLabel(suggestedMarketplace) })}
                </Button>
              </Flex>
            )}

            {/* ONE NAME FOR ONE NUMBER: HARGA JUAL / SELL PRICE (owner).
                The live form calls this "Marketplace order total" while the profit panel
                calls the same figure the sell price — two words for one thing on one screen,
                and the person has to work out they are the same. The sell price wins: it is
                what the customer paid, which is what the margin is measured against. */}
            {/* REQUIRED (platform-total-is-required-at-finalize) — read off the storefront like the order
                date, and Create stays off until it is there. */}
            <Field.Root required>
              <Field.Label>
                {t("orderForm.source.sellPrice")}
                <Field.RequiredIndicator />
              </Field.Label>
              <CurrencyInput
                fraction
                value={marketplace.platformTotal}
                data-testid="order-marketplace-total"
                onChange={act.sellPrice}
              />
              <Field.HelperText>{t("orderForm.source.sellPriceHelp")}</Field.HelperText>
            </Field.Root>
          </Stack>

          <Stack gap="card">
            {/* ⚠ THE WAREHOUSE IS NOT HERE ANY MORE (owner). It was the odd one out: every
                other field on this card is a fact ABOUT the order, while the building is what
                the whole screen is measured against. It leads the page now — see
                WarehouseBand. */}

            {/* WHEN THE CUSTOMER BOUGHT IT (owner) — part of the order's own information,
                so it sits with the shop and the storefront's reference rather than with the
                delivery deadline further down. The two dates answer opposite questions: this
                one is when it happened, that one is when it must arrive. */}
            {/* REQUIRED (platform-created-at-is-required-at-finalize): every order comes from a platform,
                and the person reads this off the same storefront page as the ref. */}
            <Field.Root required>
              <Field.Label>
                {t("orderForm.source.orderDate")}
                <Field.RequiredIndicator />
              </Field.Label>
              {/* WITH THE CLOCK (owner). A marketplace stamps an order to the minute, and
                  two orders on one morning are told apart by nothing else — so the field
                  that records WHEN IT HAPPENED carries a time. */}
              {/* ⚠ NEVER IN THE FUTURE (owner). An order is typed in AFTER it happened —
                  at best a minute later, at worst two days — so a date past today is a typo
                  every time, and one that would file the order under a day it has not
                  reached yet. */}
              <DatePicker
                value={orderDate}
                onChange={act.orderDate}
                withTime
                clearable
                max={today}
                testId="order-create-order-date"
              />
              <Field.HelperText>{t("orderForm.source.orderDateHelp")}</Field.HelperText>
            </Field.Root>
          </Stack>
        </SimpleGrid>
      </Card.Body>
    </Card.Root>
  );
}
