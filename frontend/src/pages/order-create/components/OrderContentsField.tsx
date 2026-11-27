import { useTranslation } from "react-i18next";
import { Stack, Text } from "@chakra-ui/react";

import { RadioPills } from "../../../components/inputs/RadioPills";
import type { OrderContents, orderFormActions } from "../formState";

// ITEMS OR BUNDLES — the radio pill that picks which card the order is filled from (an-order-holds-items-or-bundles).
// Moved out of `OrderCreatePage` (#135) and memoised (memoCards.ts): it renders when the choice changes, not on every
// key.
export function OrderContentsField({
  contents,
  act,
}: {
  contents: OrderContents;
  act: ReturnType<typeof orderFormActions>;
}) {
  const { t } = useTranslation();

  return (
    <Stack gap="1.5" data-testid="order-contents-field">
      <Text fontSize="xs" fontWeight="bold" color="fg.label">
        {t("orderForm.contents.label")}
      </Text>
      <RadioPills
        value={contents}
        onChange={act.chooseContents}
        ariaLabel={t("orderForm.contents.label")}
        testId="order-contents"
        options={[
          { value: "items", label: t("orderForm.contents.items"), testId: "order-contents-items" },
          { value: "bundles", label: t("orderForm.contents.bundles"), testId: "order-contents-bundles" },
        ]}
      />
    </Stack>
  );
}
