import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './ui/App';

// index.html belongs to the integrator, so the icon and manifest links are added here.
function addHeadLink(rel: string, href: string, type?: string) {
  const link = document.createElement('link');
  link.rel = rel;
  link.href = `${import.meta.env.BASE_URL}${href}`;
  if (type) link.type = type;
  document.head.append(link);
}
addHeadLink('icon', 'favicon.svg', 'image/svg+xml');
addHeadLink('apple-touch-icon', 'icon-192.png');
addHeadLink('manifest', 'manifest.webmanifest');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
