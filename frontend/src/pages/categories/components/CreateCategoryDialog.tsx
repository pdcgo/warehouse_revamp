import { useState } from "react";
import type { FormEvent } from "react";
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
import { useTranslation } from "react-i18next";
import { rpcError } from "../../../api/clients";
import { toaster } from "../../../components/Toaster";
import { CategorySelect } from "../../../components/CategorySelect";
import { useSaveCategory } from "../queries";

// CreateCategoryDialog adds a category to the GLOBAL taxonomy. A parent of 0n makes it top-level;
// picking a parent in the CategorySelect nests it under that node.
export function CreateCategoryDialog() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");

  const [name, setName] = useState("");
  const [parentId, setParentId] = useState<bigint>(0n);

  // The write invalidates the taxonomy itself (#177) — the page no longer passes a refetch callback.
  const save = useSaveCategory();
  const busy = save.isPending;

  function submit(event: FormEvent) {
    event.preventDefault();

    setError("");

    save.mutate(
      { name, parentId },
      {
        onSuccess: () => {
          toaster.create({ type: "success", title: t("catalog.categories.createdToast", { name }) });

          setName("");
          setParentId(0n);
          setOpen(false);
        },
        onError: (err) => setError(rpcError(err)),
      },
    );
  }

  return (
    <Dialog.Root open={open} onOpenChange={(e) => setOpen(e.open)}>
      <Dialog.Trigger asChild>
        <Button size="xs" colorPalette="brand" data-testid="open-create-category">
          {t("catalog.categories.newCategory")}
        </Button>
      </Dialog.Trigger>

      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <form onSubmit={submit}>
              <Dialog.Header>
                <Dialog.Title>{t("catalog.categories.newTitle")}</Dialog.Title>
              </Dialog.Header>

              <Dialog.Body>
                <Stack gap="card">
                  {error && (
                    <Text color="red.fg" data-testid="create-category-error">
                      {error}
                    </Text>
                  )}

                  <Field.Root required>
                    <Field.Label>{t("catalog.name")}</Field.Label>
                    <Input
                      value={name}
                      data-testid="new-category-name"
                      onChange={(e) => setName(e.target.value)}
                    />
                  </Field.Root>

                  <Field.Root>
                    <Field.Label>{t("catalog.categories.parent")}</Field.Label>
                    <CategorySelect value={parentId} onChange={setParentId} />
                    <Field.HelperText>{t("catalog.categories.parentHelpCreate")}</Field.HelperText>
                  </Field.Root>
                </Stack>
              </Dialog.Body>

              <Dialog.Footer>
                <Dialog.ActionTrigger asChild>
                  <Button variant="outline">{t("catalog.cancel")}</Button>
                </Dialog.ActionTrigger>

                <Button
                  type="submit"
                  colorPalette="brand"
                  loading={busy}
                  data-testid="submit-create-category"
                >
                  {t("catalog.create")}
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
