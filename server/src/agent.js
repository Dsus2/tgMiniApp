const gigachat = require('./gigachat');
const menu = require('./menuCatalog');
const cart = require('./cartStore');

const FUNCTIONS = [
  {
    name: 'add_items_to_cart',
    description: 'Добавляет один или несколько товаров в корзину заказа за один вызов (если клиент назвал несколько позиций сразу — передай их все в одном массиве items, не вызывай функцию по отдельности на каждый товар).',
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              product_name: { type: 'string', description: 'Название товара так, как его назвал клиент' },
              quantity: { type: 'integer', description: 'Количество' },
              modifiers: {
                type: 'array',
                items: { type: 'string' },
                description: 'Модификаторы/опции для ЭТОГО товара, если клиент их называл (например "без кунжута", "двойной сыр", "размер L"). Если у товара есть обязательный выбор без влияния на цену (например, бортик с кунжутом или без) и клиент его не уточнил — оставь пустым, система сама подставит вариант по умолчанию. Но если обязательный выбор — это размер/вариант с РАЗНОЙ ценой (например, S/M/L) и клиент его не назвал, товар не добавится — функция вернёт needsChoice с реальными вариантами и ценами, которые нужно предложить клиенту.',
              },
            },
            required: ['product_name', 'quantity'],
          },
        },
      },
      required: ['items'],
    },
  },
  {
    name: 'view_cart',
    description: 'Показывает текущее содержимое корзины и сумму',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'remove_from_cart',
    description: 'Убирает товар из корзины по названию',
    parameters: {
      type: 'object',
      properties: { product_name: { type: 'string' } },
      required: ['product_name'],
    },
  },
  {
    name: 'set_delivery_address',
    description: 'Устанавливает адрес доставки и рассчитывает её стоимость. Обязательно вызови перед checkout.',
    parameters: {
      type: 'object',
      properties: { address: { type: 'string', description: 'Улица, дом, квартира' } },
      required: ['address'],
    },
  },
  {
    name: 'checkout',
    description: 'Вызови, когда клиент хочет оформить и оплатить заказ. Оплата происходит не в чате — функция просто проверяет готовность заказа (есть товары и адрес доставки) и говорит клиенту открыть вкладку "Корзина" для ввода имени/телефона и реальной оплаты.',
    parameters: { type: 'object', properties: {} },
  },
];

// Real payment/order submission only happens from the Cart tab's own form
// (name + phone + "Оформить"), not through chat — a chat bubble has no
// place to render a clickable payment link or collect structured contact
// fields. The AI's job stops at "cart is ready, go pay."
function checkoutGuidance(sessionId) {
  const c = cart.publicCart(sessionId);
  if (c.lines.length === 0) return { ready: false, reason: 'Корзина пуста' };
  if (c.deliveryPrice == null) return { ready: false, reason: 'Адрес доставки ещё не указан' };
  return { ready: true, grandTotal: c.grandTotal, instruction: 'Скажи клиенту открыть вкладку "Корзина" внизу экрана, указать имя и телефон и нажать "Оформить заказ" для оплаты.' };
}

// Only lets through items the customer actually said somewhere in this
// conversation (see menu.mentionedInText) — an item GigaChat invented at the
// function-call level (not grounded in anything the customer typed) never
// reaches the cart; it's reported as not found instead, same as a real
// menu miss, so the model has to own up to the substitution in its reply.
async function addItemsGrounded(sessionId, items, conversationText) {
  const grounded = [];
  const rejected = [];
  for (const item of items) {
    if (!menu.mentionedInText(item.product_name || '', conversationText)) {
      rejected.push(item.product_name);
      continue;
    }
    // Same guard, per modifier: a modifier the model invented without the
    // customer having said it anywhere doesn't get silently added either.
    const groundedModifiers = [];
    for (const text of item.modifiers || []) {
      if (menu.mentionedInText(text, conversationText)) groundedModifiers.push(text);
      else rejected.push(text);
    }
    grounded.push({ ...item, modifiers: groundedModifiers });
  }
  const result = grounded.length ? await cart.addItemsByName(sessionId, grounded) : { added: [], notFound: [], modifiersNotFound: [], needsChoice: [] };
  return { ...result, rejected };
}

const TOOL_IMPL = {
  add_items_to_cart: (sessionId, args, ctx) => addItemsGrounded(sessionId, args.items, ctx.conversationText),
  view_cart: (sessionId) => Promise.resolve(cart.publicCart(sessionId)),
  remove_from_cart: (sessionId, args) => Promise.resolve(cart.removeByName(sessionId, args.product_name)),
  set_delivery_address: (sessionId, args) => cart.setDeliveryAddress(sessionId, args.address),
  checkout: (sessionId) => Promise.resolve(checkoutGuidance(sessionId)),
};

const conversations = new Map(); // sessionId -> messages[]

