import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { InvoiceShelfClient } from "../api.js";

function text(s: string) {
  return { content: [{ type: "text" as const, text: s }] };
}

interface CustomerRecord {
  id: number;
  name: string;
  email: string | null;
  phone?: string | null;
}

export function registerCustomerTools(server: McpServer, api: InvoiceShelfClient) {
  server.registerTool(
    "get_customers",
    {
      description: "List customers, with optional pagination and search.",
      inputSchema: {
        page: z.number().optional(),
        limit: z.number().optional(),
        search: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (args: { page?: number; limit?: number; search?: string }) => {
      const res = await api.get<{ data: CustomerRecord[] }>("/customers", {
        page: args.page ?? 1,
        limit: args.limit ?? 15,
        ...(args.search ? { search: args.search } : {}),
      });
      const list = res.data.map((c) => `${c.name} (id ${c.id}) - ${c.email ?? "no email"}`);
      return text(list.length ? list.join("\n") : "No customers found.");
    },
  );

  server.registerTool(
    "get_customer",
    {
      description: "Get full details for a single customer by ID.",
      inputSchema: { customerId: z.number() },
      annotations: { readOnlyHint: true },
    },
    async ({ customerId }: { customerId: number }) => {
      const res = await api.get<{ data: CustomerRecord }>(`/customers/${customerId}`);
      return text(JSON.stringify(res.data, null, 2));
    },
  );

  server.registerTool(
    "create_customer",
    {
      description: "Create a new customer.",
      inputSchema: {
        name: z.string(),
        email: z.string().optional(),
        phone: z.string().optional(),
        currency_id: z.number().optional().describe("Defaults to 1 (the company's base currency)."),
      },
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    async (args: { name: string; email?: string; phone?: string; currency_id?: number }) => {
      const res = await api.post<{ data: CustomerRecord }>("/customers", {
        name: args.name,
        email: args.email,
        phone: args.phone,
        currency_id: args.currency_id ?? 1,
      });
      return text(`Customer "${res.data.name}" created (id ${res.data.id}).`);
    },
  );

  server.registerTool(
    "update_customer",
    {
      description: "Update fields on an existing customer.",
      inputSchema: {
        customerId: z.number(),
        name: z.string().optional(),
        email: z.string().optional(),
        phone: z.string().optional(),
      },
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    async ({ customerId, ...rest }: { customerId: number; [key: string]: unknown }) => {
      await api.put(`/customers/${customerId}`, rest);
      return text(`Customer #${customerId} updated.`);
    },
  );

  server.registerTool(
    "delete_customer",
    {
      description: "Delete a customer by ID.",
      inputSchema: { customerId: z.number() },
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async ({ customerId }: { customerId: number }) => {
      await api.delete(`/customers/${customerId}`);
      return text(`Customer #${customerId} deleted.`);
    },
  );
}
