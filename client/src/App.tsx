import { useEffect, useState } from 'react';
import { Placeholder, Spinner } from '@telegram-apps/telegram-ui';
import { loadCatalog, fetchCart, addLineToCart, resetCart, type Catalog, type CartState } from './api';
import { CategoryList } from './components/CategoryList';
import { ProductList } from './components/ProductList';
import { ProductDetail } from './components/ProductDetail';
import { Cart } from './components/Cart';
import { Chat } from './components/Chat';
import { OrderStatus } from './components/OrderStatus';
import { TabBar, type TabKey } from './components/TabBar';
import type { CartLine } from './lib/cart';

type MenuScreen = { name: 'groups' } | { name: 'items'; groupId: string } | { name: 'product'; productId: string; groupId: string };
type CompletedOrder = { externalOrderId: string; grandTotal: number };

// The bot's persistent menu button opens this Mini App with ?tab=chat (see
// setChatMenuButton in the bot's setup script) so tapping it lands the
// customer straight in the AI chat — no /app command, no extra tap to
// switch tabs. Falls back to the menu tab for any other way the app opens.
function initialTab(): TabKey {
  const requested = new URLSearchParams(window.location.search).get('tab');
  return requested === 'chat' || requested === 'cart' ? requested : 'menu';
}

export function App() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [cart, setCart] = useState<CartState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>(initialTab);
  const [menuScreen, setMenuScreen] = useState<MenuScreen>({ name: 'groups' });
  const [completedOrder, setCompletedOrder] = useState<CompletedOrder | null>(null);

  useEffect(() => {
    Promise.all([loadCatalog(), fetchCart()])
      .then(([c, cartState]) => {
        setCatalog(c);
        setCart(cartState);
      })
      .catch((err) => setError(err.message));
  }, []);

  async function addToCart(line: CartLine) {
    try {
      setCart(await addLineToCart(line));
    } catch (err) {
      // Rare in practice — ProductDetail already blocks submitting an
      // incomplete required choice — but the menu could have changed
      // server-side since this screen loaded. Stay put rather than crash;
      // the customer can just try again.
      console.error('addLineToCart failed:', err);
      return;
    }
    // Drop back to the item list of the same category after adding, so the
    // customer can keep browsing instead of staring at what they just added.
    setMenuScreen((prev) => (prev.name === 'product' ? { name: 'items', groupId: prev.groupId } : prev));
  }

  async function backToMenu() {
    setCompletedOrder(null);
    setTab('menu');
    setMenuScreen({ name: 'groups' });
    await resetCart();
    setCart(await fetchCart());
  }

  if (error) return <Placeholder header="Не удалось загрузить приложение" description={error} />;
  if (!catalog || !cart) {
    return (
      <Placeholder header="Загружаем меню...">
        <Spinner size="m" />
      </Placeholder>
    );
  }

  function renderMenu() {
    if (menuScreen.name === 'groups') {
      return <CategoryList groups={catalog!.groups} onSelect={(groupId) => setMenuScreen({ name: 'items', groupId })} />;
    }

    const group = catalog!.groups.find((g) => g.id === menuScreen.groupId);
    if (!group) return <Placeholder header="Категория не найдена" />;

    if (menuScreen.name === 'items') {
      return (
        <ProductList
          group={group}
          onSelect={(productId) => setMenuScreen({ name: 'product', productId, groupId: group.id })}
          onBack={() => setMenuScreen({ name: 'groups' })}
        />
      );
    }

    const product = group.items.find((p) => p.productId === menuScreen.productId);
    if (!product) return <Placeholder header="Товар не найден" />;

    return (
      <ProductDetail
        product={product}
        groupId={group.id}
        modifiersById={catalog!.modifiersById}
        onBack={() => setMenuScreen({ name: 'items', groupId: group.id })}
        onAddToCart={addToCart}
      />
    );
  }

  function renderCart() {
    if (completedOrder) {
      return <OrderStatus externalOrderId={completedOrder.externalOrderId} grandTotal={completedOrder.grandTotal} onDone={backToMenu} />;
    }
    return (
      <Cart
        cart={cart!}
        onCartChange={setCart}
        onBack={() => setTab('menu')}
        onOrderCreated={(externalOrderId, grandTotal) => setCompletedOrder({ externalOrderId, grandTotal })}
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <div style={{ flex: 1, overflowY: tab === 'chat' ? 'hidden' : 'auto' }}>
        {tab === 'menu' && renderMenu()}
        {tab === 'chat' && <Chat onCartChange={setCart} />}
        {tab === 'cart' && renderCart()}
      </div>
      <TabBar active={tab} onChange={setTab} badge={{ cart: cart.lines.length || undefined }} />
    </div>
  );
}

export default App;
