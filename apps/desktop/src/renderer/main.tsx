import { ThemeStyle } from '@factwright/ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { loadApi } from './api.ts';

const api = await loadApi();
const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <ThemeStyle />
      <App api={api} />
    </StrictMode>,
  );
}
