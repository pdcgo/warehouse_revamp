import { createContext, memo, useContext } from "react";
import type { ReactNode, RefObject } from "react";
import { Fieldset } from "@chakra-ui/react";

// THE FORM LOCK'S FIELDSET, RENDERED ONLY WHEN THE LOCK CHANGES (#135, the-speed-audits-old-findings-are-fixed-
// smallest-first) — the one native fieldset around the whole form (the-form-locks-until-it-is-answered): `disabled`
// reaches every input, button and picker trigger inside it, and Chakra's fields read it through the fieldset context.
//
// ⚠ THAT CONTEXT IS WHY IT IS A COMPONENT OF ITS OWN. `Fieldset.Root` hands its fields a NEW context value every time
// it renders, and a context reaches past `React.memo`: rendered by the page on every key, it re-rendered every label,
// input, picker and radio of every card — about 240 components a key the memoised cards could not stop. So the
// fieldset renders only when `locked` does, and what is inside it travels to it through a context of its own
// (`FormBody`): the page renders the form's body on every key as before, the cards in it skip as they are memoised,
// and the fieldset above them stays as it was. The DOM is the same — form › fieldset › the body.
const FormBody = createContext<ReactNode>(null);

/** The fieldset's one child — the same element on every render, so the fieldset never renders for it. */
function FormBodyOutlet() {
  return <>{useContext(FormBody)}</>;
}

const OUTLET = <FormBodyOutlet />;

function LockFieldsetRoot({ locked, lockRef }: { locked: boolean; lockRef: RefObject<HTMLFieldSetElement> }) {
  return (
    <Fieldset.Root
      ref={lockRef}
      disabled={locked}
      minW="0"
      data-testid="order-create-lock"
      data-locked={locked ? "" : undefined}
    >
      {OUTLET}
    </Fieldset.Root>
  );
}

const StillFieldsetRoot = memo(LockFieldsetRoot);

export function LockFieldset({
  locked,
  lockRef,
  children,
}: {
  locked: boolean;
  /** The page's ref — it sets `inert` on the fieldset while locked. */
  lockRef: RefObject<HTMLFieldSetElement>;
  children: ReactNode;
}) {
  return (
    <FormBody.Provider value={children}>
      <StillFieldsetRoot locked={locked} lockRef={lockRef} />
    </FormBody.Provider>
  );
}
