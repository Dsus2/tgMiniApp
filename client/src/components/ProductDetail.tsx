import { useState } from 'react';
import { Button, Card, Chip, SegmentedControl, Title, Text, Caption, Subheadline } from '@telegram-apps/telegram-ui';
import type { Product, Modifier } from '../types';
import { modifierPrice } from '../api';
import { computeTotal, defaultSelectionFor, unsatisfiedRequiredGroups, type Selection } from '../lib/pricing';
import { buildCartLine, type CartLine } from '../lib/cart';

export function ProductDetail({
  product,
  groupId,
  modifiersById,
  onBack,
  onAddToCart,
}: {
  product: Product;
  groupId: string;
  modifiersById: Map<string, Modifier>;
  onBack: () => void;
  onAddToCart: (line: CartLine) => void;
}) {
  const [selection, setSelection] = useState<Selection>(() => defaultSelectionFor(product, modifiersById));

  const photo = product.sizePrices?.[selection.sizeIndex]?.buttonImageUrl;
  const weight = product.sizePrices?.[selection.sizeIndex]?.weight;
  const total = computeTotal(product, selection, modifiersById);
  const missingGroups = unsatisfiedRequiredGroups(product, selection);

  function toggleModifier(groupIndex: number, itemIndex: number, max: number | undefined) {
    const key = `${groupIndex}:${itemIndex}`;
    setSelection((prev) => {
      const keys = new Set(prev.modifierKeys);
      const limit = max ?? Infinity;
      if (keys.has(key)) {
        keys.delete(key);
      } else {
        const inGroup = [...keys].filter((k) => k.startsWith(`${groupIndex}:`));
        if (limit === 1) {
          inGroup.forEach((k) => keys.delete(k));
          keys.add(key);
        } else if (inGroup.length < limit) {
          keys.add(key);
        } // else: at limit, ignore the click
      }
      return { ...prev, modifierKeys: keys };
    });
  }

  return (
    <div style={{ paddingBottom: 24 }}>
      <div style={{ padding: 12 }}>
        <Button mode="plain" size="s" onClick={onBack}>
          « Назад
        </Button>
      </div>

      {photo && (
        <Card style={{ margin: '0 12px 12px' }}>
          <img src={photo} alt={product.name} style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', display: 'block' }} />
        </Card>
      )}

      <div style={{ padding: '0 16px' }}>
        <Title level="2">{product.name}</Title>
        {product.description && (
          <Text style={{ display: 'block', marginTop: 4, opacity: 0.8 }}>{product.description}</Text>
        )}
        {weight && <Caption style={{ display: 'block', marginTop: 4, opacity: 0.6 }}>{weight} г</Caption>}

        {product.sizePrices.length > 1 && (
          <div style={{ marginTop: 16 }}>
            <SegmentedControl>
              {product.sizePrices.map((sp, idx) => (
                <SegmentedControl.Item
                  key={idx}
                  selected={idx === selection.sizeIndex}
                  onClick={() => setSelection((prev) => ({ ...prev, sizeIndex: idx }))}
                >
                  {sp.sizeName || `Вариант ${idx + 1}`}
                </SegmentedControl.Item>
              ))}
            </SegmentedControl>
          </div>
        )}

        {(product.modifierGroups || []).map((group, gi) => {
          const required = (group.restrictions?.minQuantity || 0) > 0;
          const incomplete = required && missingGroups.includes(group.name);
          return (
          <div key={group.id} style={{ marginTop: 16 }}>
            <Subheadline level="2" weight="2" style={incomplete ? { color: '#e5484d' } : undefined}>
              {group.name}
              {required ? ' · обязательно' : ''}
              {group.restrictions?.maxQuantity ? ` (до ${group.restrictions.maxQuantity})` : ''}
            </Subheadline>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
              {group.items.map((ref, ii) => {
                const modifier = modifiersById.get(ref.id);
                if (!modifier) return null;
                const key = `${gi}:${ii}`;
                const selected = selection.modifierKeys.has(key);
                const price = modifierPrice(modifier);
                return (
                  <Chip
                    key={key}
                    mode={selected ? 'elevated' : 'outline'}
                    onClick={() => toggleModifier(gi, ii, group.restrictions?.maxQuantity)}
                  >
                    {selected ? '✓ ' : ''}
                    {modifier.name}
                    {price ? ` +${price}₽` : ''}
                  </Chip>
                );
              })}
            </div>
          </div>
          );
        })}

        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 24 }}>
          <Button
            mode="bezeled"
            size="s"
            onClick={() => setSelection((prev) => ({ ...prev, qty: Math.max(1, prev.qty - 1) }))}
          >
            −
          </Button>
          <Text>{selection.qty}</Text>
          <Button mode="bezeled" size="s" onClick={() => setSelection((prev) => ({ ...prev, qty: prev.qty + 1 }))}>
            +
          </Button>
        </div>

        {missingGroups.length > 0 && (
          <Text style={{ display: 'block', marginTop: 12, color: '#e5484d' }}>
            Выберите: {missingGroups.join(', ')}
          </Text>
        )}

        <Button
          mode="filled"
          size="l"
          stretched
          style={{ marginTop: 16 }}
          disabled={missingGroups.length > 0}
          onClick={() => onAddToCart(buildCartLine(product, groupId, selection, modifiersById))}
        >
          В корзину · {total} ₽
        </Button>
      </div>
    </div>
  );
}
