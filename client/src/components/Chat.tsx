import { useEffect, useRef, useState } from 'react';
import { Button, Input, Text, Spinner, Placeholder } from '@telegram-apps/telegram-ui';
import type { CartState } from '../api';
import { sendChatMessage } from '../api';
import { Header } from './Header';

const SUGGESTIONS = ['Что у вас есть из пиццы?', 'Хочу две Маргариты и колу', 'Какая доставка на Коммунистическую 51?'];

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
}

export function Chat({ onCartChange }: { onCartChange: (cart: CartState) => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, sending]);

  async function send(override?: string) {
    const text = (override ?? draft).trim();
    if (!text || sending) return;
    setDraft('');
    setError(null);
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'user', text }]);
    setSending(true);
    try {
      const { reply, cart } = await sendChatMessage(text);
      setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'assistant', text: reply }]);
      onCartChange(cart);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Header title="ИИ-ассистент" subtitle="Закажите прямо в чате" />
      <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
        {messages.length === 0 && (
          <>
            <Placeholder
              header="Чем помочь?"
              description='Напишите, что хотите заказать, или выберите подсказку ниже'
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 16px' }}>
              {SUGGESTIONS.map((s) => (
                <Button key={s} mode="bezeled" size="s" onClick={() => send(s)}>
                  {s}
                </Button>
              ))}
            </div>
          </>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            style={{
              display: 'flex',
              alignItems: 'flex-end',
              gap: 6,
              justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
              marginBottom: 8,
            }}
          >
            {m.role === 'assistant' && <span style={{ fontSize: 18 }}>🤖</span>}
            <div
              style={{
                maxWidth: '78%',
                padding: '8px 12px',
                borderRadius: 14,
                borderBottomLeftRadius: m.role === 'assistant' ? 4 : 14,
                borderBottomRightRadius: m.role === 'user' ? 4 : 14,
                background: m.role === 'user' ? 'var(--tgui--link_color)' : 'var(--tgui--secondary_bg_color)',
                color: m.role === 'user' ? 'var(--tgui--button_text_color, white)' : 'var(--tgui--text_color)',
              }}
            >
              <Text>{m.text}</Text>
            </div>
          </div>
        ))}
        {sending && (
          <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 8 }}>
            <Spinner size="s" />
          </div>
        )}
        {error && (
          <Text style={{ color: '#e5484d', display: 'block', marginTop: 8 }}>{error}</Text>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, padding: 12, borderTop: '1px solid var(--tgui--outline)' }}>
        <div style={{ flex: 1 }}>
          <Input
            placeholder="Напишите сообщение..."
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') send();
            }}
          />
        </div>
        <Button mode="filled" onClick={() => send()} disabled={!draft.trim() || sending}>
          ➤
        </Button>
      </div>
    </div>
  );
}
