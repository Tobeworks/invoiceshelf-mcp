/**
 * InvoiceShelf stores money as integer minor units (cents), and requires
 * per-item and document-level totals to be sent explicitly even though the
 * server recomputes them, this is not documented on the create endpoints
 * and produces a 422 if omitted. Centralized here once instead of repeated
 * per tool.
 */

export interface LineItemInput {
  name: string;
  description?: string;
  quantity: number;
  /** Unit price in whole currency units, e.g. 140 for 140,00 EUR. */
  price: number;
}

export interface PricedItem {
  name: string;
  description?: string;
  quantity: number;
  price: number; // minor units
  total: number; // minor units
  discount_type: "fixed";
  discount_val: number;
  tax: number;
}

export function priceItems(items: LineItemInput[]): { items: PricedItem[]; subTotal: number } {
  let subTotal = 0;
  const priced = items.map((item): PricedItem => {
    const priceMinor = Math.round(item.price * 100);
    const total = priceMinor * item.quantity;
    subTotal += total;
    return {
      name: item.name,
      description: item.description,
      quantity: item.quantity,
      price: priceMinor,
      total,
      discount_type: "fixed",
      discount_val: 0,
      tax: 0,
    };
  });
  return { items: priced, subTotal };
}

export function formatMinor(minorUnits: number): string {
  return (minorUnits / 100).toFixed(2);
}
