// HOW A REFUSAL READS — every screen says a server error through `rpcError` (re-exported by api/clients.ts), so this is
// the one place that decides what a person sees.
//
// A Connect error's `message` is "[failed_precondition] the correction would take the expense below 0": the code in
// brackets, then the server's text. The code is for programs, so it is never shown. What follows depends on who the
// server's text was written for:
//
//   - a REFUSAL (invalid_argument, failed_precondition, not_found, already_exists, aborted, out_of_range,
//     resource_exhausted) — the services write that sentence for the person ("suspend the account first"), so it is
//     shown as written;
//   - permission_denied and unauthenticated — the same, EXCEPT when the text is empty or machine talk (a Go package's
//     "san_auth: invalid token", the interceptor's "no access policy" / "insufficient role"): then a translated
//     sentence for the code. "invalid username or password" and "current password is incorrect" are unauthenticated
//     too, and are for the person;
//   - a FAULT (unknown, internal, unavailable, deadline_exceeded, canceled, unimplemented, data_loss) — the text is a
//     wrapped Go error or a proxy's, never for the person: a translated sentence for the code, always. The raw text
//     goes to the console for whoever is debugging.
//
// A plain Error thrown by the app's own code (not a Connect error) keeps its message: it was written here.

import { Code, ConnectError } from "@connectrpc/connect";
import i18next from "i18next";

/** The faults: the server's text is never shown, a translated sentence is (`serverError.<key>`). */
const FAULT: Partial<Record<Code, string>> = {
  [Code.Canceled]: "canceled",
  [Code.Unknown]: "unknown",
  [Code.DeadlineExceeded]: "deadlineExceeded",
  [Code.Unimplemented]: "unimplemented",
  [Code.Internal]: "internal",
  [Code.Unavailable]: "unavailable",
  [Code.DataLoss]: "dataLoss",
};

/** Codes whose text is shown unless it is empty or machine talk — then this sentence. */
const GUARDED: Partial<Record<Code, string>> = {
  [Code.PermissionDenied]: "permissionDenied",
  [Code.Unauthenticated]: "unauthenticated",
};

// Machine talk a guarded code may carry: a Go package's own prefixed error ("san_auth: missing token"), and the access
// interceptor's two generic refusals, which name no rule a person could act on.
const MACHINE = /^[a-z][a-z0-9_]*: /;
const GENERIC_REFUSALS = new Set(["no access policy", "insufficient role", "permission denied"]);

const say = (key: string) => i18next.t(`serverError.${key}`);

export function rpcError(err: unknown): string {
  if (!(err instanceof ConnectError)) {
    return err instanceof Error ? err.message : String(err);
  }

  const text = err.rawMessage.trim();

  const fault = FAULT[err.code];
  if (fault !== undefined) {
    if (text !== "") console.warn(`rpcError [${Code[err.code]}]`, text);

    return say(fault);
  }

  const guarded = GUARDED[err.code];
  if (guarded !== undefined && (text === "" || MACHINE.test(text) || GENERIC_REFUSALS.has(text.toLowerCase()))) {
    return say(guarded);
  }

  return text === "" ? say("refused") : text;
}
