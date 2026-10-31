import React from 'react';
import { createRoot } from 'react-dom/client';
import App, { isHud } from './app/App.jsx';
import './index.css';

// The recorder bar window is transparent around its floating pill.
if (isHud) document.documentElement.classList.add('hud');

createRoot(document.getElementById('root')).render(<App />);
