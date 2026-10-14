// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_EFFORT, type EffortChoices } from '../shared/effort.ts';
import { DEFAULT_MODELS, type ModelChoices } from '../shared/models.ts';
import { useLevelChoices } from './useLevelChoices.ts';

afterEach(cleanup);

describe('useLevelChoices', () => {
  it('loads the choices, then takes each one Claude settings saves', async () => {
    const api = {
      claudeModels: vi.fn(async (): Promise<ModelChoices> => DEFAULT_MODELS),
      claudeEffort: vi.fn(async (): Promise<EffortChoices> => DEFAULT_EFFORT),
    };
    const { result } = renderHook(() => useLevelChoices(api));
    await waitFor(() =>
      expect(result.current.choices).toEqual({ models: DEFAULT_MODELS, effort: DEFAULT_EFFORT }),
    );
    act(() => result.current.saved({ models: { main: 'haiku', tasks: {} } }));
    expect(result.current.choices).toEqual({
      models: { main: 'haiku', tasks: {} },
      effort: DEFAULT_EFFORT,
    });
  });

  it('keeps a choice saved while it was still loading, over what the load read', async () => {
    let answer: (models: ModelChoices) => void = () => {};
    const api = {
      claudeModels: vi.fn(() => new Promise<ModelChoices>((resolve) => (answer = resolve))),
      claudeEffort: vi.fn(async (): Promise<EffortChoices> => DEFAULT_EFFORT),
    };
    const { result } = renderHook(() => useLevelChoices(api));
    act(() => result.current.saved({ effort: { main: 'low', tasks: {} } }));
    expect(result.current.choices).toBeNull();
    await act(async () => answer(DEFAULT_MODELS));
    expect(result.current.choices).toEqual({
      models: DEFAULT_MODELS,
      effort: { main: 'low', tasks: {} },
    });
  });
});
