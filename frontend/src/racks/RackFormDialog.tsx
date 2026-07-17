import { useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  CloseButton,
  Dialog,
  Field,
  Input,
  Portal,
  Stack,
  Text,
} from "@chakra-ui/react";
import { Code, ConnectError } from "@connectrpc/connect";
import { rackClient, rpcError } from "../api/clients";
import type { Rack } from "../gen/warehouse/inventory/v1/rack_pb";
import { useTeam } from "../team/TeamContext";
import { toaster } from "../components/Toaster";

// RackFormDialog creates OR edits a rack in the CURRENT team — and for racks the team IS the
// warehouse the shelf stands in. The team travels in the message body (the backend's use_scope
// reads it there, never a header).
//
// Two modes, one form:
//  - create — `rack` undefined; the dialog renders its own "New rack" trigger.
//  - edit — `rack` set; the dialog is controlled (open/onOpenChange), pre-filled, calls RackUpdate.
//
// RackUpdate's code/name/description are optional (absent = leave alone), but the form shows all
// three pre-filled, so it always sends all three: what is on screen is what gets written, and
// clearing a field clears it.
export function RackFormDialog({
  rack,
  onDone,
  open: openProp,
  onOpenChange,
}: {
  rack?: Rack;
  onDone: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const { current } = useTeam();
  const { t } = useTranslation();

  const editing = rack !== undefined;
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

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [code, setCode] = useState(rack?.code ?? "");
  const [name, setName] = useState(rack?.name ?? "");
  const [description, setDescription] = useState(rack?.description ?? "");

  // The code is the rack's identity — the label painted on the shelf. Name and description are
  // conveniences, so the code alone is enough to save.
  const canSave = code.trim() !== "";

  async function submit(event: FormEvent) {
    event.preventDefault();

    if (!current) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      if (editing && rack) {
        await rackClient.rackUpdate({
          teamId: current.teamId,
          rackId: rack.id,
          code,
          name,
          description,
        });
        toaster.create({ type: "success", title: t("racks.form.saved") });
      } else {
        await rackClient.rackCreate({ teamId: current.teamId, code, name, description });
        toaster.create({ type: "success", title: t("racks.form.created", { code }) });

        setCode("");
        setName("");
        setDescription("");
      }

      setOpen(false);
      onDone();
    } catch (err) {
      // A code is unique per warehouse among ACTIVE racks, so the one error a person will actually
      // hit here is a duplicate. The raw "[already_exists] …" is the server talking to itself —
      // say which code clashed instead. Anything else falls back to the message as sent.
      const connectErr = ConnectError.from(err);

      setError(
        connectErr.code === Code.AlreadyExists
          ? t("racks.form.duplicateCode", { code })
          : rpcError(err),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(e) => setOpen(e.open)}>
      {!isControlled && (
        <Dialog.Trigger asChild>
          <Button size="xs" colorPalette="brand" data-testid="open-create-rack">
            {t("racks.form.newRack")}
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
                  {editing ? t("racks.form.editTitle") : t("racks.form.createTitle")}
                </Dialog.Title>
              </Dialog.Header>

              <Dialog.Body>
                <Stack gap="card">
                  {error && (
                    <Text color="red.fg" data-testid="rack-form-error">
                      {error}
                    </Text>
                  )}

                  <Field.Root required>
                    <Field.Label>{t("racks.form.code")}</Field.Label>
                    <Input value={code} data-testid="rack-code" onChange={(e) => setCode(e.target.value)} />
                    <Field.HelperText>{t("racks.form.codeHelp")}</Field.HelperText>
                  </Field.Root>

                  <Field.Root>
                    <Field.Label>{t("racks.form.name")}</Field.Label>
                    <Input value={name} data-testid="rack-name" onChange={(e) => setName(e.target.value)} />
                    <Field.HelperText>{t("racks.form.nameHelp")}</Field.HelperText>
                  </Field.Root>

                  <Field.Root>
                    <Field.Label>{t("racks.form.description")}</Field.Label>
                    <Input
                      value={description}
                      data-testid="rack-description"
                      onChange={(e) => setDescription(e.target.value)}
                    />
                  </Field.Root>
                </Stack>
              </Dialog.Body>

              <Dialog.Footer>
                <Dialog.ActionTrigger asChild>
                  <Button variant="outline">{t("racks.form.cancel")}</Button>
                </Dialog.ActionTrigger>

                <Button
                  type="submit"
                  colorPalette="brand"
                  loading={busy}
                  disabled={!canSave}
                  data-testid="submit-rack"
                >
                  {editing ? t("racks.form.save") : t("racks.form.create")}
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
