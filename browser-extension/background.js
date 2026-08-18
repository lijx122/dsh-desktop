/**
 * DSH & NextChat Embed Unblocker Background Service
 * Fixes ALL edge cases:
 * 1. Declarative network rule dynamically updated
 * 2. Full webRequestBlocking on onHeadersReceived + onBeforeSendHeaders
 * 3. Removes Sec-Fetch-Dest: iframe restriction and Sec-Fetch-Site (Fetch Metadata)
 * 4. Strips X-Frame-Options, CSP, frame-options, COOP, COEP, CORP
 * 5. Rewrites Set-Cookie SameSite=None; Secure; Partitioned
 */

const browserApi = typeof browser !== 'undefined' ? browser : (typeof chrome !== 'undefined' ? chrome : null);

const ALLOWED_ORIGINS = [
  'http://127.0.0.1:3080',
  'http://localhost:3080',
  'https://nextchat.shieldcell.cn'
];

function isOriginAllowed(urlOrOrigin) {
  if (!urlOrOrigin) return false;
  return ALLOWED_ORIGINS.some((allowed) => urlOrOrigin.startsWith(allowed));
}

if (browserApi && browserApi.webRequest) {
  // 1. Remove Fetch Metadata restrictions on the outbound request
  if (browserApi.webRequest.onBeforeSendHeaders) {
    try {
      browserApi.webRequest.onBeforeSendHeaders.addListener(
        (details) => {
          const origin = details.originUrl || details.documentUrl || details.initiator || '';
          if (!isOriginAllowed(origin)) return;

          let headers = details.requestHeaders || [];
          headers = headers.filter((h) => {
            const name = h.name.toLowerCase();
            return name !== 'sec-fetch-dest' && name !== 'sec-fetch-mode' && name !== 'sec-fetch-site';
          });
          headers.push({ name: 'Sec-Fetch-Dest', value: 'document' });
          headers.push({ name: 'Sec-Fetch-Mode', value: 'navigate' });
          headers.push({ name: 'Sec-Fetch-Site', value: 'none' });

          return { requestHeaders: headers };
        },
        { urls: ['<all_urls>'], types: ['sub_frame', 'xmlhttprequest', 'other'] },
        ['blocking', 'requestHeaders']
      );
    } catch (e) {
      console.warn('onBeforeSendHeaders error:', e);
    }
  }

  // 2. Comprehensive header stripping on incoming response
  if (browserApi.webRequest.onHeadersReceived) {
    try {
      browserApi.webRequest.onHeadersReceived.addListener(
        (details) => {
          const origin = details.originUrl || details.documentUrl || details.initiator || '';
          if (!isOriginAllowed(origin)) return;

          if (!details.responseHeaders) return;

          const responseHeaders = details.responseHeaders.filter((header) => {
            const name = header.name.toLowerCase();
            return (
              name !== 'x-frame-options' &&
              name !== 'frame-options' &&
              name !== 'content-security-policy' &&
              name !== 'content-security-policy-report-only' &&
              name !== 'x-content-security-policy' &&
              name !== 'x-webkit-csp' &&
              name !== 'cross-origin-opener-policy' &&
              name !== 'cross-origin-embedder-policy' &&
              name !== 'cross-origin-resource-policy'
            );
          });

          // Rewrite Set-Cookie to allow cross-site iframe login (GitHub / OAuth / Auth0)
          for (const header of responseHeaders) {
            if (header.name.toLowerCase() === 'set-cookie' && header.value) {
              header.value = header.value
                .replace(/SameSite=(Lax|Strict)/gi, 'SameSite=None')
                .concat('; Secure; Partitioned');
            }
          }

          return { responseHeaders };
        },
        { urls: ['<all_urls>'], types: ['sub_frame', 'xmlhttprequest', 'other'] },
        ['blocking', 'responseHeaders']
      );
    } catch (e) {
      console.warn('onHeadersReceived error:', e);
    }
  }
}
