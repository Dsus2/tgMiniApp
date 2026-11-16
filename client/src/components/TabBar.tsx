// telegram-ui has no dedicated bottom-tab-bar component (only SegmentedControl/
// TabsList, meant for in-page tab strips) — a plain fixed-bottom row of
// buttons is the simplest way to get persistent navigation between the
// three screens without reaching for a different UI kit.
export type TabKey = 'menu' | 'chat' | 'cart';

const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: 'menu', label: 'Меню', icon: '🍕' },
  { key: 'chat', label: 'Чат с ИИ', icon: '💬' },
  { key: 'cart', label: 'Корзина', icon: '🛒' },
];

export function TabBar({ active, onChange, badge }: { active: TabKey; onChange: (tab: TabKey) => void; badge?: Partial<Record<TabKey, number>> }) {
  return (
    <div
      style={{
        position: 'sticky',
        bottom: 0,
        display: 'flex',
        borderTop: '1px solid var(--tgui--outline)',
        background: 'var(--tgui--bg_color)',
      }}
    >
      {TABS.map((tab) => {
        const isActive = tab.key === active;
        const count = badge?.[tab.key];
        return (
          <button
            key={tab.key}
            onClick={() => onChange(tab.key)}
            style={{
              position: 'relative',
              flex: 1,
              border: 'none',
              background: 'transparent',
              padding: '10px 0 10px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 2,
              color: isActive ? 'var(--tgui--link_color)' : 'var(--tgui--hint_color)',
              fontWeight: isActive ? 600 : 400,
              transition: 'color 0.15s',
            }}
          >
            {isActive && (
              <span
                style={{
                  position: 'absolute',
                  top: 0,
                  left: '30%',
                  right: '30%',
                  height: 2,
                  borderRadius: 2,
                  background: 'var(--tgui--link_color)',
                }}
              />
            )}
            <span style={{ fontSize: 20, position: 'relative' }}>
              {tab.icon}
              {!!count && (
                <span
                  style={{
                    position: 'absolute',
                    top: -4,
                    right: -10,
                    background: 'var(--tgui--destructive_text_color, #e5484d)',
                    color: 'white',
                    borderRadius: 8,
                    fontSize: 10,
                    fontWeight: 700,
                    padding: '1px 5px',
                    lineHeight: '12px',
                  }}
                >
                  {count}
                </span>
              )}
            </span>
            <span style={{ fontSize: 11 }}>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}
