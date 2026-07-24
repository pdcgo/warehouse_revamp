import { Heading, Icon, Stack, Text, VStack } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { MapPin } from "lucide-react";

// PlacementsPage is a deliberate STUB (#95). "Placements" means where stock physically sits — rack
// and bin locations — which belongs to the warehouse core (plans/plan.md §1) and is not designed
// yet. The route and menu item exist so the Inventories sub-menu is complete; this is where it lands
// until warehouse locations are designed.
export function PlacementsPage() {
  const { t } = useTranslation();

  return (
    <Stack gap="section" data-testid="placements-page">
      <Heading size="md">{t("inventory.placementsTitle")}</Heading>

      <VStack gap="card" py="10" color="fg.muted">
        <Icon as={MapPin} boxSize="8" />
        <Text fontWeight="medium">{t("inventory.placementsComingSoon")}</Text>
        <Text fontSize="sm" maxW="md" textAlign="center">
          {t("inventory.placementsBody")}
        </Text>
      </VStack>
    </Stack>
  );
}
