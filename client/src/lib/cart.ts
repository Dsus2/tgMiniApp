import type { Product, Modifier } from '../types';
import { computeTotal, type Selection } from './pricing';

export interface CartModifier {
  productId: string;
  groupId: string;
  price: number;
}

export interface CartLine {
  id: string;
  productId: string;
  groupId: string;
  name: string;
  qty: number;
  unitPrice: number; // price of one unit incl. its modifiers — matches the server's field name (server/src/cartStore.js)
  lineTotal: number;
  modifierNames: string[];
  // What actually reaches iiko's order (see server/src/cartStore.js
  // finalizeOrder) — modifierNames above is display-only and never was
  // enough on its own.
  modifiers: CartModifier[];
}

export function buildCartLine(
  product: Product,
  groupId: string,
  selection: Selection,
  modifiersById: Map<string, Modifier>
): CartLine {
  const lineTotal = computeTotal(product, selection, modifiersById);
  const modifierNames: string[] = [];
  const modifiers: CartModifier[] = [];
  for (const key of selection.modifierKeys) {
    const [gi, ii] = key.split(':').map(Number);
    const group = product.modifierGroups?.[gi];
    const modId = group?.items?.[ii]?.id;
    const modifier = modId ? modifiersById.get(modId) : undefined;
    if (modifier && group) {
      modifierNames.push(modifier.name);
      modifiers.push({ productId: modifier.id, groupId: group.id, price: modifier.sizePrices?.[0]?.price ?? 0 });
    }
  }
  return {
    id: `${product.productId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    productId: product.productId,
    groupId,
    name: product.sizePrices.length > 1 ? `${product.name} (${product.sizePrices[selection.sizeIndex]?.sizeName || ''})`.trim() : product.name,
    qty: selection.qty,
    unitPrice: lineTotal / selection.qty,
    lineTotal,
    modifierNames,
    modifiers,
  };
}

export function cartTotal(lines: CartLine[]): number {
  return lines.reduce((sum, l) => sum + l.lineTotal, 0);
}

export function cartCount(lines: CartLine[]): number {
  return lines.reduce((sum, l) => sum + l.qty, 0);
}
