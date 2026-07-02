'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Lightweight, dependency-free metrics for house ads. Events are appended as
 * JSON Lines to `metrics.log` (one JSON object per line). This keeps the
 * counting entirely server-side and easy to grep/aggregate later without a DB.
 */

const LOG_FILE = path.join(__dirname, 'metrics.log');

/**
 * @param {'impression'|'click'} type
 * @param {string} id   Ad id.
 * @param {import('express').Request} req
 */
function track(type, id, req) {
  const entry = {
    ts: new Date().toISOString(),
    type,
    id,
    ip: (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim(),
    ua: (req.headers['user-agent'] || '').toString().slice(0, 200),
  };
  // Fire-and-forget: never let logging failures affect the ad response.
  fs.appendFile(LOG_FILE, JSON.stringify(entry) + '\n', (err) => {
    if (err) console.error('[house-ads] metrics write failed:', err.message);
  });
}

module.exports = { track, LOG_FILE };
