import type { Meta, StoryObj } from "@storybook/react-vite";
import { Code, ConnectError } from "@connectrpc/connect";
import { Table } from "@chakra-ui/react";
import { expect, within } from "storybook/test";

import { rpcError } from "./rpcError";

// HOW A SERVER ERROR READS (api/rpcError.ts) — the one function every screen says a failed call through. The Connect
// code in brackets is never shown; a refusal keeps the server's own sentence, which the services write for people; a
// fault (internal, unavailable, unknown, …) and machine talk under permission_denied / unauthenticated read as a
// translated sentence for the code.

const CASES: { id: string; err: unknown }[] = [
  { id: "failed-precondition", err: new ConnectError("the correction would take the expense below 0", Code.FailedPrecondition) },
  { id: "invalid-argument", err: new ConnectError("a correction of 0 corrects nothing", Code.InvalidArgument) },
  { id: "not-found", err: new ConnectError("cost not found", Code.NotFound) },
  { id: "already-exists", err: new ConnectError("that SKU is already another product's", Code.AlreadyExists) },
  { id: "permission-denied-said", err: new ConnectError("expenses are recorded by the team's Owner and Admin", Code.PermissionDenied) },
  { id: "permission-denied-generic", err: new ConnectError("insufficient role", Code.PermissionDenied) },
  { id: "permission-denied-empty", err: new ConnectError("", Code.PermissionDenied) },
  { id: "unauthenticated-said", err: new ConnectError("current password is incorrect", Code.Unauthenticated) },
  { id: "unauthenticated-machine", err: new ConnectError("san_auth: token expired", Code.Unauthenticated) },
  { id: "internal", err: new ConnectError('ERROR: duplicate key value violates unique constraint "x" (SQLSTATE 23505)', Code.Internal) },
  { id: "unavailable", err: new ConnectError("expense_service: dial tcp 127.0.0.1:5433: connect: connection refused", Code.Unavailable) },
  { id: "unknown", err: new ConnectError("Failed to fetch", Code.Unknown) },
  { id: "deadline-exceeded", err: new ConnectError("context deadline exceeded", Code.DeadlineExceeded) },
  { id: "unimplemented", err: new ConnectError("warehouse.selling.v1.OrderService.OrderExport is not implemented", Code.Unimplemented) },
  { id: "app-error", err: new Error("pick a shop first") },
];

function Cases() {
  return (
    <Table.Root size="sm" data-testid="rpc-error-cases">
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>The error</Table.ColumnHeader>
          <Table.ColumnHeader>What the person reads</Table.ColumnHeader>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {CASES.map(({ id, err }) => (
          <Table.Row key={id}>
            <Table.Cell color="fg.muted">{err instanceof Error ? err.message : String(err)}</Table.Cell>
            <Table.Cell data-testid={`rpc-error-${id}`}>{rpcError(err)}</Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
  );
}

const meta = {
  title: "Api/rpcError",
  component: Cases,
  parameters: { layout: "padded" },
} satisfies Meta<typeof Cases>;

export default meta;
type Story = StoryObj<typeof meta>;

export const EveryCode: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const said = (id: string) => canvas.getByTestId(`rpc-error-${id}`);

    // A refusal: the server's sentence, as written, without the code.
    await expect(said("failed-precondition")).toHaveTextContent(/^the correction would take the expense below 0$/);
    await expect(said("invalid-argument")).toHaveTextContent(/^a correction of 0 corrects nothing$/);
    await expect(said("not-found")).toHaveTextContent(/^cost not found$/);
    await expect(said("already-exists")).toHaveTextContent(/^that SKU is already another product's$/);

    // permission_denied / unauthenticated: the sentence when it was written for a person, else the code's own.
    await expect(said("permission-denied-said")).toHaveTextContent(/^expenses are recorded by the team's Owner and Admin$/);
    await expect(said("permission-denied-generic")).toHaveTextContent(/^You are not allowed to do this\.$/);
    await expect(said("permission-denied-empty")).toHaveTextContent(/^You are not allowed to do this\.$/);
    await expect(said("unauthenticated-said")).toHaveTextContent(/^current password is incorrect$/);
    await expect(said("unauthenticated-machine")).toHaveTextContent(/^Your sign-in has ended\. Sign in again\.$/);

    // A fault: never the Go error, never the code.
    await expect(said("internal")).toHaveTextContent(/^Something went wrong on the server\. Try again\.$/);
    await expect(said("unavailable")).toHaveTextContent(/^The server cannot be reached right now\. Try again in a moment\.$/);
    await expect(said("unknown")).toHaveTextContent(/^Something went wrong\. Try again\.$/);
    await expect(said("deadline-exceeded")).toHaveTextContent(/^The server took too long to answer\. Try again\.$/);
    await expect(said("unimplemented")).toHaveTextContent(/^This is not built yet\.$/);

    // The app's own Error keeps its message — it was written here.
    await expect(said("app-error")).toHaveTextContent(/^pick a shop first$/);

    // No line anywhere carries a bracketed code.
    await expect(canvas.getByTestId("rpc-error-cases").querySelectorAll("td:nth-child(2)")).toHaveLength(CASES.length);
    for (const cell of canvas.getByTestId("rpc-error-cases").querySelectorAll("td:nth-child(2)")) {
      await expect(cell).not.toHaveTextContent(/\[[a-z_]+\]/);
    }
  },
};
