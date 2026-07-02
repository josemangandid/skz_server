'use strict';

const https = require('https');
const crypto = require('crypto');

/**
 * House-ad metrics via the GA4 Measurement Protocol.
 *
 * Events are sent server-side to a Google Analytics 4 property with a plain
 * HTTPS POST — no SDK or extra dependency required. Configure via env vars:
 *
 *   GA4_MEASUREMENT_ID   e.g. "G-XXXXXXXXXX"  (GA4 Admin > Data Streams > your
 *                        stream > "Measurement ID")
 *   GA4_API_SECRET       created in the same stream under
 *                        "Measurement Protocol API secrets" > Create
 *   GA4_DEBUG            optional; "1" routes to GA's /debug endpoint which
 *                        validates the payload and logs any problems instead of
 *                        actually recording the event.
 *
 * If the credentials are absent the tracker no-ops (with a one-time warning) so
 * local/dev runs don't fail. All sends are fire-and-forget: a metrics failure
 * never affects the ad response.
 */

const MEASUREMENT_ID = process.env.GA4_MEASUREMENT_ID || '';
const API_SECRET = process.env.GA4_API_SECRET || '';
const DEBUG = process.env.GA4_DEBUG === '1';

const EVENT_NAMES = {
  impression: 'house_ad_impression',
  click: 'house_ad_click',
};

let warned = false;

/**
 * Derives a stable pseudo client id from IP + User-Agent so repeated hits from
 * the same device group into one GA4 "user" (approximate — we have no GA
 * cookie server-side). GA4 requires a client_id on every event.
 */
function clientIdFor(req) {
  const ip = (req.headers['x-forwarded-for'] || req.ip || '')
    .toString()
    .split(',')[0]
    .trim();
  const ua = (req.headers['user-agent'] || '').toString();
  const hash = crypto.createHash('md5').update(ip + '|' + ua).digest('hex');
  // GA4 client_id convention: "<digits>.<digits>".
  return `${parseInt(hash.slice(0, 12), 16)}.${parseInt(hash.slice(12, 24), 16)}`;
}

/**
 * @param {'impression'|'click'} type
 * @param {string} id   Ad id.
 * @param {import('express').Request} req
 */
function track(type, id, req) {
  const eventName = EVENT_NAMES[type];
  if (!eventName) return;

  if (!MEASUREMENT_ID || !API_SECRET) {
    if (!warned) {
      warned = true;
      console.warn(
        '[house-ads] GA4 not configured (GA4_MEASUREMENT_ID / GA4_API_SECRET). Metrics are disabled.',
      );
    }
    return;
  }

  const payload = JSON.stringify({
    client_id: clientIdFor(req),
    events: [
      {
        name: eventName,
        params: {
          ad_id: id,
          // Required for the event to count toward user/session engagement.
          engagement_time_msec: 1,
          session_id: Math.floor(Date.now() / 1000).toString(),
        },
      },
    ],
  });

  const path =
    `/${DEBUG ? 'debug/' : ''}mp/collect` +
    `?measurement_id=${encodeURIComponent(MEASUREMENT_ID)}` +
    `&api_secret=${encodeURIComponent(API_SECRET)}`;

  const options = {
    hostname: 'www.google-analytics.com',
    path,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    },
    timeout: 5000,
  };

  const request = https.request(options, (res) => {
    if (DEBUG) {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () =>
        console.log(`[house-ads] GA4 debug (${res.statusCode}):`, body),
      );
    } else {
      // Drain and ignore; 2xx/204 means accepted.
      res.resume();
    }
  });

  request.on('timeout', () => request.destroy());
  request.on('error', (err) =>
    console.error('[house-ads] GA4 send failed:', err.message),
  );
  request.write(payload);
  request.end();
}

module.exports = { track, EVENT_NAMES };
