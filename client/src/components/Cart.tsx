import { useEffect, useRef, useState } from 'react';
import { List, Section, Cell, Button, Placeholder, Input, Text } from '@telegram-apps/telegram-ui';
import type { CartState } from '../api';
import { removeLineFromCart, setCartDeliveryAddress, setCartCustomer, startCheckout, mockPay, finalizeOrder } from '../api';
import { getWebApp } from '../telegram';
import { Header } from './Header';
import { AddressMapPicker } from './AddressMapPicker';

const YANDEX_MAPS_API_KEY = import.meta.env.VITE_YANDEX_MAPS_API_KEY as string | undefined;

export function Cart({
  cart,
  onCartChange,
  onBack,
  onOrderCreated,
}: {
  cart: CartState;
  onCartChange: (cart: CartState) => void;
  onBack: () => void;
  onOrderCreated: (externalOrderId: string, grandTotal: number) => void;
}) {
  const [address, setAddress] = useState(cart.deliveryAddress ?? '');
  const [name, setName] = useState(cart.customerName ?? '');
  const [phone, setPhone] = useState(cart.customerPhone ?? '');
  const [deliveryLoading, setDeliveryLoading] = useState(false);
  const [paying, setPaying] = useState(false);
  const [waitingForPayment, setWaitingForPayment] = useState(false);
  const [isMock, setIsMock] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [mapCoords, setMapCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  async function calcDelivery() {
    if (!address.trim()) return;
    setDeliveryLoading(true);
    setError(null);
    try {
      onCartChange(await setCartDeliveryAddress(address.trim(), mapCoords ?? undefined));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeliveryLoading(false);
    }
  }

  async function remove(lineId: string) {
    onCartChange(await removeLineFromCart(lineId));
  }

  // The map only pins down exact coordinates — no geocoding service involved.
  // The customer still types the readable address themselves (same as
  // before the map existed); calcDelivery() sends both together, and the
  // gateway already prefers coordinates over text when both are present.
  function pickFromMap(result: { latitude: number; longitude: number }) {
    setShowMap(false);
    setMapCoords(result);
  }

  function openPaymentPage(url: string) {
    const webApp = getWebApp();
    if (webApp) webApp.openLink(url);
    else window.open(url, '_blank');
  }

  async function pay() {
    setError(null);
    try {
      const customerCart = await setCartCustomer(name.trim(), phone.trim());
      onCartChange(customerCart);
    } catch {
      setError('Проверьте имя и телефон (формат +79991234567)');
      return;
    }

    setPaying(true);
    try {
      const result = await startCheckout();
      if (!result.ok) {
        setError(result.error || 'Не удалось начать оплату');
        return;
      }
      setIsMock(!!result.mock);
      if (result.confirmationUrl) openPaymentPage(result.confirmationUrl);
      setWaitingForPayment(true);
      pollRef.current = setInterval(async () => {
        const fin = await finalizeOrder();
        if (fin.ok && fin.externalOrderId) {
          if (pollRef.current) clearInterval(pollRef.current);
          setWaitingForPayment(false);
          onOrderCreated(fin.externalOrderId, fin.grandTotal ?? cart.grandTotal ?? 0);
        } else if (fin.status === 'canceled') {
          if (pollRef.current) clearInterval(pollRef.current);
          setWaitingForPayment(false);
          setError('Оплата была отменена. Попробуйте оформить заново.');
        }
        // status 'pending' — keep polling silently.
      }, 4000);
    } finally {
      setPaying(false);
    }
  }

  async function checkPaymentNow() {
    const fin = await finalizeOrder();
    if (fin.ok && fin.externalOrderId) {
      if (pollRef.current) clearInterval(pollRef.current);
      setWaitingForPayment(false);
      onOrderCreated(fin.externalOrderId, fin.grandTotal ?? cart.grandTotal ?? 0);
    } else {
      setError(fin.message || 'Оплата пока не подтверждена — попробуйте через минуту');
    }
  }

  // Test mode only — no real page to pay on, so this stands in for "the
  // customer completed payment" before immediately re-checking as usual.
  async function emulatePayment() {
    setError(null);
    const result = await mockPay();
    if (!result.ok) {
      setError(result.error || 'Не удалось эмулировать оплату');
      return;
    }
    await checkPaymentNow();
  }

  if (cart.lines.length === 0) {
    return (
      <>
        <Header title="Корзина" />
        <div style={{ padding: '0 12px 12px' }}>
          <Button mode="plain" size="s" onClick={onBack}>
            « Меню
          </Button>
        </div>
        <Placeholder header="Корзина пуста" description="Добавьте что-нибудь из меню или попросите ИИ-ассистента в чате" />
      </>
    );
  }

  if (waitingForPayment) {
    return (
      <Placeholder
        header={isMock ? 'Тестовый режим' : 'Ждём оплату'}
        description={
          isMock
            ? 'Реальная оплата не производится — нажмите ниже, чтобы эмулировать успешную оплату и продолжить.'
            : 'Завершите оплату в открывшемся окне ЮKassa, затем вернитесь сюда.'
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', marginTop: 12 }}>
          {isMock ? (
            <Button mode="filled" onClick={emulatePayment}>
              🧪 Эмулировать успешную оплату
            </Button>
          ) : (
            <Button mode="filled" onClick={checkPaymentNow}>
              Я оплатил(а) — проверить
            </Button>
          )}
          {error && <Text style={{ color: '#e5484d' }}>{error}</Text>}
        </div>
      </Placeholder>
    );
  }

  return (
    <>
      {showMap && YANDEX_MAPS_API_KEY && (
        <AddressMapPicker apiKey={YANDEX_MAPS_API_KEY} onConfirm={pickFromMap} onCancel={() => setShowMap(false)} />
      )}
    <List>
      <Header title="Корзина" />
      <div style={{ padding: '0 12px 12px' }}>
        <Button mode="plain" size="s" onClick={onBack}>
          « Меню
        </Button>
      </div>

      <Section header="Корзина">
        {cart.lines.map((line) => (
          <Cell
            key={line.id}
            subtitle={line.modifierNames.length ? line.modifierNames.join(', ') : undefined}
            after={
              <Button mode="plain" size="s" onClick={() => remove(line.id)}>
                Убрать
              </Button>
            }
            description={`${line.qty} × ${line.unitPrice.toFixed(0)} ₽ = ${line.lineTotal.toFixed(0)} ₽`}
            multiline
          >
            {line.name}
          </Cell>
        ))}
      </Section>

      <Section header="Адрес доставки">
        <Cell>
          <Input placeholder="Улица, дом, квартира" value={address} onChange={(e) => setAddress(e.target.value)} />
        </Cell>
        {mapCoords && (
          <div style={{ padding: '0 16px 8px' }}>
            <Text style={{ fontSize: 13, opacity: 0.6 }}>📍 Точка на карте уточнена</Text>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, padding: '0 16px 12px' }}>
          {YANDEX_MAPS_API_KEY && (
            <Button mode="bezeled" size="s" onClick={() => setShowMap(true)} disabled={deliveryLoading}>
              📍 Уточнить на карте
            </Button>
          )}
          <Button mode="bezeled" size="s" stretched onClick={calcDelivery} disabled={!address.trim() || deliveryLoading} loading={deliveryLoading}>
            Рассчитать доставку
          </Button>
        </div>
      </Section>

      <Section header="Получатель">
        <Cell>
          <Input placeholder="Имя" value={name} onChange={(e) => setName(e.target.value)} />
        </Cell>
        <Cell>
          <Input placeholder="Телефон, например +79991234567" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Cell>
      </Section>

      <Section header="Итого">
        <Cell after={`${cart.goodsTotal.toFixed(0)} ₽`}>Товары</Cell>
        <Cell after={cart.deliveryPrice != null ? `${cart.deliveryPrice.toFixed(0)} ₽` : '—'}>Доставка</Cell>
        <Cell after={<b>{cart.grandTotal != null ? `${cart.grandTotal.toFixed(0)} ₽` : '—'}</b>}>Итого</Cell>
      </Section>

      {error && (
        <div style={{ padding: '0 16px 12px' }}>
          <Text style={{ color: '#e5484d' }}>{error}</Text>
        </div>
      )}

      <div style={{ padding: 16 }}>
        <Button
          mode="filled"
          size="l"
          stretched
          onClick={pay}
          disabled={cart.grandTotal == null || !name.trim() || !phone.trim() || paying}
          loading={paying}
        >
          {cart.grandTotal != null ? `Оплатить · ${cart.grandTotal.toFixed(0)} ₽` : 'Сначала рассчитайте доставку'}
        </Button>
      </div>
    </List>
    </>
  );
}
