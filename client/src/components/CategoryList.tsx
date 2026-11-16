import { Caption } from '@telegram-apps/telegram-ui';
import type { Group } from '../types';
import { Header } from './Header';

// A small set of food emoji keyed by common category-name keywords, used as
// a fallback tile when a category's items have no photo at all (e.g. drinks,
// sauces) — purely decorative, not meant to be exhaustive.
const EMOJI_BY_KEYWORD: [RegExp, string][] = [
  [/пицц/i, '🍕'],
  [/бургер/i, '🍔'],
  [/донер|шаур|гирос|пита/i, '🌯'],
  [/напит|сок|морс|чай|кофе|коктейл/i, '🥤'],
  [/десерт|торт|пончик/i, '🍰'],
  [/салат/i, '🥗'],
  [/суп/i, '🍲'],
  [/соус/i, '🥫'],
  [/закуск|фри|наггетс/i, '🍟'],
  [/хот.?дог/i, '🌭'],
  [/сэндвич/i, '🥪'],
  [/блин|коймак/i, '🥞'],
];

function categoryImage(group: Group): string | null {
  for (const item of group.items) {
    const url = item.sizePrices?.[0]?.buttonImageUrl;
    if (url) return url;
  }
  return null;
}

function categoryEmoji(name: string): string {
  const match = EMOJI_BY_KEYWORD.find(([re]) => re.test(name));
  return match ? match[1] : '🍽️';
}

export function CategoryList({ groups, onSelect }: { groups: Group[]; onSelect: (groupId: string) => void }) {
  return (
    <div style={{ paddingBottom: 16 }}>
      <Header title="Сытый Батыр" subtitle="Выберите категорию" />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: 10,
          padding: '8px 12px',
        }}
      >
        {groups.map((g) => {
          const image = categoryImage(g);
          return (
            <button
              key={g.id}
              onClick={() => onSelect(g.id)}
              style={{
                border: 'none',
                borderRadius: 14,
                overflow: 'hidden',
                background: 'var(--tgui--secondary_bg_color)',
                padding: 0,
                textAlign: 'left',
                cursor: 'pointer',
              }}
            >
              <div
                style={{
                  width: '100%',
                  aspectRatio: '4 / 3',
                  background: image ? `center / cover no-repeat url(${image})` : 'var(--tgui--outline)',
                  display: image ? undefined : 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 36,
                }}
              >
                {!image && categoryEmoji(g.name)}
              </div>
              <div style={{ padding: '8px 10px 10px' }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--tgui--text_color)' }}>{g.name}</div>
                <Caption style={{ opacity: 0.6 }}>{g.items.length} позиций</Caption>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
