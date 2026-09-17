import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { InvoiceShelfClient } from "../api.js";

function text(s: string) {
  return { content: [{ type: "text" as const, text: s }] };
}

interface UserRecord {
  id: number;
  name: string;
  email: string;
}

export function registerMiscTools(server: McpServer, api: InvoiceShelfClient) {
  server.registerTool(
    "test_connection",
    {
      description: "Verify the API base URL and token work by calling /me.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const res = await api.me();
      return text(`Connected as ${JSON.stringify(res.data)}.`);
    },
  );

  server.registerTool(
    "get_dashboard_stats",
    {
      description: "Get dashboard summary stats (totals due, paid, overdue, etc.).",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const res = await api.get<Record<string, unknown>>("/dashboard");
      return text(JSON.stringify(res, null, 2));
    },
  );

  server.registerTool(
    "get_users",
    {
      description: "List users on the InvoiceShelf instance.",
      inputSchema: {
        page: z.number().optional(),
        limit: z.number().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (args: { page?: number; limit?: number }) => {
      const res = await api.get<{ data: UserRecord[] }>("/users", {
        page: args.page ?? 1,
        limit: args.limit ?? 15,
      });
      const list = res.data.map((u) => `${u.name} (id ${u.id}) - ${u.email}`);
      return text(list.length ? list.join("\n") : "No users found.");
    },
  );

  server.registerTool(
    "get_user",
    {
      description: "Get full details for a single user by ID.",
      inputSchema: { userId: z.number() },
      annotations: { readOnlyHint: true },
    },
    async ({ userId }: { userId: number }) => {
      const res = await api.get<{ data: UserRecord }>(`/users/${userId}`);
      return text(JSON.stringify(res.data, null, 2));
    },
  );
}
