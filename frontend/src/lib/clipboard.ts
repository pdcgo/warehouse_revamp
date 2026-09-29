// Putting text on the clipboard — and saying truthfully whether it worked.
//
// ⚠ WHY THIS EXISTS INSTEAD OF CHAKRA'S `Clipboard`. Chakra's (Zag's) clipboard machine calls
// `navigator.clipboard.writeText` and moves to "copied" WITHOUT waiting for the promise. When the browser
// refuses the write — a story inside Storybook's iframe, a page reached over plain http on a LAN address,
// a document that lost focus — the promise rejects, nothing is copied, and the ✓ shows anyway. Its
// `execCommand` fallback only runs when the API is ABSENT, never when it is refused. The owner hit
// exactly this: "copyable tidak copy?".
//
// So: try the async API and WAIT; if it is missing or refuses, fall back to a hidden textarea and
// `execCommand("copy")`, which is not gated by the clipboard permission policy and works inside a
// same-origin iframe on a click; and report the real outcome so the indicator can tell the truth.

/** `true` only when the text actually reached the clipboard. */
export async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Refused (permission policy, insecure context, unfocused document) — try the old way.
  }

  return copyWithTextarea(text);
}

/**
 * The pre-async way: select the text in an off-screen textarea and ask the document to copy it.
 *
 * ⚠ A TEXTAREA, not a <pre> selection: iOS Safari only copies from an editable, selected field.
 * ⚠ READONLY, so a phone does not raise its keyboard for the instant the field exists.
 */
function copyWithTextarea(text: string): boolean {
  const field = document.createElement("textarea");

  field.value = text;
  field.setAttribute("readonly", "");
  Object.assign(field.style, { position: "fixed", top: "0", left: "0", opacity: "0", pointerEvents: "none" });

  document.body.appendChild(field);

  try {
    field.select();
    field.setSelectionRange(0, text.length);

    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(field);
  }
}
