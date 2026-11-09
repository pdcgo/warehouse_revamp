import { Box, HStack, Icon, Stack, Text } from "@chakra-ui/react";
import { MapPin } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { OrderAddress } from "../../../gen/warehouse/selling/v1/order_pb";

// THE DRAFT'S ADDRESS, AS THE MARKETPLACE WROTE IT (the-cs-edits-the-whole-address-before-create) — read beside the
// editable picker, so the person can check the region levels the form pre-filled, or pick them when it could not
// (a name no single region-list place matches). Text only: nothing here is an input, and nothing in it is sent — what
// is created is what the person leaves in the form. The draft-hint sand of the products card above
// (the-draft-opens-in-the-order-form): the outside's words, not ours.
export function DraftAddressText({ address }: { address?: OrderAddress }) {
  const { t } = useTranslation();

  const street = address?.addressLine.trim() ?? "";
  const region = [address?.desaName, address?.kecamatanName, address?.kabupatenName, address?.provinsiName]
    .map((part) => part?.trim() ?? "")
    .filter(Boolean)
    .join(", ");
  const postcode = address?.kodePos.trim() ?? "";
  const place = [region, postcode].filter(Boolean).join(" ");

  return (
    <Box
      bg="draftHint.bg"
      borderWidth="1px"
      borderColor="draftHint.border"
      borderRadius="l2"
      px="3"
      py="2"
      data-testid="draft-address-text"
    >
      <HStack gap="1.5" color="draftHint.fg" mb="1">
        <Icon as={MapPin} boxSize="3.5" />
        <Text fontSize="xs" fontWeight="semibold">
          {t("orderForm.draftAddress.title")}
        </Text>
      </HStack>
      {street || place ? (
        <Stack gap="0" fontSize="sm">
          {street && <Text data-testid="draft-address-text-street">{street}</Text>}
          {place && <Text data-testid="draft-address-text-place">{place}</Text>}
        </Stack>
      ) : (
        <Text fontSize="sm" color="fg.muted" data-testid="draft-address-text-none">
          {t("orderForm.draftAddress.none")}
        </Text>
      )}
    </Box>
  );
}
