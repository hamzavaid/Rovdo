/**
 * Renderer entry point: mounts the React application and its shared styles.
 * Privileged operations are available only through the isolated preload API.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import './workspace.css';
import './jobs.css';
import './jobs-v5.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
