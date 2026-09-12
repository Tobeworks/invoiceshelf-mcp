// Minimal smoke test: start the built server over stdio, list tools, and
// make one real read-only call (test_connection) to confirm the config and
// wire format work end to end. Not a full test suite, just enough to catch
// "it doesn't even start" before shipping.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ponytail: hand-rolled instead of a dotenv dependency, this only needs to
// read flat KEY=VALUE lines.
try {
  const envFile = readFileSync(path.join(__dirname, "..", ".env"), "utf8");
  for (const line of envFile.split("\n")) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match) process.env[match[1]] ??= match[2];
  }
} catch {
  // no .env file, fall back to whatever is already in the environment
}

const transport = new StdioClientTransport({
  command: "node",
  args: [path.join(__dirname, "..", "dist", "index.js")],
  env: {
    INVOICE_SHELF_BASE_URL: process.env.INVOICE_SHELF_BASE_URL ?? "",
    INVOICE_SHELF_API_TOKEN: process.env.INVOICE_SHELF_API_TOKEN ?? "",
  },
});

const client = new Client({ name: "smoke-test", version: "1.0.0" });
await client.connect(transport);

const { tools } = await client.listTools();
console.log(`✓ ${tools.length} tools registered:`, tools.map((t) => t.name).join(", "));

const expected = 23;
if (tools.length !== expected) {
  console.error(`✗ expected ${expected} tools, got ${tools.length}`);
  process.exit(1);
}

if (process.env.INVOICE_SHELF_API_TOKEN) {
  const result = await client.callTool({ name: "test_connection", arguments: {} });
  console.log("✓ test_connection:", result.content[0].text);
}

await client.close();
console.log("✓ smoke test passed");
