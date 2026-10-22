type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

declare global {
  interface Navigator {
    standalone?: boolean;
  }
}

let deferredPrompt: InstallPromptEvent | null = null;
let bannerShown = false;

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

function isMobile() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function isIOS() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function removeBanner() {
  document.querySelector('.install-app-banner')?.remove();
}

function renderBanner(mode: 'native' | 'ios') {
  if (bannerShown || isStandalone() || !isMobile()) return;
  bannerShown = true;

  const banner = document.createElement('div');
  banner.className = 'install-app-banner';
  banner.innerHTML = `
    <div class="install-app-icon" aria-hidden="true">
      <img src="/emprestei-icon.svg" alt="" />
    </div>
    <div class="install-app-copy">
      <strong>Instale o Emprestei</strong>
      <span>${mode === 'ios' ? 'Adicione à Tela de Início e abra como aplicativo.' : 'Tenha acesso rápido direto pela tela do seu celular.'}</span>
    </div>
    <button class="install-app-action" type="button">${mode === 'ios' ? 'Como instalar' : 'Instalar'}</button>
    <button class="install-app-close" type="button" aria-label="Fechar">×</button>
  `;

  document.body.appendChild(banner);
  requestAnimationFrame(() => banner.classList.add('show'));

  banner.querySelector('.install-app-close')?.addEventListener('click', () => {
    banner.classList.remove('show');
    window.setTimeout(removeBanner, 220);
  });

  banner.querySelector('.install-app-action')?.addEventListener('click', async () => {
    if (mode === 'ios') {
      banner.classList.add('instructions');
      const copy = banner.querySelector('.install-app-copy span');
      const action = banner.querySelector('.install-app-action');
      if (copy) copy.innerHTML = 'No Safari, toque em <b>Compartilhar</b> e depois em <b>Adicionar à Tela de Início</b>.';
      if (action) action.textContent = 'Entendi';
      action?.addEventListener('click', () => {
        banner.classList.remove('show');
        window.setTimeout(removeBanner, 220);
      }, { once: true });
      return;
    }

    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    deferredPrompt = null;
    if (choice.outcome === 'accepted') {
      banner.classList.remove('show');
      window.setTimeout(removeBanner, 220);
    }
  });
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredPrompt = event as InstallPromptEvent;
  window.setTimeout(() => renderBanner('native'), 1200);
});

window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  removeBanner();
});

window.addEventListener('load', () => {
  if (isIOS() && !isStandalone()) {
    window.setTimeout(() => renderBanner('ios'), 1500);
  }
});

export {};
