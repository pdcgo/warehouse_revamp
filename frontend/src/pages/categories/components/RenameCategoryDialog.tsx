import { useState } from "react";
import type { FormEvent } from "react";
import { Button, CloseButton, Dialog, Field, Input, Portal, Stack, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { rpcError } from "../../../api/clients";
import type { Category } from "../../../gen/warehouse/category/v1/category_pb";
import { toaster } from "../../../components/feedback/Toaster";
import { useSaveCategory } from "../queries";

// RenameCategoryDialog changes a category's NAME and nothing else (the-category-page-is-a-tree) — moving it is its own
// action (MoveCategoryDialog). It sends the name alone, so the parent on the server is left as it is.
//
// Controlled: a node's ⋯ → Ubah Nama opens it, keyed by the category so it starts from that one's name.
export function RenameCategoryDialog({ category, onClose }: { category: Category; onClose: () => void }) {
  const { t } = useTranslation();
  const [error, setError] = useState("");
  const [name, setName] = useState(category.name);

  // Same hook the create dialog uses — one write, one invalidation, whichever form calls it (#177).
  const save = useSaveCategory();
  const busy = save.isPending;
  const unchanged = name.trim() === "" || name === category.name;

  function submit(event: FormEvent) {
    event.preventDefault();

    setError("");

    save.mutate(
      { categoryId: category.id, name },
      {
        onSuccess: () => {
          toaster.create({ type: "success", title: t("catalog.categories.updatedToast", { name }) });
          onClose();
        },
        onError: (err) => setError(rpcError(err)),
      },
    );
  }

  return (
    <Dialog.Root open onOpenChange={(e) => !e.open && onClose()}>
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <form onSubmit={submit}>
              <Dialog.Header>
                <Dialog.Title>{t("catalog.categories.renameTitle", { name: category.name })}</Dialog.Title>
              </Dialog.Header>

              <Dialog.Body>
                <Stack gap="card">
                  {error && (
                    <Text color="error.fg" data-testid="edit-category-error">
                      {error}
                    </Text>
                  )}

                  <Field.Root required>
                    <Field.Label>{t("catalog.name")}</Field.Label>
                    <Input
                      value={name}
                      placeholder={t("catalog.categories.namePlaceholder")}
                      data-testid="edit-category-name"
                      onChange={(e) => setName(e.target.value)}
                    />
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
                  disabled={unchanged}
                  data-testid="submit-edit-category"
                >
                  {t("catalog.save")}
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
