import { Heading, Icon, Stack, Text, VStack } from "@chakra-ui/react";
import { MapPin } from "lucide-react";

// PlacementsPage is a deliberate STUB (#95). "Placements" means where stock physically sits — rack
// and bin locations — which belongs to the warehouse core (plans/plan.md §1) and is not designed
// yet. The route and menu item exist so the Inventories sub-menu is complete; this is where it lands
// until warehouse locations are designed.
export function PlacementsPage() {
  return (
    <Stack gap="section" data-testid="placements-page">
      <Heading size="md">Placements</Heading>

      <VStack gap="card" py="10" color="fg.muted">
        <Icon as={MapPin} boxSize="8" />
        <Text fontWeight="medium">Placements are coming soon</Text>
        <Text fontSize="sm" maxW="md" textAlign="center">
          Stock locations — racks and bins — will live here once the warehouse layout is designed.
        </Text>
      </VStack>
    </Stack>
  );
}
