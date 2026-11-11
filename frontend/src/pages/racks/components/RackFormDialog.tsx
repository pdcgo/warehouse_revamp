import { useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button, CloseButton, Dialog, Field, Icon, Input, Portal, Stack, Text, Textarea } from "@chakra-ui/react";
import { Plus, Save } from "lucide-react";
import { Code, ConnectError } from "@connectrpc/connect";
import { rpcError } from "../../../api/clients";
import type { Rack } from "../../../gen/warehouse/inventory/v1/rack_pb";
import { useTeam } from "../../../features/team/TeamContext";
import { CharCount } from "../../../components/inputs/CharCount";
import { toaster } from "../../../components/feedback/Toaster";
import { useSaveRack } from "../queries";

// The proto's limits (rack.proto: code 1–32, name 200, description 500) — the box stops where the server would refuse,
// and the count under it says so (a-limited-field-shows-its-count).
const CODE_MAX = 32;
const NAME_MAX = 200;
const DESCRIPTION_MAX = 500;

// RackFormDialog creates OR edits a rack in the CURRENT team — and for racks the team IS the
// warehouse the shelf stands in. The team travels in the message body (the backend's use_scope
// reads it there, never a header).
//
// Two modes, one form, opened by the page (its Rak Baru, a row's ✎):
//  - create — `rack` undefined.
//  - edit — `rack` set; pre-filled, calls RackUpdate.
//
// RackUpdate's code/name/description are optional (absent = leave alone), but the form shows all
// three pre-filled, so it always sends all three: what is on screen is what gets written, and
// clearing a field clears it.
//
// ON THE SCREEN RULES (the-racks-follow-the-screen-rules): every typed field shows an example
// (every-form-field-shows-an-example) and its count against the limit; the description is a two-row box; the save
// button carries its icon (an-action-button-carries-its-icon).
export function RackFormDialog({
  rack,
  open,
  onOpenChange,
}: {
  rack?: Rack;
  open: boolean;
  /** The dialog's open state changed — including the close that follows a successful save. */
  onOpenChange: (open: boolean) => void;
}) {
  const { current } = useTeam();
  const { t } = useTranslation();

  const editing = rack !== undefined;
  const [error, setError] = useState("");

  // The write, and what it invalidates, declared together in queries.ts (#177). There is no `busy`
  // beside it: the mutation already knows whether it is in flight, and a second flag is a second
  // answer to the same question that can disagree with the first.
  const save = useSaveRack();
  const busy = save.isPending;

  const [code, setCode] = useState(rack?.code ?? "");
  const [name, setName] = useState(rack?.name ?? "");
  const [description, setDescription] = useState(rack?.description ?? "");

  // The code is the rack's identity — the label painted on the shelf. Name and description are
  // conveniences, so the code alone is enough to save.
  const canSave = code.trim() !== "";

  function submit(event: FormEvent) {
    event.preventDefault();

    if (!current) {
      return;
    }

    setError("");

    save.mutate(
      {
        teamId: current.teamId,
        rackId: rack?.id,
        code,
        name,
        description,
      },
      {
        onSuccess: () => {
          toaster.create(
            editing
              ? { type: "success", title: t("racks.form.saved") }
              : { type: "success", title: t("racks.form.created", { code }) },
          );
          // Closing is what tells the page the form is gone. It is NOT a refetch signal: the hook already
          // invalidated before this ran.
          onOpenChange(false);
        },
        onError: (err) => {
          // A code is unique per warehouse among ACTIVE racks, so the one error a person will
          // actually hit here is a duplicate. The raw "[already_exists] …" is the server talking to
          // itself — say which code clashed instead. Anything else falls back to the message as sent.
          const connectErr = ConnectError.from(err);

          setError(
            connectErr.code === Code.AlreadyExists
              ? t("racks.form.duplicateCode", { code })
              : rpcError(err),
          );
        },
      },
    );
  }

  return (
    <Dialog.Root open={open} onOpenChange={(e) => onOpenChange(e.open)}>
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content data-testid="rack-form">
            <form onSubmit={submit}>
              <Dialog.Header>
                <Dialog.Title>
                  {editing ? t("racks.form.editTitle") : t("racks.form.createTitle")}
                </Dialog.Title>
              </Dialog.Header>

              <Dialog.Body>
                <Stack gap="card">
                  {error && (
                    <Text color="error.fg" data-testid="rack-form-error">
                      {error}
                    </Text>
                  )}

                  <Field.Root required>
                    <Field.Label>{t("racks.form.code")}</Field.Label>
                    <Input
                      value={code}
                      maxLength={CODE_MAX}
                      placeholder={t("racks.form.codePlaceholder")}
                      data-testid="rack-code"
                      onChange={(e) => setCode(e.target.value)}
                    />
                    <Field.HelperText>{t("racks.form.codeHelp")}</Field.HelperText>
                    <CharCount value={code} max={CODE_MAX} testId="rack-code-count" />
                  </Field.Root>

                  <Field.Root>
                    <Field.Label>{t("racks.form.name")}</Field.Label>
                    <Input
                      value={name}
                      maxLength={NAME_MAX}
                      placeholder={t("racks.form.namePlaceholder")}
                      data-testid="rack-name"
                      onChange={(e) => setName(e.target.value)}
                    />
                    <Field.HelperText>{t("racks.form.nameHelp")}</Field.HelperText>
                    <CharCount value={name} max={NAME_MAX} testId="rack-name-count" />
                  </Field.Root>

                  <Field.Root>
                    <Field.Label>{t("racks.form.description")}</Field.Label>
                    <Textarea
                      rows={2}
                      value={description}
                      maxLength={DESCRIPTION_MAX}
                      placeholder={t("racks.form.descriptionPlaceholder")}
                      data-testid="rack-description"
                      onChange={(e) => setDescription(e.target.value)}
                    />
                    <CharCount value={description} max={DESCRIPTION_MAX} testId="rack-description-count" />
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
                  <Icon as={editing ? Save : Plus} boxSize="4" />
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
