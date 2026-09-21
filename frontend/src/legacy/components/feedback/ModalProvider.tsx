import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ElementType,
  type ReactNode,
} from "react";
import { Button, Dialog, Portal, Stack, Text } from "@chakra-ui/react";
import type { Tone } from "../tone";
import { palette } from "../tone";
import { Modal } from "./Modal";
import { Spinner } from "./Spinner";

// ── WHY AN IMPERATIVE MODAL API EXISTS BESIDE THE DECLARATIVE ONE ───────────────────────────────
//
// `ConfirmDialog` is the declarative form: you put a dialog in your JSX and wire it to a trigger.
// That is the right shape when the dialog belongs to the screen — a delete button next to a row.
//
// This is the imperative form: `if (await confirm({...})) { … }`, called from inside an event
// handler. It is the right shape when the question arises IN THE MIDDLE OF A FLOW rather than from a
// button — a save that discovers a conflict, a bulk action that turns out to affect more rows than
// expected, a navigation guard. Expressing those declaratively means hoisting a piece of state, a
// dialog and a pair of callbacks into the component just to ask one question, and then threading the
// answer back to the point where it was needed.
//
// ⚠ They are not interchangeable, and a screen should not use both for the same question. If the
// dialog has a visible trigger, use `ConfirmDialog`.

export interface ConfirmOptions {
  title?: string;
  icon?: ElementType;
  // The question. A sentence, or arbitrary content when it needs a list or a form.
  content?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  // The tone of the CONFIRM button. `error` for anything destructive — this is the same
  // "destructive actions look destructive" rule the declarative dialog follows.
  tone?: Tone;
}

export interface ModalContextValue {
  // Ask a yes/no question. Resolves `true` on confirm, `false` on cancel, Escape, or backdrop —
  // dismissing is never mistaken for agreeing.
  confirm(options: ConfirmOptions): Promise<boolean>;
  // A blocking, app-wide "working…" overlay. Keyed by `label` so two concurrent operations do not
  // fight over it and the first to finish does not clear the second's overlay.
  setLoading(loading: boolean, label?: string): void;
}

const ModalContext = createContext<ModalContextValue | null>(null);

// useModal returns the imperative API. It THROWS outside the provider rather than returning null:
// the alternative is `modal?.confirm(...)` silently doing nothing, which turns a missing provider
// into a destructive action that runs without ever asking.
export function useModal(): ModalContextValue {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error("useModal must be used inside a <ModalProvider>");
  return ctx;
}

interface PendingConfirm extends ConfirmOptions {
  id: number;
  resolve: (value: boolean) => void;
}

export const description =
  "Provides the imperative `await confirm({...})` and a keyed blocking `setLoading`. For a dialog with a visible trigger, use ConfirmDialog instead.";

export function ModalProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  // Keyed by label so concurrent operations each own their own entry — see setLoading.
  const [loading, setLoadingMap] = useState<Record<string, boolean>>({});
  const nextId = useRef(0);

  const settle = useCallback((value: boolean) => {
    setPending((current) => {
      current?.resolve(value);
      return null;
    });
  }, []);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        nextId.current += 1;
        setPending({ ...options, id: nextId.current, resolve });
      }),
    [],
  );

  const setLoading = useCallback((value: boolean, label = "") => {
    setLoadingMap((map) => ({ ...map, [label]: value }));
  }, []);

  const activeLoading = useMemo(
    () => Object.entries(loading).find(([, on]) => on),
    [loading],
  );

  const api = useMemo<ModalContextValue>(() => ({ confirm, setLoading }), [confirm, setLoading]);

  return (
    <ModalContext.Provider value={api}>
      {children}

      <Modal
        open={pending !== null}
        // Escape and the backdrop resolve FALSE. Treating a dismissal as consent is how a bulk
        // delete happens to somebody who meant to get out of the dialog.
        onOpenChange={(open) => {
          if (!open) settle(false);
        }}
        title={pending?.title}
        icon={pending?.icon}
        size="sm"
        footer={
          <Stack direction="row" gap="2" justify="flex-end">
            <Button variant="ghost" onClick={() => settle(false)} data-testid="confirm-cancel">
              {pending?.cancelLabel ?? "Cancel"}
            </Button>
            <Button
              colorPalette={palette(pending?.tone, "active")}
              onClick={() => settle(true)}
              data-testid="confirm-accept"
            >
              {pending?.confirmLabel ?? "Continue"}
            </Button>
          </Stack>
        }
      >
        {typeof pending?.content === "string" ? <Text>{pending.content}</Text> : pending?.content}
      </Modal>

      {/* The blocking overlay. A bare Dialog with no chrome — it is not something you dismiss, it is
          something you wait out, so it deliberately has no close affordance and no Escape. */}
      <Dialog.Root open={activeLoading !== undefined} closeOnEscape={false} closeOnInteractOutside={false}>
        <Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner>
            <Dialog.Content bg="transparent" boxShadow="none" data-testid="modal-loading">
              <Stack align="center" gap="3" py="6">
                <Spinner />
                {activeLoading?.[0] && <Text color="white">{activeLoading[0]}</Text>}
              </Stack>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>
    </ModalContext.Provider>
  );
}