async function systemPrompt() {
  const menuText = await menu.menuSummaryText();
  return (
    'Ты — ассистент по приёму заказов пиццерии "Сытый Батыр" в Telegram. ' +
    'Отвечай кратко и по-русски. Используй функции для работы с корзиной и заказом — ' +
    'никогда не выдумывай цены или названия блюд, бери их только из меню ниже. ' +
    'Если клиент называет несколько товаров сразу, добавь их всех ОДНИМ вызовом add_items_to_cart. ' +
    'Если клиент уточняет опции товара ("без кунжута", "двойной сыр", "размер L") — передай их в modifiers именно у того товара, к которому они относятся. ' +
    'Если клиент не упомянул опцию — не придумывай и не спрашивай про неё специально, система сама подставит вариант по умолчанию там, где выбор не влияет на цену. ' +
    'Если add_items_to_cart вернула needsChoice — значит у товара обязательный выбор РАЗМЕРА/ВАРИАНТА с разной ценой, и товар НЕ добавлен. Перечисли клиенту реальные варианты из needsChoice с ценами и спроси, какой нужен — никогда не выбирай и не выдумывай сам. ' +
    'Если точного товара нет в меню — НИКОГДА не заменяй его молча на похожий. ' +
    'Либо прямо скажи клиенту, что товара нет, и предложи реальные варианты из меню, либо уточни, что добавить вместо него. ' +
    'В ответе всегда называй именно то, что реально добавлено в корзину, а не то, что просил клиент. ' +
    'Перед checkout обязательно уточни адрес доставки через set_delivery_address, если он ещё не известен. ' +
    'Оплата происходит не в чате, а на вкладке "Корзина" — когда клиент готов оформить заказ, вызови checkout и направь его туда.\n\n' +
    'Меню:\n' +
    menuText
  );
}

function getHistory(sessionId) {
  if (!conversations.has(sessionId)) conversations.set(sessionId, []);
  return conversations.get(sessionId);
}

function resetConversation(sessionId) {
  conversations.delete(sessionId);
}

// GigaChat doesn't reliably follow the "describe only what was actually
// added" instruction in its own prose (confirmed in testing — it sometimes
// echoes back the customer's requested item even after add_items_to_cart
// resolved it to a different real product). Rather than trust the model's
// text, append a deterministic line built straight from the function
// result, so the chat bubble can never claim something the cart doesn't
// actually contain.
function factCheckLine({ added, notFound, rejected, modifiersNotFound, needsChoice }) {
  const parts = [];
  if (added.length) {
    parts.push(
      '✅ В корзине: ' +
        added.map((i) => `${i.name}${i.modifierNames?.length ? ` (${i.modifierNames.join(', ')})` : ''} ×${i.qty}`).join(', ')
    );
  }
  if (notFound.length) {
    parts.push('⚠️ Не нашлось в меню: ' + notFound.join(', '));
  }
  if (modifiersNotFound.length) {
    parts.push('⚠️ Такого модификатора нет у этого товара: ' + modifiersNotFound.join(', '));
  }
  if (needsChoice.length) {
    parts.push(
      '⚠️ Нужно уточнить размер/вариант (товар не добавлен): ' +
        needsChoice
          .map((nc) => `${nc.name} — ${nc.groups.map((g) => g.options.map((o) => `${o.name} ${o.price}₽`).join(' / ')).join('; ')}`)
          .join(', ')
    );
  }
  if (rejected.length) {
    parts.push('⚠️ Не добавлено (похоже на замену без согласия клиента): ' + rejected.join(', '));
  }
  return parts.join('\n');
}

/**
 * Runs one user turn through GigaChat, executing however many function
 * calls it chains (capped), and returns the final reply plus the resulting
 * cart state — the client re-renders its Cart screen from this directly
 * rather than trying to parse the cart back out of the AI's prose.
 */
async function handleMessage(sessionId, userText) {
  const history = getHistory(sessionId);
  if (history.length === 0) {
    history.push({ role: 'system', content: await systemPrompt() });
  }
  history.push({ role: 'user', content: userText });

  const added = [];
  const notFound = [];
  const rejected = [];
  const modifiersNotFound = [];
  const needsChoice = [];

  for (let i = 0; i < 5; i++) {
    const message = await gigachat.chat({ messages: history, functions: FUNCTIONS });

    if (!message.function_call) {
      history.push({ role: 'assistant', content: message.content });
      const fact = factCheckLine({ added, notFound, rejected, modifiersNotFound, needsChoice });
      const reply = fact ? `${message.content}\n\n${fact}` : message.content;
      return { reply, cart: cart.publicCart(sessionId) };
    }

    const { name, arguments: args } = message.function_call;
    history.push({ role: 'assistant', content: '', function_call: message.function_call });

    const conversationText = history.filter((m) => m.role === 'user').map((m) => m.content).join(' ');
    const impl = TOOL_IMPL[name];
    const result = impl ? await impl(sessionId, args, { conversationText }) : { error: `Unknown function: ${name}` };
    if (name === 'add_items_to_cart' && result) {
      added.push(...(result.added || []));
      notFound.push(...(result.notFound || []));
      rejected.push(...(result.rejected || []));
      modifiersNotFound.push(...(result.modifiersNotFound || []));
      needsChoice.push(...(result.needsChoice || []));
    }
    history.push({ role: 'function', name, content: JSON.stringify(result) });
  }

  return { reply: 'Извините, что-то пошло не так — попробуйте переформулировать.', cart: cart.publicCart(sessionId) };
}

module.exports = { handleMessage, resetConversation };
