// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PermissionAsk } from '../shared/permission-asks.ts';
import { useClaudePermission } from './useClaudePermission.ts';

const ask = (id: string): PermissionAsk => ({
  id,
  kind: 'profile',
  changes: [{ label: 'When you can start', value: 'Two weeks’ notice' }],
});

describe('useClaudePermission', () => {
  it('opens each permission prompt, and keeps one put aside closed until the user opens it again', async () => {
    let tell: (ask: PermissionAsk | null) => void = () => {};
    const api = {
      claudePermission: vi.fn(async () => ask('a')),
      onClaudePermission: vi.fn((listener: (ask: PermissionAsk | null) => void) => {
        tell = listener;
        return () => {};
      }),
    };
    const { result } = renderHook(() => useClaudePermission(api));
    await vi.waitFor(() => expect(result.current).toMatchObject({ ask: { id: 'a' }, open: true }));
    act(() => result.current.hide());
    expect(result.current).toMatchObject({ ask: { id: 'a' }, open: false });
    act(() => tell(ask('b')));
    expect(result.current).toMatchObject({ ask: { id: 'b' }, open: true });
    act(() => tell(null));
    expect(result.current).toMatchObject({ ask: null, open: false });
  });
});
