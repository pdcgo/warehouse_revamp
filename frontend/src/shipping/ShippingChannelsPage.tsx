import { useCallback } from "react";
import {
  Badge,
  Flex,
  HStack,
  Heading,
  Icon,
  IconButton,
  Spacer,
  Spinner,
  Stack,
  Table,
  Text,
} from "@chakra-ui/react";
import { Power, PowerOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { rpcError, shippingClient } from "../api/clients";
import type { Shipping } from "../gen/warehouse/shipping/v1/shipping_pb";
import { toaster } from "../components/Toaster";
import { useShippingChannels, useInvalidateShipping } from "./queries";
import { invalidateShippingCatalogue } from "./catalogue";
import { CreateShippingDialog } from "./CreateShippingDialog";
import { EditShippingDialog } from "./EditShippingDialog";

// ShippingChannelsPage manages the GLOBAL courier catalogue — one shared list curated by root/admin
// (see the nav gate). It is not team-scoped. The table lists ALL channels (include_inactive) so a
// retired courier can be reactivated; the Status badge tells them apart.
export function ShippingChannelsPage() {
  const { t } = useTranslation();
  // `includeInactive: true` — this is the MANAGEMENT view, so it must show retired couriers. It is
  // in the query key, so it cannot collide with a picker's active-only list (see queries.ts).
  const query = useShippingChannels({ includeInactive: true });
  const invalidateShipping = useInvalidateShipping();

  const channels = query.data ?? [];
  const loading = query.isPending;
  const error = query.isError ? rpcError(query.error) : "";

  // TWO caches, and both must be dropped. This page is the only thing that CHANGES the catalogue,
  // and ShippingSelect/ShippingBadge read it from their own session-long cache rather than through
  // TanStack — so clearing only the query would leave a renamed courier showing its old name in
  // every badge until a full reload. That second cache predates this epic and is untouched by it.
  const refresh = useCallback(async () => {
    invalidateShippingCatalogue();
    await invalidateShipping();
  }, [invalidateShipping]);

  // Deactivate/reactivate is a reversible flip of `active`, so it needs no confirm (unlike a
  // destructive delete). The row is never removed — a retired courier is still referenced by
  // historical shipments.
  async function toggleActive(channel: Shipping) {
    const next = !channel.active;

    try {
      await shippingClient.shippingUpdate({ shippingId: channel.id, active: next });
      toaster.create({
        type: "success",
        title: next
          ? t("catalog.shipping.activatedToast", { name: channel.name })
          : t("catalog.shipping.deactivatedToast", { name: channel.name }),
      });
      await refresh();
    } catch (err) {
      toaster.create({ type: "error", title: t("catalog.updateFailed"), description: rpcError(err) });
    }
  }

  return (
    <Stack gap="section">
      <Flex align="center" gap="card">
        <Heading size="md">{t("catalog.shipping.title")}</Heading>
        <Spacer />
        <CreateShippingDialog onDone={() => void refresh()} />
      </Flex>

      {error && (
        <Text color="red.fg" data-testid="shipping-channels-error">
          {error}
        </Text>
      )}

      {loading ? (
        <Spinner colorPalette="brand" />
      ) : (
        <Table.Root size="sm" data-testid="shipping-channels-table">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>{t("catalog.shipping.code")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("catalog.name")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("catalog.shipping.status")}</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">{t("catalog.actions")}</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>

          <Table.Body>
            {channels.map((channel) => (
              <Table.Row key={channel.id.toString()} data-testid={`channel-row-${channel.code}`}>
                <Table.Cell>{channel.code}</Table.Cell>
                <Table.Cell>{channel.name}</Table.Cell>
                <Table.Cell>
                  <Badge colorPalette={channel.active ? "green" : "gray"}>
                    {channel.active ? t("catalog.shipping.active") : t("catalog.shipping.inactive")}
                  </Badge>
                </Table.Cell>

                <Table.Cell textAlign="end">
                  <HStack justify="end" gap="1">
                    <EditShippingDialog shipping={channel} onDone={() => void refresh()} />

                    <IconButton
                      size="xs"
                      variant="ghost"
                      colorPalette={channel.active ? "red" : "green"}
                      aria-label={channel.active ? "Deactivate" : "Activate"}
                      data-testid={`toggle-channel-${channel.id}`}
                      onClick={() => void toggleActive(channel)}
                    >
                      <Icon as={channel.active ? PowerOff : Power} boxSize="4" />
                    </IconButton>
                  </HStack>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      )}

      {!loading && channels.length === 0 && !error && (
        <Text color="fg.muted" data-testid="shipping-channels-empty">
          {t("catalog.shipping.empty")}
        </Text>
      )}
    </Stack>
  );
}
