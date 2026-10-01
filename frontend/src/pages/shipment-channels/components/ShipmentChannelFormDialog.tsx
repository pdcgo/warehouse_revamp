import { useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button, CloseButton, Dialog, Field, Input, Portal, Stack, Text, Textarea } from "@chakra-ui/react";
import { rpcError } from "../../../api/clients";
import type { ShipmentChannel } from "../../../gen/warehouse/shipment/v1/shipment_pb";
import { toaster } from "../../../components/feedback/Toaster";
import { useCreateShipmentChannel, useUpdateShipmentChannel } from "../../../features/shipment/queries";

// Creates OR edits a shipment channel. Root only (only-root-manages-channels).
//
//  - create — `channel` undefined; renders its own "New Channel" trigger. Code, name, desc.
//  - edit — `channel` set; controlled. The code is SHOWN, read-only, and never sent: the third-party
//    app maps onto it, so it cannot change (a-code-never-changes).
//
// A create whose code already exists — even on a DELETED channel — is refused by the server with a
// message pointing at restore (a-deleted-code-is-restored-not-recreated). The dialog shows it as-is.
export function ShipmentChannelFormDialog({
  channel,
  open: openProp,
  onOpenChange,
}: {
  channel?: ShipmentChannel;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
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

  const create = useCreateShipmentChannel();
  const update = useUpdateShipmentChannel();
  const busy = create.isPending || update.isPending;

  const [error, setError] = useState("");
  const [code, setCode] = useState(channel?.code ?? "");
  const [name, setName] = useState(channel?.name ?? "");
  const [desc, setDesc] = useState(channel?.desc ?? "");

  const canSave = (editing || code.trim() !== "") && name.trim() !== "";

  function reset() {
    setCode("");
    setName("");
    setDesc("");
    setError("");
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setError("");

    const onError = (err: unknown) => setError(rpcError(err));

    if (channel) {
      update.mutate(
        { channelId: channel.id, name, desc },
        {
          onSuccess: () => {
            toaster.create({ type: "success", title: t("shipmentChannels.updatedToast", { name }) });
            setOpen(false);
          },
          onError,
        },
      );
      return;
    }

    create.mutate(
      { code: code.trim(), name, desc },
      {
        onSuccess: () => {
          toaster.create({ type: "success", title: t("shipmentChannels.createdToast", { name }) });
          reset();
          setOpen(false);
        },
        onError,
      },
    );
  }

  return (
    <Dialog.Root open={open} onOpenChange={(e) => setOpen(e.open)}>
      {!isControlled && (
        <Dialog.Trigger asChild>
          <Button size="xs" colorPalette="brand" data-testid="open-create-shipment-channel">
            {t("shipmentChannels.newChannel")}
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
                  {editing ? t("shipmentChannels.editTitle", { name: channel.name }) : t("shipmentChannels.newTitle")}
                </Dialog.Title>
              </Dialog.Header>

              <Dialog.Body>
                <Stack gap="card">
                  {error && (
                    <Text color="red.fg" data-testid="shipment-channel-form-error">
                      {error}
                    </Text>
                  )}

                  <Field.Root required={!editing} readOnly={editing}>
                    <Field.Label>{t("shipmentChannels.code")}</Field.Label>
                    <Input
                      value={code}
                      readOnly={editing}
                      placeholder="jne"
                      data-testid="shipment-channel-code"
                      onChange={(e) => setCode(e.target.value.toLowerCase())}
                    />
                    <Field.HelperText>
                      {editing ? t("shipmentChannels.codeHelpEdit") : t("shipmentChannels.codeHelpCreate")}
                    </Field.HelperText>
                  </Field.Root>

                  <Field.Root required>
                    <Field.Label>{t("shipmentChannels.name")}</Field.Label>
                    <Input
                      value={name}
                      placeholder="JNE"
                      data-testid="shipment-channel-name"
                      onChange={(e) => setName(e.target.value)}
                    />
                  </Field.Root>

                  <Field.Root>
                    <Field.Label>{t("shipmentChannels.desc")}</Field.Label>
                    <Textarea
                      value={desc}
                      data-testid="shipment-channel-desc"
                      onChange={(e) => setDesc(e.target.value)}
                    />
                  </Field.Root>
                </Stack>
              </Dialog.Body>

              <Dialog.Footer>
                <Dialog.ActionTrigger asChild>
                  <Button variant="outline" type="button">
                    {t("shipmentChannels.cancel")}
                  </Button>
                </Dialog.ActionTrigger>
                <Button
                  type="submit"
                  colorPalette="brand"
                  loading={busy}
                  disabled={!canSave}
                  data-testid="shipment-channel-save"
                >
                  {t("shipmentChannels.save")}
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
