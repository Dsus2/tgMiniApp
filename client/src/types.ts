// Mirrors the real iiko External Menu shape, as passed through by the
// gateway's GET /v1/organizations/:id/menu (see ../../iikoGate-bot/src/menuClient.js
// for the same model used by the inline-keyboard bot prototype).

export interface SizePrice {
  sizeName?: string;
  isDefault?: boolean;
  price: number;
  weight?: number;
  buttonImageUrl?: string;
}

export interface ModifierGroupItemRef {
  id: string;
}

export interface ModifierGroup {
  id: string;
  name: string;
  // minQuantity > 0 means iiko requires at least that many picks from this
  // group — an order missing one gets rejected by iiko, so this drives the
  // "В корзину" validation in ProductDetail.tsx, not just display.
  restrictions?: { minQuantity?: number; maxQuantity?: number };
  items: ModifierGroupItemRef[];
}

export interface Product {
  productId: string;
  name: string;
  description?: string;
  sizePrices: SizePrice[];
  modifierGroups?: ModifierGroup[];
}

export interface Group {
  id: string;
  name: string;
  items: Product[];
}

export interface Modifier {
  id: string;
  name: string;
  sizePrices: SizePrice[];
  restrictions?: { maxQuantity?: number };
}

export interface MenuResponse {
  itemsGroups: Group[];
  modifiers: Modifier[];
}
