/**
 * DSH & NextChat Embed Unblocker Content Script
 * Automatically bypasses embed refusal warnings and enhances iframe permissions.
 */

console.log('[DSH/NextChat Unblocker Extension] Content script initialized on:', window.location.href);

function initBypass() {
  const observer = new MutationObserver(() => {
    // 1. Auto-click "仍然加载" / "Load anyway" buttons in DSH better-sidebar and NextChat
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      const text = btn.textContent ? btn.textContent.trim() : '';
      if (text === '仍然加载' || text === 'Load anyway' || text === '继续加载') {
        btn.click();
      }
    }

    // 2. Enhance iframe sandbox permissions for embedded web pages
    const iframes = document.querySelectorAll('iframe');
    for (const iframe of iframes) {
      if (!iframe.getAttribute('data-dsh-unblocked')) {
        iframe.setAttribute('data-dsh-unblocked', 'true');
        // If iframe has sandbox, ensure it has necessary permissions for full web interaction
        if (iframe.hasAttribute('sandbox')) {
          iframe.setAttribute(
            'sandbox',
            'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads'
          );
        }
      }
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initBypass);
} else {
  initBypass();
}
