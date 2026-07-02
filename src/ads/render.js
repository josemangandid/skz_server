'use strict';

/**
 * Renders a self-served ("house") interstitial as a full HTML document meant to
 * be displayed inside the Natsuki app's WebView.
 *
 * Event protocol (page -> app, via the `NatsukiAd` JS channel). Every message
 * is a JSON object of the form `{ v:1, action, id, ... }`:
 *  - `{ action:'ready',      id }`            creative finished laying out; the
 *                                             app may start its skip countdown.
 *  - `{ action:'cta', id, url }`              user tapped the CTA. `url` is the
 *                                             tracking URL to open externally.
 *                                             The app opens it and dismisses.
 *  - `{ action:'close', id }`                 (optional) user asked to close.
 *
 * When opened in a plain browser (no `NatsukiAd` channel) the CTA falls back to
 * normal navigation, so the same page also works standalone.
 *
 * Colours are pre-computed to rgba() strings here (rather than using CSS
 * color-mix) so the creative renders identically on older Android WebViews.
 */

const PROTOCOL_VERSION = 1;

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Escapes a value for safe embedding inside a single-quoted JS string. */
function escapeJs(value) {
  return String(value == null ? '' : value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/</g, '\\x3c');
}

/** Parses `#rgb` / `#rrggbb` into `{r,g,b}`, or `null` if not a hex colour. */
function parseHex(hex) {
  if (typeof hex !== 'string') return null;
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/** Builds an `rgba()` string from a hex colour + alpha, with a safe fallback. */
function rgba(hex, alpha, fallback) {
  const c = parseHex(hex) || parseHex(fallback) || { r: 255, g: 255, b: 255 };
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})`;
}

/**
 * @param {object} ad       Ad definition from ads.config.json.
 * @param {string} clickUrl Absolute tracking URL that 302-redirects to the CTA.
 * @param {string} id       Ad id (echoed back in events so the app can route).
 * @returns {string} Full HTML document.
 */
function renderInterstitial(ad, clickUrl, id) {
  const bg = escapeHtml(ad.bg_color || '#0f0f12');
  const text = escapeHtml(ad.text_color || '#ffffff');
  const accent = escapeHtml(ad.accent_color || '#fe2c55');
  const title = escapeHtml(ad.title || '');
  const body = escapeHtml(ad.body || '');
  const image = escapeHtml(ad.image || '');
  const ctaText = escapeHtml(ad.cta_text || 'Abrir');
  const clickJs = escapeJs(clickUrl);
  const idJs = escapeJs(id);
  // "cover" (default) crops a wide banner to fill; "contain" fits a square app
  // logo without cropping. Anything else falls back to cover.
  const fit = ad.image_fit === 'contain' ? 'contain' : 'cover';

  // Derived colours (no color-mix -> broad WebView support).
  const muted = rgba(text, 0.62, '#ffffff');
  const faint = rgba(text, 0.8, '#ffffff');
  const hairline = rgba(text, 0.12, '#ffffff');
  const panel = rgba(text, 0.06, '#ffffff');
  const shimmer = rgba(text, 0.09, '#ffffff');
  const accentTint = rgba(accent, 0.32, '#fe2c55');
  const accentShadow = rgba(accent, 0.45, '#fe2c55');

  // CTA + hint markup, reused in two spots: pinned at the bottom in portrait,
  // and beside the copy (right column) in landscape. Only one is visible at a
  // time (toggled by the orientation media query).
  const ctaBlock = `<button class="cta" onclick="onCta()">
        <span>${ctaText}</span>
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <p class="hint">Cierra el anuncio para volver al contenido</p>`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="robots" content="noindex,nofollow" />
  <meta name="color-scheme" content="dark" />
  <title>${title}</title>
  <style>
    * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
    html, body {
      margin: 0; padding: 0; height: 100%; width: 100%;
      color: ${text};
      background:
        radial-gradient(130% 85% at 50% -10%, ${accentTint}, transparent 60%),
        ${bg};
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      overflow: hidden; -webkit-user-select: none; user-select: none;
      -webkit-touch-callout: none;
    }
    .stage {
      position: relative; height: 100%; width: 100%;
      display: flex; flex-direction: column;
      padding: calc(env(safe-area-inset-top, 0px) + 16px) 22px calc(env(safe-area-inset-bottom, 0px) + 22px);
    }
    /* Top bar: sponsored label (the close control is drawn natively by the app). */
    .topbar { display: flex; align-items: center; }
    .badge {
      font-size: 10.5px; font-weight: 700; letter-spacing: 1.4px;
      text-transform: uppercase; color: ${muted};
      border: 1px solid ${hairline}; border-radius: 999px;
      padding: 5px 10px; background: ${panel};
    }
    .content {
      flex: 1; min-height: 0;
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      text-align: center;
    }
    .card {
      width: 100%; max-width: 400px;
      display: flex; flex-direction: column; align-items: center;
      animation: rise .45s cubic-bezier(.2,.8,.2,1) both;
    }
    @keyframes rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
    .media {
      position: relative; width: 100%; aspect-ratio: 16 / 10;
      border-radius: 22px; overflow: hidden; margin-bottom: 24px;
      background: ${panel};
      box-shadow: 0 20px 45px -20px rgba(0,0,0,.75);
    }
    .media img {
      position: relative; z-index: 1;
      width: 100%; height: 100%; object-fit: cover; display: block;
      opacity: 0; transition: opacity .4s ease;
    }
    .media img.loaded { opacity: 1; }
    .media.contain { padding: 22px; }
    .media.contain img { object-fit: contain; filter: drop-shadow(0 10px 22px rgba(0,0,0,.45)); }
    /* Shimmer skeleton shown until the image decodes. */
    .skeleton {
      position: absolute; inset: 0; z-index: 0;
      background: linear-gradient(100deg, transparent 20%, ${shimmer} 40%, transparent 60%);
      background-size: 220% 100%;
      animation: shimmer 1.3s infinite linear;
    }
    @keyframes shimmer { from { background-position: 140% 0; } to { background-position: -40% 0; } }
    h1 { font-size: 24px; font-weight: 800; letter-spacing: -.3px; margin: 0 0 12px; line-height: 1.22; }
    p  { font-size: 15px; line-height: 1.55; margin: 0; color: ${muted}; max-width: 34ch; }
    /* Bottom action area */
    .actions { width: 100%; max-width: 400px; margin: 0 auto; }
    .cta {
      width: 100%; border: none; cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center; gap: 10px;
      background: ${accent}; color: #ffffff;
      font-size: 16.5px; font-weight: 800; letter-spacing: .2px;
      padding: 16px 22px; border-radius: 16px;
      box-shadow: 0 14px 30px -10px ${accentShadow};
      transition: transform .1s ease, box-shadow .2s ease, opacity .2s ease;
    }
    .cta:active { transform: translateY(1px) scale(.985); box-shadow: 0 8px 18px -10px ${accentShadow}; }
    .cta svg { width: 18px; height: 18px; }
    .hint { margin: 14px 0 0; text-align: center; font-size: 12px; color: ${faint}; opacity: .8; }
    /* Portrait shows the bottom CTA; the inline (beside-copy) one is hidden. */
    .actions-inline { display: none; }

    /* Landscape: switch the creative to two columns (media | copy) so it fits
       the short viewport height, and move the CTA beside the copy. */
    @media (orientation: landscape) {
      .stage {
        padding: calc(env(safe-area-inset-top, 0px) + 10px) 40px
                 calc(env(safe-area-inset-bottom, 0px) + 12px);
      }
      .card {
        flex-direction: row;
        align-items: center;
        gap: 28px;
        max-width: 760px;
        text-align: left;
      }
      .media {
        width: 44%;
        max-width: 320px;
        max-height: 60vh;
        margin-bottom: 0;
        flex: 0 0 auto;
      }
      .copy { flex: 1 1 auto; min-width: 0; }
      h1 { font-size: 22px; margin-bottom: 8px; }
      p { max-width: none; }
      /* Swap which CTA is visible. */
      .actions-bottom { display: none; }
      .actions-inline { display: block; width: 100%; max-width: 320px; margin: 16px 0 0; }
      .actions-inline .hint { text-align: left; }
    }
    /* Very short landscape (small phones): tighten spacing further. */
    @media (orientation: landscape) and (max-height: 380px) {
      h1 { font-size: 20px; }
      p { font-size: 13.5px; line-height: 1.45; }
      .cta { padding: 13px 20px; }
      .hint { margin-top: 10px; }
    }
  </style>
</head>
<body>
  <div class="stage">
    <div class="topbar"><span class="badge">Publicidad</span></div>

    <div class="content">
      <div class="card">
        ${image ? `<div class="media ${fit}" id="media">
          <div class="skeleton" id="skeleton"></div>
          <img id="creative" src="${image}" alt="" />
        </div>` : ''}
        <div class="copy">
          <h1>${title}</h1>
          <p>${body}</p>
          <div class="actions actions-inline">${ctaBlock}</div>
        </div>
      </div>
    </div>

    <div class="actions actions-bottom">${ctaBlock}</div>
  </div>

  <script>
    (function () {
      var V = ${PROTOCOL_VERSION};
      var ID = '${idJs}';
      var CLICK_URL = '${clickJs}';
      var readySent = false;

      function post(action, extra) {
        var msg = { v: V, action: action, id: ID };
        if (extra) for (var k in extra) msg[k] = extra[k];
        try {
          if (window.NatsukiAd && window.NatsukiAd.postMessage) {
            window.NatsukiAd.postMessage(JSON.stringify(msg));
            return true;
          }
        } catch (e) {}
        return false;
      }

      function sendReady() {
        if (readySent) return;
        readySent = true;
        post('ready');
      }

      window.onCta = function () {
        if (!post('cta', { url: CLICK_URL })) {
          // Standalone browser fallback.
          window.location.href = CLICK_URL;
        }
      };

      // Reveal the image once decoded; hide the whole media block if it fails.
      var img = document.getElementById('creative');
      var skeleton = document.getElementById('skeleton');
      if (img) {
        var done = function () {
          img.classList.add('loaded');
          if (skeleton) skeleton.style.display = 'none';
          sendReady();
        };
        if (img.complete && img.naturalWidth > 0) done();
        else {
          img.addEventListener('load', done);
          img.addEventListener('error', function () {
            var m = document.getElementById('media');
            if (m) m.style.display = 'none';
            sendReady();
          });
        }
      }

      // Always signal ready shortly after load so a slow/absent image never
      // blocks the app's skip countdown.
      window.addEventListener('load', function () { setTimeout(sendReady, 300); });
      setTimeout(sendReady, 1500);
    })();
  </script>
</body>
</html>`;
}

module.exports = { renderInterstitial, escapeHtml, escapeJs, PROTOCOL_VERSION };
