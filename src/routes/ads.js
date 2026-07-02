'use strict';

const { Router } = require('express');
const path = require('path');
const fs = require('fs');

const { renderInterstitial } = require('../ads/render');
const metrics = require('../ads/metrics');

const router = Router();

const CONFIG_PATH = path.join(__dirname, '..', 'ads', 'ads.config.json');
const ID_REGEX = /^[a-zA-Z0-9_-]+$/;

/**
 * Loads the ad catalog fresh on every request so creatives can be edited on
 * disk without restarting the server. The file is tiny, so the cost is
 * negligible; if it ever grows, add a short-lived cache here.
 */
function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (err) {
    console.error('[house-ads] failed to read ads.config.json:', err.message);
    return {};
  }
}

function isValidUrl(u) {
  try {
    const parsed = new URL(u);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (e) {
    return false;
  }
}

/**
 * GET /ads/interstitial/:id
 * Serves the HTML creative for a house ad. The request itself counts as the
 * impression. Returns 404 when the id is unknown so the app's WebView error
 * handler dismisses the (empty) interstitial instead of blocking the user.
 */
router.get('/interstitial/:id', (req, res) => {
  const { id } = req.params;
  if (!ID_REGEX.test(id)) {
    return res.status(400).send('Invalid ad id');
  }

  const ad = loadConfig()[id];
  if (!ad) {
    return res.status(404).send('Ad not found');
  }

  metrics.track('impression', id, req);

  const clickUrl = `${req.protocol}://${req.get('host')}/ads/click/${encodeURIComponent(id)}`;
  res
    .set('Content-Type', 'text/html; charset=utf-8')
    .set('Cache-Control', 'no-store')
    // Relax helmet's default CSP for this creative only: it uses inline
    // <style>/<script> and loads images from arbitrary https hosts.
    .set(
      'Content-Security-Policy',
      "default-src 'self'; img-src https: data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'",
    )
    .send(renderInterstitial(ad, clickUrl, id));
});

/**
 * GET /ads/click/:id
 * Counts a click and 302-redirects to the ad's CTA. This is what the app opens
 * externally, so clicks are counted server-side even though the destination
 * opens outside the app. An optional `?to=` overrides the destination (must be
 * an absolute http/https URL).
 */
router.get('/click/:id', (req, res) => {
  const { id } = req.params;
  if (!ID_REGEX.test(id)) {
    return res.status(400).send('Invalid ad id');
  }

  const ad = loadConfig()[id];
  if (!ad) {
    return res.status(404).send('Ad not found');
  }

  metrics.track('click', id, req);

  const override = req.query.to;
  const destination = isValidUrl(override) ? override : ad.cta_url;
  if (!isValidUrl(destination)) {
    return res.status(400).send('Invalid destination');
  }
  return res.redirect(302, destination);
});

/** GET /ads/list — ids currently available (handy to build the app config). */
router.get('/list', (req, res) => {
  res.json({ ids: Object.keys(loadConfig()) });
});

module.exports = router;
