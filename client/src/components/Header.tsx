import { Title, Caption } from '@telegram-apps/telegram-ui';

// Shared brand header for the Menu/Cart/Chat screens — ProductDetail has its
// own hero image instead, so it doesn't use this.
export function Header({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div style={{ padding: '16px 16px 4px' }}>
      <Title level="1" weight="2">
        {title}
      </Title>
      {subtitle && (
        <Caption style={{ display: 'block', marginTop: 2, opacity: 0.6 }}>{subtitle}</Caption>
      )}
    </div>
  );
}
