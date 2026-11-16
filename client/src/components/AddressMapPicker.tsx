import { useEffect, useRef, useState } from 'react';
import { Button, Placeholder, Spinner, Text } from '@telegram-apps/telegram-ui';

// Restaurant chain operates in Ufa — center the map there by default so the
// customer isn't dropped somewhere irrelevant before they pan/search.
const DEFAULT_CENTER: [number, number] = [54.7388, 55.9721]; // [lat, lon]
const DEFAULT_ZOOM = 13;

declare global {
  interface Window {
    ymaps?: {
      ready: (cb: () => void) => void;
      Map: new (el: HTMLElement, state: { center: [number, number]; zoom: number; controls?: string[] }) => YMap;
    };
  }
}

interface YMap {
  getCenter: () => [number, number];
  setCenter: (center: [number, number], zoom?: number) => void;
  destroy: () => void;
}

let scriptLoadPromise: Promise<void> | null = null;

function loadYmaps(apiKey: string): Promise<void> {
  if (window.ymaps) return Promise.resolve();
  if (scriptLoadPromise) return scriptLoadPromise;

  scriptLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://api-maps.yandex.ru/2.1/?apikey=${apiKey}&lang=ru_RU`;
    script.onload = () => window.ymaps!.ready(() => resolve());
    script.onerror = () => reject(new Error('Не удалось загрузить Яндекс Карты'));
    document.head.appendChild(script);
  });
  return scriptLoadPromise;
}

/**
 * Full-screen "drag the map, pin stays centered" picker for the exact
 * delivery point. No geocoding service involved on either end — it only
 * hands back coordinates; the customer still types the readable address
 * themselves (same as before this picker existed), and the gateway already
 * prefers coordinates over text geocoding when both are present.
 */
export function AddressMapPicker({
  apiKey,
  onConfirm,
  onCancel,
}: {
  apiKey: string;
  onConfirm: (result: { latitude: number; longitude: number }) => void;
  onCancel: () => void;
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<YMap | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    loadYmaps(apiKey)
      .then(() => {
        if (cancelled || !mapRef.current || !window.ymaps) return;
        const map = new window.ymaps.Map(mapRef.current, {
          center: DEFAULT_CENTER,
          zoom: DEFAULT_ZOOM,
          controls: ['zoomControl', 'geolocationControl'],
        });
        mapInstanceRef.current = map;
        setLoading(false);
      })
      .catch((err) => !cancelled && setError(err.message));

    return () => {
      cancelled = true;
      mapInstanceRef.current?.destroy();
    };
  }, [apiKey]);

  function confirm() {
    const map = mapInstanceRef.current;
    if (!map) return;
    const [latitude, longitude] = map.getCenter();
    onConfirm({ latitude, longitude });
  }

  if (error) {
    return <Placeholder header="Карта недоступна" description={error}>
      <Button mode="plain" onClick={onCancel}>Назад</Button>
    </Placeholder>;
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--tgui--bg_color)', zIndex: 1000, display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, position: 'relative' }}>
        <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
        {loading && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Spinner size="l" />
          </div>
        )}
        {/* Fixed center pin — the map moves under it, not the other way round. */}
        {!loading && (
          <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -100%)', fontSize: 36, pointerEvents: 'none' }}>
            📍
          </div>
        )}
      </div>
      <div style={{ padding: 16, borderTop: '1px solid var(--tgui--outline)', background: 'var(--tgui--bg_color)' }}>
        <Text style={{ display: 'block', marginBottom: 10, minHeight: 20 }}>
          Переместите карту так, чтобы пин встал на нужную точку
        </Text>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button mode="plain" onClick={onCancel}>
            Отмена
          </Button>
          <Button mode="filled" stretched onClick={confirm} disabled={loading}>
            Выбрать эту точку
          </Button>
        </div>
      </div>
    </div>
  );
}
