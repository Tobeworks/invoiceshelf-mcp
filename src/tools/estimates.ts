import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { InvoiceShelfClient } from "../api.js";
import { priceItems, formatMinor, type LineItemInput } from "../money.js";

const lineItemSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  quantity: z.number(),
  price: z.number().describe("Unit price in whole currency units, not minor units."),
});

function text(s: string) {
  return { content: [{ type: "text" as const, text: s }] };
}

interface CustomerRef {
  id: number;
  name: string;
  email: string | null;
}

interface EstimateRecord {
  id: number;
  estimate_number: string;
  total: number;
  customer_id: number;
  customer?: CustomerRef;
}

async function nextEstimateNumber(api: InvoiceShelfClient, companyId = 1): Promise<string> {
  const res = await api.get<{ nextNumber: string }>(
    "/next-number",
    { key: "estimate" },
    { company: String(companyId) },
  );
  return res.nextNumber;
}

export function registerEstimateTools(server: McpServer, api: InvoiceShelfClient) {
  server.registerTool(
    "get_estimates",
    {
      description: "List estimates, with optional pagination, search and customer filters.",
      inputSchema: {
        page: z.number().optional(),
        limit: z.number().optional(),
        search: z.string().optional(),
        customer_id: z.number().optional(),
      },
    },
    async (args: { page?: number; limit?: number; search?: string; customer_id?: number }) => {
      const res = await api.get<{ data: EstimateRecord[] }>("/estimates", {
        page: args.page ?? 1,
        limit: args.limit ?? 15,
        ...(args.search ? { search: args.search } : {}),
        ...(args.customer_id ? { customer_id: args.customer_id } : {}),
      });
      const list = res.data.map((e) => `#${e.estimate_number} (id ${e.id}) - ${formatMinor(e.total)}`);
      return text(list.length ? list.join("\n") : "No estimates found.");
    },
  );

  server.registerTool(
    "get_estimate",
    {
      description: "Get full details for a single estimate by ID.",
      inputSchema: { estimateId: z.number() },
    },
    async ({ estimateId }: { estimateId: number }) => {
      const res = await api.get<{ data: EstimateRecord }>(`/estimates/${estimateId}`);
      return text(JSON.stringify(res.data, null, 2));
    },
  );

  server.registerTool(
    "create_estimate",
    {
      description: "Create a new estimate. Handles InvoiceShelf's undocumented required fields internally.",
      inputSchema: {
        customer_id: z.number(),
        estimate_date: z.string().describe("YYYY-MM-DD"),
        expiry_date: z.string().describe("YYYY-MM-DD"),
        items: z.array(lineItemSchema),
        reference_number: z.string().optional(),
        notes: z.string().optional(),
        template_name: z.string().optional().describe('Defaults to "tobeworks".'),
      },
    },
    async (args: {
      customer_id: number;
      estimate_date: string;
      expiry_date: string;
      items: LineItemInput[];
      reference_number?: string;
      notes?: string;
      template_name?: string;
    }) => {
      const { items: priced, subTotal } = priceItems(args.items);
      const estimateNumber = await nextEstimateNumber(api);

      const payload = {
        customer_id: args.customer_id,
        estimate_date: args.estimate_date,
        expiry_date: args.expiry_date,
        estimate_number: estimateNumber,
        reference_number: args.reference_number,
        notes: args.notes,
        template_name: args.template_name ?? "tobeworks",
        exchange_rate: 1,
        discount_type: "fixed",
        discount: "0.00",
        discount_val: 0,
        tax_per_item: "NO",
        discount_per_item: "NO",
        sub_total: subTotal,
        tax: 0,
        total: subTotal,
        items: priced,
      };

      const res = await api.post<{ data: EstimateRecord }>("/estimates", payload);
      const est = res.data;
      return text(`Estimate #${est.estimate_number} created (id ${est.id}), total ${formatMinor(est.total)}.`);
    },
  );

  server.registerTool(
    "update_estimate",
    {
      description: "Update fields on an existing estimate.",
      inputSchema: {
        estimateId: z.number(),
        estimate_date: z.string().optional(),
        expiry_date: z.string().optional(),
        reference_number: z.string().optional(),
        notes: z.string().optional(),
        template_name: z.string().optional(),
        items: z.array(lineItemSchema).optional(),
      },
    },
    async ({
      estimateId,
      items,
      ...rest
    }: {
      estimateId: number;
      items?: LineItemInput[];
      [key: string]: unknown;
    }) => {
      let extra: Record<string, unknown> = {};
      if (items) {
        const { items: priced, subTotal } = priceItems(items);
        extra = { items: priced, sub_total: subTotal, tax: 0, total: subTotal };
      }
      await api.put(`/estimates/${estimateId}`, { ...rest, ...extra });
      return text(`Estimate #${estimateId} updated.`);
    },
  );

  server.registerTool(
    "delete_estimate",
    {
      description: "Delete an estimate by ID.",
      inputSchema: { estimateId: z.number() },
    },
    async ({ estimateId }: { estimateId: number }) => {
      await api.delete(`/estimates/${estimateId}`);
      return text(`Estimate #${estimateId} deleted.`);
    },
  );

  server.registerTool(
    "send_estimate",
    {
      description:
        "Email an estimate to its customer. Looks up the sender address and the customer's email automatically.",
      inputSchema: {
        estimateId: z.number(),
        subject: z.string().optional(),
        body: z.string().optional(),
      },
    },
    async ({ estimateId, subject, body }: { estimateId: number; subject?: string; body?: string }) => {
      const estRes = await api.get<{ data: EstimateRecord }>(`/estimates/${estimateId}`);
      const estimate = estRes.data;
      const customerEmail = estimate.customer?.email;
      if (!customerEmail) {
        throw new Error(
          `Customer "${estimate.customer?.name}" (id ${estimate.customer_id}) has no email on file. Set one with update_customer first.`,
        );
      }

      const settingsRes = await api.get<{ mail_username: string | null }>("/settings", { key: "mail_username" });
      const fromEmail = settingsRes.mail_username;
      if (!fromEmail) {
        throw new Error("No mail_username configured in company settings, set up SMTP first.");
      }

      await api.post(`/estimates/${estimateId}/send`, {
        from: fromEmail,
        to: customerEmail,
        subject: subject ?? `Estimate ${estimate.estimate_number}`,
        body: body ?? `Please find attached estimate ${estimate.estimate_number}.`,
      });
      return text(`Estimate #${estimate.estimate_number} sent to ${customerEmail} (from ${fromEmail}).`);
    },
  );

  server.registerTool(
    "convert_estimate_to_invoice",
    {
      description: "Convert an accepted estimate into an invoice.",
      inputSchema: { estimateId: z.number() },
    },
    async ({ estimateId }: { estimateId: number }) => {
      const res = await api.post<{ data: { id: number; invoice_number: string } }>(
        `/estimates/${estimateId}/convert-to-invoice`,
      );
      return text(`Estimate #${estimateId} converted to invoice #${res.data.invoice_number} (id ${res.data.id}).`);
    },
  );
}
