import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { InvoiceShelfClient } from "../api.js";
import { priceItems, formatMinor, type LineItemInput } from "../money.js";

const lineItemSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  quantity: z.number(),
  price: z.number().describe("Unit price in whole currency units (e.g. 140 for 140,00 EUR), not minor units."),
});

function text(s: string) {
  return { content: [{ type: "text" as const, text: s }] };
}

interface CustomerRef {
  id: number;
  name: string;
  email: string | null;
}

interface InvoiceRecord {
  id: number;
  invoice_number: string;
  total: number;
  customer_id: number;
  customer?: CustomerRef;
  invoice_date?: string;
  due_date?: string;
  reference_number?: string | null;
  notes?: string | null;
  template_name?: string;
  sub_total?: number;
  tax?: number;
  items?: unknown[];
}

/**
 * Look up the next invoice number. Requires the `company` header
 * (verified against the live API, NextNumberController reads it from the
 * header, not from the auth context), companyId defaults to 1 since
 * InvoiceShelf's REST API has no multi-company switching for a single
 * token in practice for this use case.
 */
async function nextInvoiceNumber(api: InvoiceShelfClient, companyId = 1): Promise<string> {
  const res = await api.get<{ nextNumber: string }>(
    "/next-number",
    { key: "invoice" },
    { company: String(companyId) },
  );
  return res.nextNumber;
}

