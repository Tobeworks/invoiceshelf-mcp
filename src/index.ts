#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { InvoiceShelfClient } from "./api.js";
import { registerInvoiceTools } from "./tools/invoices.js";
import { registerEstimateTools } from "./tools/estimates.js";
import { registerCustomerTools } from "./tools/customers.js";
import { registerMiscTools } from "./tools/misc.js";

const baseUrl = process.env.INVOICE_SHELF_BASE_URL;
const apiToken = process.env.INVOICE_SHELF_API_TOKEN;

if (!baseUrl || !apiToken) {
  console.error("Missing INVOICE_SHELF_BASE_URL or INVOICE_SHELF_API_TOKEN environment variables.");
  process.exit(1);
}

const api = new InvoiceShelfClient({ baseUrl, apiToken });

const server = new McpServer({
  name: "invoiceshelf-mcp",
  version: "1.0.0",
});

registerInvoiceTools(server, api);
registerEstimateTools(server, api);
registerCustomerTools(server, api);
registerMiscTools(server, api);

const transport = new StdioServerTransport();
await server.connect(transport);
