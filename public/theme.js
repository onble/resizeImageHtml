// Run before the stylesheet so a saved dark theme applies before first paint.
(() => {
  const key = 'resize-studio-theme';
  let theme = 'light';
  try { if (localStorage.getItem(key) === 'dark') theme = 'dark'; } catch {}

  function applyTheme() {
    document.documentElement.dataset.theme = theme;
    const button = document.getElementById('theme-toggle');
    if (!button) return;
    const label = window.ResizeI18n.t(theme === 'dark' ? 'theme.light' : 'theme.dark');
    button.querySelector('[data-theme-label]').textContent = label;
    button.setAttribute('aria-pressed', String(theme === 'dark'));
    button.setAttribute('aria-label', window.ResizeI18n.t('theme.switch', { mode: label }));
    button.title = window.ResizeI18n.t('theme.switch', { mode: label });
  }

  applyTheme();
  window.addEventListener('resize-language-change', applyTheme);
  document.addEventListener('DOMContentLoaded', () => {
    applyTheme();
    document.getElementById('theme-toggle').addEventListener('click', () => {
      theme = theme === 'dark' ? 'light' : 'dark';
      applyTheme();
      try { localStorage.setItem(key, theme); } catch {}
    });
  });
})();
