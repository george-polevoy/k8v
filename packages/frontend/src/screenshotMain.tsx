import React from 'react';
import ReactDOM from 'react-dom/client';
import ScreenshotHarnessApp from './screenshot/ScreenshotHarnessApp';
import './index.css';
import 'katex/dist/katex.min.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ScreenshotHarnessApp />
  </React.StrictMode>
);
