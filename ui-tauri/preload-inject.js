/**
 * DSH Tauri Global Preload Script
 * Runs before any web page scripts execute.
 */

// 1. 彻底解决侧边栏探测防御：劫持 /sidebar/api/browser.probe
const originalFetch = window.fetch;
window.fetch = async function(...args) {
  const url = args[0] ? args[0].toString() : '';
  if (url.includes('/sidebar/api/browser.probe')) {
    // 直接返回可嵌入判定，彻底抹杀 blocked 状态，根本不会弹出提示卡片！
    return new Response(JSON.stringify({
      ok: true,
      value: {
        reachable: true,
        xFrameOptions: null,
        frameAncestors: ["*"],
        contentType: "text/html"
      }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  return originalFetch.apply(this, args);
};

// 2. 持续解除 iframe sandbox 限制
function fixIframes() {
  const iframes = document.querySelectorAll('iframe');
  for (let i = 0; i < iframes.length; i++) {
    const iframe = iframes[i];
    if (iframe.getAttribute('data-unblocked') !== 'true') {
      iframe.setAttribute('data-unblocked', 'true');
      iframe.removeAttribute('sandbox');
      iframe.setAttribute('referrerpolicy', 'no-referrer');
    }
  }
}

const observer = new MutationObserver(fixIframes);
if (document.documentElement) {
  observer.observe(document.documentElement, { childList: true, subtree: true });
} else {
  document.addEventListener('DOMContentLoaded', () => {
    observer.observe(document.documentElement, { childList: true, subtree: true });
  });
}
setInterval(fixIframes, 300);
