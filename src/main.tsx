import '@/styles/fonts';
import '@/styles/tokens.css';
import '@/styles/base.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app/App';
import { ConfigErrorScreen } from '@/app/ConfigErrorScreen';
import { resolveAppConfig } from '@/config/env';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

const result = resolveAppConfig(import.meta.env);
const root = createRoot(container);

root.render(
  <StrictMode>
    {result.ok ? <App config={result.config} /> : <ConfigErrorScreen issues={result.issues} />}
  </StrictMode>,
);
