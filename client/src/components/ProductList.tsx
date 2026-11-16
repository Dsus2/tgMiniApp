import { List, Section, Cell, Button } from '@telegram-apps/telegram-ui';
import type { Group } from '../types';

export function ProductList({
  group,
  onSelect,
  onBack,
}: {
  group: Group;
  onSelect: (productId: string) => void;
  onBack: () => void;
}) {
  return (
    <List>
      <div style={{ padding: 12 }}>
        <Button mode="plain" size="s" onClick={onBack}>
          « Категории
        </Button>
      </div>
      <Section header={group.name}>
        {group.items.map((item) => {
          const price = item.sizePrices?.[0]?.price;
          const image = item.sizePrices?.[0]?.buttonImageUrl;
          return (
            <Cell
              key={item.productId}
              before={
                image ? (
                  <img src={image} alt="" style={{ width: 56, height: 56, borderRadius: 12, objectFit: 'cover' }} />
                ) : (
                  <div
                    style={{
                      width: 56,
                      height: 56,
                      borderRadius: 12,
                      background: 'var(--tgui--secondary_bg_color)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 22,
                    }}
                  >
                    🍽️
                  </div>
                )
              }
              after={price != null ? <b>{price} ₽</b> : undefined}
              subtitle={item.description}
              onClick={() => onSelect(item.productId)}
              multiline
            >
              {item.name}
            </Cell>
          );
        })}
      </Section>
    </List>
  );
}
