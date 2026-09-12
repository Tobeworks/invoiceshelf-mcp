# invoiceshelf-mcp

MCP server for [InvoiceShelf](https://invoiceshelf.com) (self-hosted invoicing).
Clean-room rewrite — not a fork — built against the current
`@modelcontextprotocol/sdk` (`McpServer` + `registerTool`), Zod 4, and
native `fetch`. No axios, no runtime dependencies beyond the SDK and Zod.

## Why this exists

An earlier fork of a third-party MCP server for InvoiceShelf had two bugs
(missing required fields on `create_invoice` and `send_invoice` — see
below) and no license, so a PR wasn't a clean option. Since the API's real
behavior was already fully verified by then, this is a fresh implementation
with the same 23-tool surface and both bugs fixed from the start.

## Setup

```bash
pnpm install
cp .env.example .env   # fill in your instance URL + API token
pnpm run build
pnpm run test           # smoke test: lists tools, calls test_connection
```

Add to your MCP client config:

```json
{
  "mcpServers": {
    "invoiceshelf": {
      "command": "node",
      "args": ["/absolute/path/to/invoiceshelf-mcp/dist/index.js"],
      "env": {
        "INVOICE_SHELF_BASE_URL": "https://your-instance.example.com/api/v1",
        "INVOICE_SHELF_API_TOKEN": "1|xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

## InvoiceShelf API quirks handled here

InvoiceShelf's REST API requires several fields on write endpoints that
aren't documented and produce a 422 if omitted:

- **`create_invoice` / `create_estimate`**: `invoice_number`/`estimate_number`
  (fetched from `/next-number`), `exchange_rate`, `discount_type`,
  `discount`, `discount_val`, and computed `sub_total`/`tax`/`total` plus
  per-item totals. Handled in [`src/money.ts`](src/money.ts) and the
  `create_*` tools — callers just pass euro amounts and line items.
- **`send_invoice` / `send_estimate`**: the send endpoint needs `from` and
  `to` in the body. `to` comes from the customer's email on the
  invoice/estimate record, `from` from the company's `mail_username`
  setting. Both are looked up automatically.

## Tools

23 tools across invoices, estimates, customers, and account
info/dashboard — see [`src/tools/`](src/tools/) for the full list and
schemas.

## License

MIT — see [LICENSE](LICENSE).
