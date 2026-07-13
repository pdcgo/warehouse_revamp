import type { Interceptor } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { getToken } from "./auth/tokenStorage";

const baseUrl = import.meta.env.VITE_API_URL ?? "http://localhost:8080";

// The ONLY thing that rides in a header is the token.
//
// TEAM SCOPE IS A MESSAGE FIELD, NOT A HEADER. Every scoped RPC carries `team_id` in its request
// body — that is what the backend's (use_scope) option reads. No interceptor can supply it; each
// caller passes the current team explicitly. See useTeam().
const authInterceptor: Interceptor = (next) => async (req) => {
  const token = getToken();

  if (token) {
    req.header.set("Authorization", `Bearer ${token}`);
  }

  return next(req);
};

export const transport = createConnectTransport({
  baseUrl,
  interceptors: [authInterceptor],
});
