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
  Portal,
  Stack,
  Text,
  Textarea,
} from "@chakra-ui/react";
import { Plus } from "lucide-react";
import { rpcError } from "../../../api/clients";
import type { SupplierChannelRecord } from "../../../features/suppliers/adapt";
import { Marketplace } from "../../../gen/warehouse/marketplace/v1/marketplace_pb";
import { useTeam } from "../../../features/team/TeamContext";
import { MarketplaceSelect } from "../../../components/pickers/MarketplaceSelect";
import { toaster } from "../../../components/feedback/Toaster";
import { useSaveSupplierChannel } from "../../../features/suppliers/queries";

// SupplierChannelFormDialog creates OR edits one CHANNEL of a supplier — one store it sells through
// (the-supplier-lists-only-its-online-stores): a channel type, a name, a link and a description. There is
// no online/offline switch any more — a physical vendor is reached through the supplier's own contact and
// address. The type is the shared marketplace list (channel-type-is-the-marketplace-list); the owner's
// `custom` is its Other.
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
  channel?: SupplierChannelRecord;
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

  const [channelType, setChannelType] = useState<Marketplace>(channel?.channelType ?? Marketplace.UNSPECIFIED);
  const [name, setName] = useState(channel?.name ?? "");
  const [uri, setUri] = useState(channel?.uri ?? "");
  const [description, setDescription] = useState(channel?.description ?? "");

  // A channel needs its type and its name; the link and the description are optional.
  const canSave = name.trim() !== "" && channelType !== Marketplace.UNSPECIFIED;

  function submit(event: FormEvent) {
    event.preventDefault();

    if (!current) {
      return;
    }

    setError("");

    save.mutate(
      {
        teamId: current.teamId,
        // The supplier is only read on create — an update names the channel. Both travel, and the
        // hook picks the RPC by whether there is a channel to correct.
        supplierId,
        channelId: channel?.id,
        channelType,
        name,
        uri,
        description,
      },
      {
        onSuccess: () => {
          if (editing) {
            toaster.create({ type: "success", title: t("supplierChannel.form.saved") });
          } else {
            toaster.create({ type: "success", title: t("supplierChannel.form.created", { name }) });

            // Only after a CREATE: the trigger stays on screen, so the next "Add Channel" must open
            // an empty form rather than the channel that was just added.
            setChannelType(Marketplace.UNSPECIFIED);
            setName("");
            setUri("");
            setDescription("");
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
                    <Text color="error.fg" data-testid="channel-form-error">
                      {error}
                    </Text>
                  )}

                  <Field.Root required>
                    <Field.Label>
                      {t("supplierChannel.form.channelType")}
                      <Field.RequiredIndicator />
                    </Field.Label>
                    <Box w="full" data-testid="channel-type">
                      <MarketplaceSelect
                        value={channelType}
                        onChange={setChannelType}
                        placeholder={t("supplierChannel.form.channelTypePlaceholder")}
                      />
                    </Box>
                  </Field.Root>

                  <Field.Root required>
                    <Field.Label>
                      {t("supplierChannel.form.name")}
                      <Field.RequiredIndicator />
                    </Field.Label>
                    {/* An example in every field (owner: *"tambah toko kasih placeholder"*, the add-supplier form's
                        the-add-supplier-form-shows-examples) — shown only while the field is empty. */}
                    <Input
                      value={name}
                      placeholder={t("supplierChannel.form.namePlaceholder")}
                      data-testid="channel-name"
                      onChange={(e) => setName(e.target.value)}
                    />
                    <Field.HelperText>{t("supplierChannel.form.nameHelp")}</Field.HelperText>
                  </Field.Root>

                  <Field.Root>
                    <Field.Label>{t("supplierChannel.form.uri")}</Field.Label>
                    <Input
                      value={uri}
                      placeholder={t("supplierChannel.form.uriPlaceholder")}
                      data-testid="channel-uri"
                      onChange={(e) => setUri(e.target.value)}
                    />
                  </Field.Root>

                  <Field.Root>
                    <Field.Label>{t("supplierChannel.form.description")}</Field.Label>
                    <Textarea
                      value={description}
                      rows={2}
                      placeholder={t("supplierChannel.form.descriptionPlaceholder")}
                      data-testid="channel-description"
                      onChange={(e) => setDescription(e.target.value)}
                    />
                  </Field.Root>
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
