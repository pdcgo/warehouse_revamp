import { useTranslation } from "react-i18next";
import { Card, Field, Stack, Text } from "@chakra-ui/react";
import { CurrencyInput } from "../../../components/inputs/CurrencyInput";

// WHAT THE ORDER SOLD FOR ON THE MARKETPLACE — its own card (owner), and the separation is the
// point rather than tidiness.
//
// It used to lead the totals card, above the separator, with a line of help explaining that it was
// not in the sum. That is a lot of words to undo a position: a money field sitting at the top of a
// column headed by a Total reads as a term of it, whatever the caption says. In its own card it is
// simply a different fact — what the storefront actually took, after its vouchers, coin subsidies
// and promotions — recorded beside the arithmetic instead of inside it.
//
// ⚠ Nothing computes from it. `total` remains subtotal + shipping, and margin remains
// `total − cogs − shipping_cost`; folding this in would count the same sale twice.
export function MarketplaceTotal({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <Card.Root>
      <Card.Body>
        <Stack gap="card">
          <Text fontWeight="medium">{t("orders.marketplaceTotal")}</Text>

          <Field.Root>
            <CurrencyInput
              value={value}
              data-testid="order-create-marketplace-total"
              onChange={onChange}
            />
            <Field.HelperText>{t("orders.marketplaceTotalHelp")}</Field.HelperText>
          </Field.Root>
        </Stack>
      </Card.Body>
    </Card.Root>
  );
}
