import { Heading, Icon, Stack, Text, VStack } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { ClipboardCheck } from "lucide-react";

// OpnamePage is a deliberate STUB. "Stock opname" is a physical stock count reconciled against the
// system — count a shelf, record what is really there, post the corrections. It is a warehouse-core
// concern (plans/plan.md) and is not designed yet. The route and menu item exist so the Inventories
// sub-menu is complete; this is where it lands until the opname flow is designed.
export function OpnamePage() {
  const { t } = useTranslation();

  return (
    <Stack gap="section" data-testid="opname-page">
      <Heading size="md">{t("inventory.opnameTitle")}</Heading>

      <VStack gap="card" py="10" color="fg.muted">
        <Icon as={ClipboardCheck} boxSize="8" />
        <Text fontWeight="medium">{t("inventory.opnameComingSoon")}</Text>
        <Text fontSize="sm" maxW="md" textAlign="center">
          {t("inventory.opnameBody")}
        </Text>
      </VStack>
    </Stack>
  );
}
