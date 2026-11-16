const config = require('./config');

// Loads and caches the branch's menu from the gateway, same source the
// client's own /api/menu passthrough uses — cached here too so the AI
// agent's product search doesn't refetch on every message.
let cache = null; // { raw, groups, productsById, modifiersById }

async function fetchMenu() {
  const res = await fetch(`${config.gatewayBaseUrl}/v1/organizations/${config.organizationId}/menu`, {
    headers: { 'X-API-Key': config.gatewayApiKey },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gateway menu request failed: ${res.status} ${body}`);
  }
  return res.json();
}

async function load() {
  const menu = await fetchMenu();

  const modifiersById = new Map();
  for (const modifier of menu.modifiers || []) modifiersById.set(modifier.id, modifier);

  // Hides a main dish priced 0₽ in iiko — almost always a pricing mistake on
  // iiko's side (a forgotten price, a miscategorized promo item), never
  // something safe to sell as-is (confirmed against the real menu: a whole
  // "Блины" category turned out to be entirely 0₽ with no sign it was meant
  // to be — likely just unpriced). Two legitimate exceptions, both real:
  // 1. A dish that's genuinely 0₽ on its own because its ENTIRE price lives
  //    in a required modifier group with differently-priced options (e.g.
  //    "Донер Хан" is 0₽ in the catalog — S/M/L at 275/362/406₽ is the real
  //    price; see fillRequiredModifiers/unresolvedRequiredGroups above).
  // 2. A genuinely free promo item — the menu has real examples like
  //    "Пицца в подарок 0 руб Маргарита" and "...картофель фри в подарок" —
  //    0₽ there is the whole point, signaled by "подарок" in the name or
  //    group (same signal isDeprioritizedGroup already uses for search).
  // Modifiers themselves are never filtered by this — only top-level dishes.
  function isSellableProduct(item, groupName) {
    const basePrice = item.sizePrices?.[0]?.price ?? 0;
    if (basePrice > 0) return true;
    if (isDeprioritizedGroup(groupName) || /подарок/i.test(item.name || '')) return true;
    for (const group of item.modifierGroups || []) {
      if ((group.restrictions?.minQuantity || 0) > 0 && !groupIsUniformPrice(group, modifiersById)) return true;
    }
    return false;
  }

  // "Тех. папка" stays fully excluded (internal line items, never meant for
  // customers — see isExcludedGroup below); on top of that, a category left
  // with no sellable items after the 0₽ filter disappears too, rather than
  // showing an empty or all-broken section.
  const filteredGroups = [];
  for (const group of menu.itemsGroups || []) {
    if (isExcludedGroup(group.name)) continue;
    const items = (group.items || []).filter((item) => isSellableProduct(item, group.name));
    if (items.length === 0) continue;
    filteredGroups.push({ ...group, items });
  }

  const productsById = new Map();
  for (const group of filteredGroups) {
    for (const item of group.items) {
      productsById.set(item.productId, { ...item, groupId: group.id, groupName: group.name });
    }
  }

  cache = {
    // Same filtering applies to what the client's /api/menu passthrough
    // serves (see getRawMenu) — the customer's menu and what the AI can
    // find/sell are always the same set, never out of sync.
    raw: { ...menu, itemsGroups: filteredGroups },
    groups: filteredGroups,
    productsById,
    modifiersById,
  };
  return cache;
}

async function ensureLoaded() {
  if (!cache) await load();
  return cache;
}

async function getRawMenu() {
  const { raw } = await ensureLoaded();
  return raw;
}

async function getProduct(productId) {
  const { productsById } = await ensureLoaded();
  return productsById.get(productId) || null;
}

function normalizeText(s) {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Crude suffix strip so Russian case forms ("колу", "маргариту") compare
// equal to the catalog's nominative-form names — not linguistically
// precise, good enough for short menu-item nouns.
const CASE_SUFFIXES = ['ами', 'ями', 'ом', 'ем', 'ой', 'ей', 'а', 'я', 'у', 'ю', 'ы', 'и', 'е', 'о'];
function stem(word) {
  if (word.length <= 3) return word;
  for (const suf of CASE_SUFFIXES) {
    if (word.endsWith(suf) && word.length - suf.length >= 3) return word.slice(0, -suf.length);
  }
  return word;
}

// A few catalog items are named in Latin script (e.g. "Evervess Cola")
// while customers type Cyrillic, in any case. Keyed by stem, not the raw
// word, so every case form of "кола" resolves the same way.
const STEM_SYNONYMS = { кол: 'cola', спрайт: 'sprite', фант: 'fanta', пепс: 'pepsi' };

function expandWords(words) {
  const expanded = new Set();
  for (const w of words) {
    const s = stem(w);
    expanded.add(w);
    expanded.add(s);
    if (STEM_SYNONYMS[s]) expanded.add(STEM_SYNONYMS[s]);
  }
  return expanded;
}

function isExcludedGroup(groupName) {
  return /тех\.?\s*папка/i.test(groupName || '');
}
function isDeprioritizedGroup(groupName) {
  return /^доп/i.test(groupName || '') || /подарок/i.test(groupName || '');
}

/**
 * Fuzzy-matches free-text product names (from the AI, extracted from the
 * customer's own words) against the real catalog — whole-word overlap only,
 * never raw substring containment (that previously matched "кола" inside
 * "шоколадлы"). "Тех. папка" (internal line items) is excluded outright,
 * and "Допы"/"Подарок" are deprioritized so a bare dish name resolves to
 * the actual paid dish, not a topping sold standalone or a 0₽ promo twin.
 */
async function searchProduct(query) {
  const { productsById } = await ensureLoaded();
  const q = normalizeText(query);
  const qWords = expandWords(q.split(' ').filter(Boolean));
  let best = null;
  let bestScore = -Infinity;

  for (const product of productsById.values()) {
    if (isExcludedGroup(product.groupName)) continue;

    const name = normalizeText(product.name);
    const nameWords = name.split(' ').filter(Boolean).map(stem);

    let score = 0;
    if (name === q) {
      score = 100;
    } else {
      const matched = nameWords.filter((w) => qWords.has(w));
      score = matched.length * 20;
      if (matched.length > 0 && matched.length === qWords.size) score += 10;
    }
    if (isDeprioritizedGroup(product.groupName)) score -= 15;

    if (score > bestScore) {
      bestScore = score;
      best = product;
    }
  }

  return bestScore >= 20 ? best : null;
}

// Guards against the AI silently substituting a product at the function-call
// level (observed in testing: asked for "Фанта" — not on the menu — GigaChat
// called add_items_to_cart with product_name "Кола" directly, never surfacing
// that it swapped them). `name` only counts as grounded if it shares a
// stemmed word with something the customer actually typed; a name grounded
// nowhere in the conversation is treated as the model's own invention, not
// the customer's request, regardless of whether it matches a real product.
function mentionedInText(name, text) {
  const nameWords = new Set(normalizeText(name).split(' ').filter(Boolean).map(stem));
  // Same direction as searchProduct: expand the customer's own words (which
  // may be in Cyrillic, e.g. "колу") so they also match a Latin-script
  // catalog name like "Evervess Cola".
  const textWords = expandWords(normalizeText(text || '').split(' ').filter(Boolean));
  for (const w of textWords) if (nameWords.has(w)) return true;
  return false;
}

async function getModifier(modifierId) {
  const { modifiersById } = await ensureLoaded();
  return modifiersById.get(modifierId) || null;
}

/**
 * Fuzzy-matches free-text (from the AI) against ONE product's own
 * modifierGroups only — never the whole catalog, so "без кунжута" on one
 * pizza can't accidentally resolve to an unrelated modifier on another
 * product. Returns the matched modifier plus which group it belongs to.
 */
async function searchProductModifier(product, query) {
  const { modifiersById } = await ensureLoaded();
  const q = normalizeText(query);
  const qWords = expandWords(q.split(' ').filter(Boolean));
  let best = null;
  let bestScore = -Infinity;

  for (const group of product.modifierGroups || []) {
    for (const ref of group.items || []) {
      const modifier = modifiersById.get(ref.id);
      if (!modifier) continue;
      const name = normalizeText(modifier.name);
      const nameWords = name.split(' ').filter(Boolean).map(stem);
      const matched = nameWords.filter((w) => qWords.has(w));
      const score = matched.length * 20 + (matched.length === qWords.size ? 10 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = { group, modifier };
      }
    }
  }

  return bestScore >= 20 ? best : null;
}

function modifierLinePrice(modifier) {
  return modifier?.sizePrices?.[0]?.price ?? 0;
}

/**
 * True when every option in a required group costs the same (almost always
 * 0₽) — "crust: with/without sesame", "soup: lentil/chicken/mushroom inside
 * a fixed-price combo". Defaulting one of these has no cost consequence.
 * False means the group is really a priced size/variant picker in disguise
 * (observed in the real menu: "Донер Хан" the base dish is 0₽ in the
 * catalog and its ENTIRE price comes from this "required modifier" —
 * S/M/L at 275/362/406₽). Auto-picking one of those would silently charge
 * the customer for a size they never chose — must be asked explicitly
 * instead, same as iiko itself requires.
 */
function groupIsUniformPrice(group, modifiersById) {
  const prices = (group.items || []).map((ref) => modifierLinePrice(modifiersById.get(ref.id)));
  return prices.every((p) => p === prices[0]);
}

/**
 * Fills in any required modifier group (restrictions.minQuantity > 0) that
 * `chosen` doesn't already cover AND where every option costs the same —
 * safe to default without changing what the customer pays. Required groups
 * where options have different prices are left alone on purpose; see
 * unresolvedRequiredGroups below for those.
 */
async function fillRequiredModifiers(product, chosen) {
  const { modifiersById } = await ensureLoaded();
  const result = [...chosen];
  for (const group of product.modifierGroups || []) {
    const minQuantity = group.restrictions?.minQuantity || 0;
    if (minQuantity <= 0) continue;
    if (!groupIsUniformPrice(group, modifiersById)) continue;
    for (const ref of group.items || []) {
      if (result.filter((m) => m.groupId === group.id).length >= minQuantity) break;
      if (result.some((m) => m.productId === ref.id)) continue;
      const modifier = modifiersById.get(ref.id);
      if (!modifier) continue;
      result.push({ productId: ref.id, groupId: group.id, name: modifier.name, price: modifierLinePrice(modifier), auto: true });
    }
  }
  return result;
}

/**
 * Required groups STILL unsatisfied after fillRequiredModifiers — by
 * construction these are exactly the priced size/variant pickers that
 * can't be safely guessed. Returns each with its real options (name +
 * price) so the caller can ask the customer rather than add a line with an
 * unknown or wrong price.
 */
async function unresolvedRequiredGroups(product, chosen) {
  const { modifiersById } = await ensureLoaded();
  const unresolved = [];
  for (const group of product.modifierGroups || []) {
    const minQuantity = group.restrictions?.minQuantity || 0;
    if (minQuantity <= 0) continue;
    const count = chosen.filter((m) => m.groupId === group.id).length;
    if (count >= minQuantity) continue;
    const options = (group.items || [])
      .map((ref) => modifiersById.get(ref.id))
      .filter(Boolean)
      .map((m) => ({ id: m.id, name: m.name, price: modifierLinePrice(m) }));
    unresolved.push({ groupId: group.id, groupName: group.name, options });
  }
  return unresolved;
}

// Condensed real menu text for GigaChat's system prompt, so it answers from
// actual items/prices instead of inventing plausible-sounding ones.
async function menuSummaryText() {
  const { groups } = await ensureLoaded();
  const lines = [];
  for (const group of groups) {
    if (isExcludedGroup(group.name)) continue;
    lines.push(`## ${group.name}`);
    for (const item of group.items) {
      const price = item.sizePrices?.[0]?.price;
      lines.push(`- ${item.name}${price != null ? ` — ${price}₽` : ''}`);
    }
  }
  return lines.join('\n');
}

module.exports = {
  load,
  getRawMenu,
  getProduct,
  searchProduct,
  menuSummaryText,
  mentionedInText,
  getModifier,
  searchProductModifier,
  fillRequiredModifiers,
  unresolvedRequiredGroups,
  groupIsUniformPrice,
  modifierLinePrice,
};
