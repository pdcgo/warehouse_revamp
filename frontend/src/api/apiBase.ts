// WHERE THE API IS — the one place the app reads it.
//
// The transport sends every RPC here, and the AI-agent screens print it with "/mcp" on the end: the MCP endpoint is
// served by the same server, beside the RPC handlers (our-server-hosts-the-mcp). Two copies of the default would be two
// answers the day one of them changes.
//
// ⚠ A MODULE OF ITS OWN, not an export of `src/transport.ts`: Storybook swaps that file for its stub transport by the
// literal specifier `"../transport"` (stubTransportPlugin.ts), and it keeps exactly one importer so the swap reaches
// every client. A screen reading the base from there would pull the real transport into the stories beside the fake.
export const API_BASE_URL: string = import.meta.env.VITE_API_URL ?? "http://localhost:8080";
