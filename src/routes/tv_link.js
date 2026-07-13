const { Router } = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

const router = Router();

// ---------------------------------------------------------------------------
// Device-link TV <-> movil.
//
// El backend NO valida el rol de Discord ni emite credenciales propias: solo
// TRANSPORTA un authorization code de Discord desde el movil (que ya tiene
// sesion) hacia la TV (que no puede abrir un navegador). La TV canjea ese
// code por su PROPIO par de tokens, quedando como un cliente Discord mas.
//
// Estado efimero en memoria: si el proceso reinicia, los codigos pendientes
// se pierden y el usuario simplemente reintenta. No hay datos que persistir.
// ---------------------------------------------------------------------------

/** code -> { deviceId, status, authCode, expiresAt } */
const links = new Map();

const CODE_TTL_MS = 10 * 60 * 1000; // 10 min
// Alfabeto sin caracteres ambiguos (sin 0/O/1/I/L) para lectura en pantalla.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

const DEVICE_ID_RE = /^[A-Za-z0-9._-]{8,128}$/;
const CODE_RE = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);
// Los authorization codes de Discord son alfanumericos cortos; acotamos por
// seguridad sin ser tan estrictos como para rechazar formatos validos.
const AUTH_CODE_RE = /^[A-Za-z0-9._-]{10,512}$/;

// Limitador dedicado y generoso: el polling de la TV (~cada 5s durante hasta
// 10 min) superaria el limitador global de la app. server.js exime /tv-link
// del global y aplica este.
const tvLinkLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 400,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'rate_limited' },
});
router.use(tvLinkLimiter);

function generateCode() {
    let code = '';
    do {
        code = '';
        for (let i = 0; i < CODE_LENGTH; i++) {
            code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
        }
    } while (links.has(code));
    return code;
}

function isExpired(entry) {
    return !entry || entry.expiresAt <= Date.now();
}

// Barrido periodico de expirados. unref() evita que el timer mantenga vivo el
// proceso por si solo.
const sweep = setInterval(() => {
    const now = Date.now();
    for (const [code, entry] of links) {
        if (entry.expiresAt <= now) links.delete(code);
    }
}, 60 * 1000);
if (sweep.unref) sweep.unref();

// 1) La TV pide un codigo nuevo.
router.post('/new', (req, res) => {
    const { deviceId } = req.body || {};
    if (typeof deviceId !== 'string' || !DEVICE_ID_RE.test(deviceId)) {
        return res.status(400).json({ error: 'invalid_device_id' });
    }

    const code = generateCode();
    links.set(code, {
        deviceId,
        status: 'pending',
        authCode: null,
        expiresAt: Date.now() + CODE_TTL_MS,
    });

    return res.json({ code, expiresInSeconds: CODE_TTL_MS / 1000 });
});

// 2) El movil reclama el codigo entregando el authorization code de Discord.
router.post('/claim', (req, res) => {
    const { code, authCode } = req.body || {};
    if (typeof code !== 'string' || !CODE_RE.test(code)) {
        return res.status(400).json({ error: 'invalid_code' });
    }
    if (typeof authCode !== 'string' || !AUTH_CODE_RE.test(authCode)) {
        return res.status(400).json({ error: 'invalid_auth_code' });
    }

    const entry = links.get(code);
    if (isExpired(entry)) {
        if (entry) links.delete(code);
        return res.status(410).json({ error: 'code_expired' });
    }
    if (entry.status !== 'pending') {
        // Un codigo solo se reclama una vez: evita sobrescribir un authCode ya
        // entregado o en vuelo.
        return res.status(409).json({ error: 'already_claimed' });
    }

    entry.authCode = authCode;
    entry.status = 'claimed';
    // Nunca se loguea authCode.
    return res.json({ success: true });
});

// 3) La TV consulta el estado (polling). deviceId actua como segundo secreto:
// aunque alguien vea el code (QR), sin el deviceId no puede recuperar el
// authCode.
router.get('/status', (req, res) => {
    const { code, deviceId } = req.query;
    if (typeof code !== 'string' || !CODE_RE.test(code)) {
        return res.status(400).json({ error: 'invalid_code' });
    }
    if (typeof deviceId !== 'string' || !DEVICE_ID_RE.test(deviceId)) {
        return res.status(400).json({ error: 'invalid_device_id' });
    }

    const entry = links.get(code);
    if (isExpired(entry)) {
        if (entry) links.delete(code);
        // La TV regenera un codigo nuevo al ver esto.
        return res.json({ status: 'expired' });
    }
    if (entry.deviceId !== deviceId) {
        return res.status(403).json({ error: 'device_mismatch' });
    }

    if (entry.status === 'claimed') {
        // Se entrega mientras el registro siga vigente (no se borra al primer
        // envio): si la respuesta se pierde por mala conexion, la TV vuelve a
        // consultar y lo recupera. El authCode de Discord es de un solo uso y
        // corta vida, asi que una vez la TV lo canjea queda inservible para
        // cualquiera.
        return res.json({ status: 'linked', authCode: entry.authCode });
    }

    return res.json({ status: 'pending' });
});

module.exports = router;
