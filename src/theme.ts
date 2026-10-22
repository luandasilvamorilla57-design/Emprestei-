type Theme = 'dark' | 'light';

const STORAGE_KEY = 'emprestei-theme';

function getPreferredTheme(): Theme {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'dark' || saved === 'light') return saved;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  localStorage.setItem(STORAGE_KEY, theme);
  document.querySelectorAll<HTMLButtonElement>('.theme-toggle').forEach((button) => {
    button.dataset.activeTheme = theme;
    button.setAttribute('aria-label', theme === 'dark' ? 'Ativar modo claro' : 'Ativar modo escuro');
    button.setAttribute('title', theme === 'dark' ? 'Ativar modo claro' : 'Ativar modo escuro');
  });
}

function themeToggleMarkup() {
  return `
    <span class="theme-option theme-moon" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"/></svg>
    </span>
    <span class="theme-option theme-sun" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41"/></svg>
    </span>`;
}

function mountThemeToggle() {
  const topbar = document.querySelector<HTMLElement>('.topbar');
  if (!topbar || topbar.querySelector('.theme-toggle')) return;

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'theme-toggle';
  toggle.innerHTML = themeToggleMarkup();
  toggle.addEventListener('click', () => {
    const current = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    applyTheme(current === 'dark' ? 'light' : 'dark');
  });

  const profile = topbar.querySelector('.profile-pill');
  if (profile) topbar.insertBefore(toggle, profile);
  else topbar.appendChild(toggle);

  applyTheme(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
}

applyTheme(getPreferredTheme());

const observer = new MutationObserver(() => mountThemeToggle());
observer.observe(document.documentElement, { childList: true, subtree: true });

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountThemeToggle, { once: true });
} else {
  mountThemeToggle();
}
