import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

const saved = localStorage.getItem('avz-theme');
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
document.documentElement.dataset.theme = saved ?? (prefersDark ? 'dark' : 'light');

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
