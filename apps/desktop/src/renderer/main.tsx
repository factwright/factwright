import { NamedThemesStyle, SYSTEM_THEME, ThemeStyle } from '@factwright/ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { loadApi } from './api.ts';
import { showTheme } from './theme.ts';

const api = await loadApi();
showTheme(await api.theme().catch(() => SYSTEM_THEME));
const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <ThemeStyle />
      <NamedThemesStyle />
      <App api={api} />
    </StrictMode>,
  );
}
