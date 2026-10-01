import type { FormEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button, CloseButton, Dialog, Portal, Stack, Text } from "@chakra-ui/react";

// The frame every account dialog shares — New Account, Edit, Transfer, Capital, Reconcile, Which account
// is this? — so the six differ only in their fields and their rule, not in where Save sits.
//
// Controlled always: the dialogs open from a row's menu, and a menu item is not a trigger that survives
// the menu closing.
export function FormDialog({
  open,
  onOpenChange,
  title,
  error,
  busy,
  canSave,
  saveLabel,
  testId,
  onSubmit,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  error: string;
  busy: boolean;
  canSave: boolean;
  saveLabel?: string;
  testId: string;
  onSubmit: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();

  function submit(event: FormEvent) {
    event.preventDefault();
    if (canSave && !busy) onSubmit();
  }

  return (
    <Dialog.Root open={open} onOpenChange={(e) => onOpenChange(e.open)}>
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content data-testid={testId}>
            <form onSubmit={submit}>
              <Dialog.Header>
                <Dialog.Title>{title}</Dialog.Title>
              </Dialog.Header>

              <Dialog.Body>
                <Stack gap="card">
                  {error && (
                    <Text color="fg.error" data-testid={`${testId}-error`}>
                      {error}
                    </Text>
                  )}
                  {children}
                </Stack>
              </Dialog.Body>

              <Dialog.Footer>
                <Dialog.ActionTrigger asChild>
                  <Button variant="outline" type="button">
                    {t("financialAccounts.cancel")}
                  </Button>
                </Dialog.ActionTrigger>
                <Button type="submit" colorPalette="brand" loading={busy} disabled={!canSave} data-testid={`${testId}-save`}>
                  {saveLabel ?? t("financialAccounts.save")}
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
