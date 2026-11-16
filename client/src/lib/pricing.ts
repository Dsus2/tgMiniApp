import type { Product, Modifier, ModifierGroup } from '../types';
import { modifierPrice } from '../api';

export interface Selection {
  sizeIndex: number;
  modifierKeys: Set<string>; // "groupIndex:itemIndex"
  qty: number;
}

export function initialSelection(): Selection {
  return { sizeIndex: 0, modifierKeys: new Set(), qty: 1 };
}

// Some "required, pick exactly 1" groups are really a priced size/variant
// picker in disguise — e.g. the real menu has a dish priced 0₽ on its own
// where the ENTIRE price comes from this "modifier" (S/M/L at different
// prices). Pre-selecting one of those would silently charge the customer
// for a size they never chose. Safe to default only when every option in
// the group costs the same (almost always 0₽, e.g. "crust: with/without
// sesame") — no price consequence either way.
function groupIsUniformPrice(group: ModifierGroup, modifiersById: Map<string, Modifier>): boolean {
  const prices = group.items.map((ref) => modifierPrice(modifiersById.get(ref.id)));
  return prices.every((p) => p === prices[0]);
}

// Pre-picks the first option for any group where exactly one choice is
// required (minQuantity === maxQuantity === 1) AND every option costs the
// same — the common, price-safe case ("crust: with/without sesame"), the
// one UX benefits most from not forcing a tap on. Everything else
// (multi-pick required groups, or a required group with differently-priced
// options) is left for the customer to fill in themselves;
// unsatisfiedRequiredGroups() blocks submit until they do.
export function defaultSelectionFor(product: Product, modifiersById: Map<string, Modifier>): Selection {
  const selection = initialSelection();
  (product.modifierGroups || []).forEach((group, gi) => {
    const { minQuantity, maxQuantity } = group.restrictions || {};
    if (minQuantity === 1 && maxQuantity === 1 && group.items.length > 0 && groupIsUniformPrice(group, modifiersById)) {
      selection.modifierKeys.add(`${gi}:0`);
    }
  });
  return selection;
}

// Names of required groups the current selection hasn't satisfied yet —
// empty means the "В корзину" button may be enabled. iiko rejects an order
// missing one of these, so this isn't just a UX nicety.
export function unsatisfiedRequiredGroups(product: Product, selection: Selection): string[] {
  const missing: string[] = [];
  (product.modifierGroups || []).forEach((group, gi) => {
    const minQuantity = group.restrictions?.minQuantity || 0;
    if (minQuantity <= 0) return;
    const count = [...selection.modifierKeys].filter((k) => k.startsWith(`${gi}:`)).length;
    if (count < minQuantity) missing.push(group.name);
  });
  return missing;
}

export function computeTotal(product: Product, selection: Selection, modifiersById: Map<string, Modifier>): number {
  const basePrice = product.sizePrices?.[selection.sizeIndex]?.price ?? 0;
  let modifiersTotal = 0;
  for (const key of selection.modifierKeys) {
    const [gi, ii] = key.split(':').map(Number);
    const modId = product.modifierGroups?.[gi]?.items?.[ii]?.id;
    const modifier = modId ? modifiersById.get(modId) : undefined;
    if (modifier) modifiersTotal += modifierPrice(modifier);
  }
  return (basePrice + modifiersTotal) * selection.qty;
}
