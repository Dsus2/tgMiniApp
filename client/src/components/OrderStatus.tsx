import { useEffect, useState } from 'react';
import { Placeholder, Spinner, Button } from '@telegram-apps/telegram-ui';
import { fetchOrderStatus } from '../api';

const STATUS_LABELS: Record<string, string> = {
  payment_pending: 'Проверяем оплату...',
  accepted: 'Заказ принят рестораном',
  failed: 'Не удалось создать заказ',
  cancelled: 'Заказ отменён',
};

const DELIVERY_STATUS_LABELS: Record<string, string> = {
  New: 'Готовится',
  CookingStarted: 'Готовится',
  CookingCompleted: 'Готово, ищем курьера',
  Waiting: 'Ждём курьера',
  OnWay: 'Курьер в пути',
  Delivered: 'Доставлено',
  Closed: 'Заказ завершён',
  Cancelled: 'Отменён',
};

export function OrderStatus({ externalOrderId, grandTotal, onDone }: { externalOrderId: string; grandTotal: number; onDone: () => void }) {
  const [status, setStatus] = useState<string | null>(null);
  const [deliveryStatus, setDeliveryStatus] = useState<string | null>(null);
  const [iikoNumber, setIikoNumber] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    async function poll() {
      try {
        const s = await fetchOrderStatus(externalOrderId);
        if (stopped) return;
        setStatus(s.status);
        setDeliveryStatus(s.deliveryStatus);
        setIikoNumber(s.iikoNumber);
        setError(s.error?.message ?? null);
      } catch (err) {
        if (!stopped) setError(err instanceof Error ? err.message : String(err));
      }
    }
    poll();
    const interval = setInterval(poll, 8000);
    return () => {
      stopped = true;
      clearInterval(interval);
    };
  }, [externalOrderId]);

  const label = (deliveryStatus && DELIVERY_STATUS_LABELS[deliveryStatus]) || (status && STATUS_LABELS[status]) || 'Обрабатываем заказ...';

  return (
    <Placeholder
      header={label}
      description={
        iikoNumber ? `Заказ №${iikoNumber} · ${grandTotal.toFixed(0)} ₽` : `Заказ ${externalOrderId} · ${grandTotal.toFixed(0)} ₽`
      }
    >
      {status !== 'failed' && status !== 'cancelled' && !error && <Spinner size="m" />}
      {error && <p style={{ color: '#e5484d' }}>{error}</p>}
      <div style={{ marginTop: 16 }}>
        <Button mode="plain" onClick={onDone}>
          В меню
        </Button>
      </div>
    </Placeholder>
  );
}
