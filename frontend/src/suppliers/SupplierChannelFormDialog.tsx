import { useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  Box,
  Button,
  CloseButton,
  Dialog,
  Field,
  Icon,
  Input,
  NativeSelect,
  Portal,
  Stack,
  Text,
} from "@chakra-ui/react";
import { Plus } from "lucide-react";
import { rpcError } from "../api/clients";
import type { SupplierChannel } from "../gen/warehouse/inventory/v1/supplier_channel_pb";
import { SupplierChannelType } from "../gen/warehouse/inventory/v1/supplier_channel_pb";
import { Marketplace } from "../gen/warehouse/marketplace/v1/marketplace_pb";
import { useTeam } from "../team/TeamContext";
import { MarketplaceSelect } from "../components/MarketplaceSelect";
import { toaster } from "../components/Toaster";
import { useSaveSupplierChannel } from "./queries";

// SupplierChannelFormDialog creates OR edits a channel of one supplier (#120) — the way a team reaches
// that vendor. Two shapes, one form, chosen by the Type toggle:
//  - ONLINE  — a store on a marketplace: a marketplace (required) + a name + an optional url.
//  - OFFLINE — a physical shop: a name (required) + a contact + a location.
//
// The team is the scope: it travels in the message body (the backend's use_scope reads it there,
// never a header). The supplier is fixed by the page the dialog opens from.
//
// Two modes:
//  - create — `channel` undefined; the dialog renders its own "Add Channel" trigger.
//  - edit — `channel` set; the dialog is controlled (open/onOpenChange), pre-filled, calls Update.
export function SupplierChannelFormDialog({
  supplierId,
  channel,
  open: openProp,
  onOpenChange,
}: {
  supplierId: bigint;
  channel?: SupplierChannel;
  open?: boolean;
  /**
   * The dialog's open state changed — including the close that follows a successful save.
   *
   * LIFECYCLE ONLY. It used to be joined by an `onDone` that existed purely so the page could refetch
   * (#177); the write now invalidates the cache itself, so the parent is told the dialog closed and
   * nothing more. In edit mode that is what clears `editing`.
   */
  onOpenChange?: (open: boolean) => void;
}) {
  const { current } = useTeam();
  const { t } = useTranslation();

  const editing = channel !== undefined;
  const isControlled = openProp !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = isControlled ? openProp : uncontrolledOpen;

  function setOpen(next: boolean) {
    if (isControlled) {
      onOpenChange?.(next);
    } else {
      setUncontrolledOpen(next);
    }
  }

  const [error, setError] = useState("");

  // The write, and what it invalidates, declared together in queries.ts (#177). There is no `busy`
  // beside it: the mutation already knows whether it is in flight, and a second flag is a second
  // answer to the same question that can disagree with the first.
  const save = useSaveSupplierChannel();
  const busy = save.isPending;

  // Default to ONLINE — a marketplace store is the common case for these teams.
  const [online, setOnline] = useState(channel ? channel.type !== SupplierChannelType.OFFLINE : true);
  const [marketplace, setMarketplace] = useState<Marketplace>(channel?.marketplace ?? Marketplace.UNSPECIFIED);
  const [name, setName] = useState(channel?.name ?? "");
  const [url, setUrl] = useState(channel?.url ?? "");
  const [contact, setContact] = useState(channel?.contact ?? "");
  const [location, setLocation] = useState(channel?.location ?? "");

  // Name is always required; an online channel additionally needs a marketplace picked.
  const canSave = name.trim() !== "" && (!online || marketplace !== Marketplace.UNSPECIFIED);

  function submit(event: FormEvent) {
    event.preventDefault();

    if (!current) {
      return;
    }

    setError("");

    // A channel is one shape or the other: never send an offline channel a marketplace, and never
    // send an online one a location. The backend enforces the same pairing.
    const type = online ? SupplierChannelType.ONLINE : SupplierChannelType.OFFLINE;

    save.mutate(
      {
        teamId: current.teamId,
        // The supplier is only read on create — an update names the channel. Both travel, and the
        // hook picks the RPC by whether there is a channel to correct.
        supplierId,
        channelId: channel?.id,
        type,
        marketplace: online ? marketplace : Marketplace.UNSPECIFIED,
        name,
        url: online ? url : "",
        contact,
        location: online ? "" : location,
      },
      {
        onSuccess: () => {
          if (editing) {
            toaster.create({ type: "success", title: t("supplierChannel.form.saved") });
          } else {
            toaster.create({ type: "success", title: t("supplierChannel.form.created", { name }) });

            // Only after a CREATE: the trigger stays on screen, so the next "Add Channel" must open
            // an empty form rather than the channel that was just added.
            setOnline(true);
            setMarketplace(Marketplace.UNSPECIFIED);
            setName("");
            setUrl("");
            setContact("");
            setLocation("");
          }

          // Closing is what tells the parent the dialog is gone — in edit mode that is what clears
          // `editing`. It is NOT a refetch signal: the hook already invalidated before this ran.
          setOpen(false);
        },
        onError: (err) => setError(rpcError(err)),
      },
    );
  }

  return (
    <Dialog.Root open={open} onOpenChange={(e) => setOpen(e.open)}>
      {!isControlled && (
        <Dialog.Trigger asChild>
          <Button size="xs" colorPalette="brand" data-testid="add-channel">
            <Icon as={Plus} boxSize="4" />
            {t("supplierChannel.form.addChannel")}
          </Button>
        </Dialog.Trigger>
      )}

      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <form onSubmit={submit}>
              <Dialog.Header>
                <Dialog.Title>
                  {editing ? t("supplierChannel.form.editTitle") : t("supplierChannel.form.createTitle")}
                </Dialog.Title>
              </Dialog.Header>

              <Dialog.Body>
                <Stack gap="card">
                  {error && (
                    <Text color="red.fg" data-testid="channel-form-error">
                      {error}
                    </Text>
                  )}

                  <Field.Root>
                    <Field.Label>{t("supplierChannel.form.type")}</Field.Label>
                    <NativeSelect.Root>
                      <NativeSelect.Field
                        value={online ? "online" : "offline"}
                        data-testid="channel-type"
                        onChange={(e) => setOnline(e.currentTarget.value === "online")}
                      >
                        <option value="online">{t("supplierChannel.type.online")}</option>
                        <option value="offline">{t("supplierChannel.type.offline")}</option>
                      </NativeSelect.Field>
                      <NativeSelect.Indicator />
                    </NativeSelect.Root>
                  </Field.Root>

                  {online && (
                    <Field.Root required>
                      <Field.Label>{t("supplierChannel.form.marketplace")}</Field.Label>
                      <Box w="full" data-testid="channel-marketplace">
                        <MarketplaceSelect value={marketplace} onChange={setMarketplace} />
                      </Box>
                    </Field.Root>
                  )}

                  <Field.Root required>
                    <Field.Label>{t("supplierChannel.form.name")}</Field.Label>
                    <Input value={name} data-testid="channel-name" onChange={(e) => setName(e.target.value)} />
                  </Field.Root>

                  {online ? (
                    <Field.Root>
                      <Field.Label>{t("supplierChannel.form.url")}</Field.Label>
                      <Input
                        value={url}
                        data-testid="channel-url"
                        onChange={(e) => setUrl(e.target.value)}
                      />
                    </Field.Root>
                  ) : (
                    <>
                      <Field.Root>
                        <Field.Label>{t("supplierChannel.form.contact")}</Field.Label>
                        <Input
                          value={contact}
                          data-testid="channel-contact"
                          onChange={(e) => setContact(e.target.value)}
                        />
                      </Field.Root>

                      <Field.Root>
                        <Field.Label>{t("supplierChannel.form.location")}</Field.Label>
                        <Input
                          value={location}
                          data-testid="channel-location"
                          onChange={(e) => setLocation(e.target.value)}
                        />
                      </Field.Root>
                    </>
                  )}
                </Stack>
              </Dialog.Body>

              <Dialog.Footer>
                <Dialog.ActionTrigger asChild>
                  <Button variant="outline">{t("supplierChannel.form.cancel")}</Button>
                </Dialog.ActionTrigger>

                <Button
                  type="submit"
                  colorPalette="brand"
                  loading={busy}
                  disabled={!canSave}
                  data-testid="submit-channel"
                >
                  {editing ? t("supplierChannel.form.save") : t("supplierChannel.form.create")}
                </Button>
              </Dialog.Footer>

              <Dialog.CloseTrigger asChild>
                <CloseButton size="sm" />
              </Dialog.CloseTrigger>
            </form>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
