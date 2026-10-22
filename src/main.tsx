import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './AppV2';
import './styles.css';
import './enhancements.css';
import './premium.css';
import './alerts-payments.css';
import './pwa-install.css';
import './theme';
import './pwa-install';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