export function registerInvoiceTools(server: McpServer, api: InvoiceShelfClient) {
  server.registerTool(
    "get_invoices",
    {
      description: "List invoices, with optional pagination, search, status and customer filters.",
      inputSchema: {
        page: z.number().optional(),
        limit: z.number().optional(),
        search: z.string().optional(),
        status: z.enum(["DRAFT", "SENT", "VIEWED", "OVERDUE", "COMPLETED", "PARTIALLY_PAID"]).optional(),
        customer_id: z.number().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const res = await api.get<{ data: InvoiceRecord[] }>("/invoices", {
        page: args.page ?? 1,
        limit: args.limit ?? 15,
        ...(args.search ? { search: args.search } : {}),
        ...(args.status ? { status: args.status } : {}),
        ...(args.customer_id ? { customer_id: args.customer_id } : {}),
      });
      const list = res.data.map((inv) => `#${inv.invoice_number} (id ${inv.id}) - ${formatMinor(inv.total)}`);
      return text(list.length ? list.join("\n") : "No invoices found.");
    },
  );

  server.registerTool(
    "get_invoice",
    {
      description: "Get full details for a single invoice by ID.",
      inputSchema: { invoiceId: z.number() },
      annotations: { readOnlyHint: true },
    },
    async ({ invoiceId }) => {
      const res = await api.get<{ data: InvoiceRecord }>(`/invoices/${invoiceId}`);
      return text(JSON.stringify(res.data, null, 2));
    },
  );

  server.registerTool(
    "get_customer_invoices",
    {
      description: "Get all invoices for a specific customer, optionally filtered by status.",
      inputSchema: {
        customerId: z.number(),
        status: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ customerId, status }) => {
      const res = await api.get<{ data: InvoiceRecord[] }>("/invoices", {
        customer_id: customerId,
        ...(status ? { status } : {}),
      });
      return text(JSON.stringify(res.data, null, 2));
    },
  );

  server.registerTool(
    "create_invoice",
    {
      description: "Create a new invoice. Handles InvoiceShelf's undocumented required fields internally.",
      inputSchema: {
        customer_id: z.number(),
        invoice_date: z.string().describe("YYYY-MM-DD"),
        due_date: z.string().describe("YYYY-MM-DD"),
        items: z.array(lineItemSchema),
        invoice_number: z.string().optional().describe("Auto-generated via /next-number if omitted."),
        reference_number: z.string().optional(),
        notes: z.string().optional(),
        template_name: z.string().optional().describe('Defaults to "tobeworks".'),
      },
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    async (args) => {
      const { items: priced, subTotal } = priceItems(args.items as LineItemInput[]);
      const invoiceNumber = args.invoice_number ?? (await nextInvoiceNumber(api));

      const payload = {
        customer_id: args.customer_id,
        invoice_date: args.invoice_date,
        due_date: args.due_date,
        invoice_number: invoiceNumber,
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

      const res = await api.post<{ data: InvoiceRecord }>("/invoices", payload);
      const inv = res.data;
      return text(`Invoice #${inv.invoice_number} created (id ${inv.id}), total ${formatMinor(inv.total)}.`);
    },
  );

  server.registerTool(
    "update_invoice",
    {
      description: "Update fields on an existing invoice.",
      inputSchema: {
        invoiceId: z.number(),
        invoice_date: z.string().optional(),
        due_date: z.string().optional(),
        reference_number: z.string().optional(),
        notes: z.string().optional(),
        template_name: z.string().optional(),
        items: z.array(lineItemSchema).optional(),
      },
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    async ({ invoiceId, items, ...rest }) => {
      // PUT validates like create, so start from the stored invoice and overlay the changes.
      const cur = (await api.get<{ data: InvoiceRecord }>(`/invoices/${invoiceId}`)).data;
      const base: Record<string, unknown> = {
        customer_id: cur.customer_id,
        invoice_number: cur.invoice_number,
        invoice_date: cur.invoice_date?.slice(0, 10),
        due_date: cur.due_date?.slice(0, 10),
        reference_number: cur.reference_number,
        notes: cur.notes,
        template_name: cur.template_name,
        exchange_rate: 1,
        discount_type: "fixed",
        discount: "0.00",
        discount_val: 0,
        tax_per_item: "NO",
        discount_per_item: "NO",
        sub_total: cur.sub_total,
        tax: cur.tax,
        total: cur.total,
        items: cur.items,
      };
      let extra: Record<string, unknown> = {};
      if (items) {
        const { items: priced, subTotal } = priceItems(items as LineItemInput[]);
        extra = { items: priced, sub_total: subTotal, tax: 0, total: subTotal };
      }
      await api.put(`/invoices/${invoiceId}`, { ...base, ...rest, ...extra });
      return text(`Invoice #${invoiceId} updated.`);
    },
  );

  server.registerTool(
    "delete_invoice",
    {
      description: "Delete an invoice by ID.",
      inputSchema: { invoiceId: z.number() },
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async ({ invoiceId }) => {
      await api.delete(`/invoices/${invoiceId}`);
      return text(`Invoice #${invoiceId} deleted.`);
    },
  );

  server.registerTool(
    "send_invoice",
    {
      description:
        "Email an invoice to its customer. Looks up the sender address and the customer's email automatically.",
      inputSchema: {
        invoiceId: z.number(),
        subject: z.string().optional(),
        body: z.string().optional(),
      },
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    async ({ invoiceId, subject, body }) => {
      const invRes = await api.get<{ data: InvoiceRecord }>(`/invoices/${invoiceId}`);
      const invoice = invRes.data;
      const customerEmail = invoice.customer?.email;
      if (!customerEmail) {
        throw new Error(
          `Customer "${invoice.customer?.name}" (id ${invoice.customer_id}) has no email on file. Set one with update_customer first.`,
        );
      }

      const settingsRes = await api.get<{ mail_username: string | null }>("/settings", { key: "mail_username" });
      const fromEmail = settingsRes.mail_username;
      if (!fromEmail) {
        throw new Error("No mail_username configured in company settings, set up SMTP first.");
      }

      await api.post(`/invoices/${invoiceId}/send`, {
        from: fromEmail,
        to: customerEmail,
        subject: subject ?? `Deine Rechnung ${invoice.invoice_number}`,
        body: body ?? `Hallo,\n\nanbei findest du deine Rechnung ${invoice.invoice_number}.\n\nViele Grüße\nTobias`,
      });
      return text(`Invoice #${invoice.invoice_number} sent to ${customerEmail} (from ${fromEmail}).`);
    },
  );
}
