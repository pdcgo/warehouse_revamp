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
import { rpcError } from "../api/clients";
import type { Shipping } from "../gen/warehouse/shipping/v1/shipping_pb";
import { toaster } from "../components/Toaster";
import { useShippingChannels, useUpdateShipping } from "./queries";
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

  // The flip shares the rename's hook: both are ShippingUpdate with a partial patch, and both make
  // the same two caches stale — which the hook, not this page, now declares (#177).
  const updateShipping = useUpdateShipping();

  const channels = query.data ?? [];
  const loading = query.isPending;
  const error = query.isError ? rpcError(query.error) : "";

  // Deactivate/reactivate is a reversible flip of `active`, so it needs no confirm (unlike a
  // destructive delete). The row is never removed — a retired courier is still referenced by
  // historical shipments.
  function toggleActive(channel: Shipping) {
    const next = !channel.active;

    updateShipping.mutate(
      { shippingId: channel.id, active: next },
      {
        onSuccess: () => {
          toaster.create({
            type: "success",
            title: next
              ? t("catalog.shipping.activatedToast", { name: channel.name })
              : t("catalog.shipping.deactivatedToast", { name: channel.name }),
          });
        },
        onError: (err) => {
          toaster.create({
            type: "error",
            title: t("catalog.updateFailed"),
            description: rpcError(err),
          });
        },
      },
    );
  }

  return (
    <Stack gap="section">
      <Flex align="center" gap="card">
        <Heading size="md">{t("catalog.shipping.title")}</Heading>
        <Spacer />
        <CreateShippingDialog />
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
                    <EditShippingDialog shipping={channel} />

                    <IconButton
                      size="xs"
                      variant="ghost"
                      colorPalette={channel.active ? "red" : "green"}
                      aria-label={channel.active ? "Deactivate" : "Activate"}
                      data-testid={`toggle-channel-${channel.id}`}
                      onClick={() => toggleActive(channel)}
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
