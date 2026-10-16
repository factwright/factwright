// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCallReminders } from './useCallReminders.ts';

afterEach(cleanup);

describe('useCallReminders', () => {
  it('loads whether reminders are on, and turns them off and on', async () => {
    const api = {
      callReminders: vi.fn(async () => true),
      setCallReminders: vi.fn(async (on: boolean) => on),
    };
    const { result } = renderHook(() => useCallReminders(api));
    // Until it's known, there's no switch to show.
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current?.on).toBe(true));
    act(() => result.current?.turn(false));
    expect(result.current?.on).toBe(false);
    expect(api.setCallReminders).toHaveBeenCalledWith(false);
    await act(async () => result.current?.turn(true));
    expect(result.current?.on).toBe(true);
  });

  it('goes back when the app couldn’t make the change, and shows no switch it can’t read', async () => {
    const api = {
      callReminders: vi.fn(async () => true),
      setCallReminders: vi.fn(async (): Promise<boolean> => {
        throw new Error('Refused');
      }),
    };
    const { result } = renderHook(() => useCallReminders(api));
    await waitFor(() => expect(result.current?.on).toBe(true));
    await act(async () => result.current?.turn(false));
    expect(result.current?.on).toBe(true);
    cleanup();
    const unread = renderHook(() =>
      useCallReminders({ ...api, callReminders: vi.fn(() => Promise.reject(new Error('No'))) }),
    );
    await act(async () => {});
    expect(unread.result.current).toBeNull();
  });
});
