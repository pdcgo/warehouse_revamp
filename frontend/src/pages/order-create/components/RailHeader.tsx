import { useTranslation } from "react-i18next";
import { Button, Flex, Icon, Text } from "@chakra-ui/react";
import { ChevronsDownUp, ChevronsUpDown } from "lucide-react";

// THE RAIL'S OWN HEADER — its name and the one toggle that collapses the three money cards. Moved out of
// `OrderCreatePage` (#135) and memoised (memoCards.ts): it renders when the toggle or the lock changes, not on every
// key. The argument for its shape is the page's, where it is drawn.
export function RailHeader({
  compact,
  onToggle,
  fade,
}: {
  compact: boolean;
  onToggle: () => void;
  /** The locked look — the page's `lockFade`. */
  fade: { opacity?: number; transition: string };
}) {
  const { t } = useTranslation();

  return (
    <Flex justify="space-between" align="center" gap="2" {...fade}>
      <Text fontSize="sm" fontWeight="bold" color="fg.muted">
        {t("orderForm.rail.title")}
      </Text>
      <Button
        type="button"
        size="xs"
        variant="outline"
        data-testid="order-create-rail-compact"
        onClick={onToggle}
      >
        <Icon as={compact ? ChevronsUpDown : ChevronsDownUp} boxSize="4" />
        {t(compact ? "orderForm.rail.expand" : "orderForm.rail.collapse")}
      </Button>
    </Flex>
  );
}
