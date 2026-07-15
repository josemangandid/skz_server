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
//
// Autenticacion del polling por FIRMA (Ed25519), no por secreto compartido
// (Plan B): la TV genera un par de llaves; en /new envia solo la PUBLICA y el
// servidor le devuelve un `challenge` aleatorio. Para consultar /status la TV
// firma `code.challenge` con su llave PRIVADA (que nunca sale del dispositivo)
// y el servidor verifica la firma con la publica guardada. Consecuencia: el
// servidor jamas almacena un credencial reutilizable; aunque se filtrara su
// memoria o sus logs, sin la llave privada nadie puede forjar una firma valida
// ni recuperar el authCode.
// ---------------------------------------------------------------------------

/** code -> { publicKey: KeyObject, challenge, status, authCode, expiresAt } */
const links = new Map();

const CODE_TTL_MS = 10 * 60 * 1000; // 10 min
// Alfabeto sin caracteres ambiguos (sin 0/O/1/I/L) para lectura en pantalla.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

const CODE_RE = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);
// Los authorization codes de Discord son alfanumericos cortos; acotamos por
// seguridad sin ser tan estrictos como para rechazar formatos validos.
const AUTH_CODE_RE = /^[A-Za-z0-9._-]{10,512}$/;
// Base64 estandar (con posible padding). El largo exacto se valida al decodificar.
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

// Ed25519: llave publica cruda = 32 bytes, firma = 64 bytes. Node no acepta una
// llave publica Ed25519 "cruda" directamente, asi que la envolvemos en el
// prefijo DER SPKI fijo del algoritmo (12 bytes) + los 32 bytes de la llave.
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

// Construye un KeyObject a partir de la llave publica cruda en base64. Devuelve
// null si el formato o el largo no son validos (nunca lanza).
function publicKeyFromRawB64(b64) {
    if (typeof b64 !== 'string' || !BASE64_RE.test(b64)) return null;
    let raw;
    try {
        raw = Buffer.from(b64, 'base64');
    } catch (_) {
        return null;
    }
    if (raw.length !== 32) return null;
    try {
        return crypto.createPublicKey({
            key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
            format: 'der',
            type: 'spki',
        });
    } catch (_) {
        return null;
    }
}

// Verifica la firma Ed25519 de `message` contra la llave publica guardada.
// Robusto ante entradas malformadas: cualquier error devuelve false.
function verifySignature(publicKey, message, sigB64) {
    if (typeof sigB64 !== 'string' || !BASE64_RE.test(sigB64)) return false;
    let sig;
    try {
        sig = Buffer.from(sigB64, 'base64');
    } catch (_) {
        return false;
    }
    if (sig.length !== 64) return false;
    try {
        return crypto.verify(null, Buffer.from(message, 'utf8'), publicKey, sig);
    } catch (_) {
        return false;
    }
}

// Limitador dedicado y generoso: el polling de la TV (~cada 5s durante hasta
// 10 min) superaria el limitador global de la app. server.js exime /tv-link
// del global y aplica este a todo el router.
const tvLinkLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 400,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'rate_limited' },
});
router.use(tvLinkLimiter);

// Limitador estricto POR IP para la creacion de codigos: evita que un solo
// actor agote memoria spammeando /new. Una TV legitima solo regenera al expirar
// (cada ~10 min), asi que 8/10min le sobra.
const newLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 8,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'rate_limited' },
});

// Limitador estricto POR IP para el reclamo: el code es secreto (6 chars random
// sobre 30 simbolos = ~729M), y este limite vuelve inviable adivinarlo por
// fuerza bruta. Un flujo legitimo hace 1 claim; damos margen para reintentos.
const claimLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'rate_limited' },
});

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

// 1) La TV pide un codigo nuevo, entregando su llave PUBLICA. El servidor
// responde con el code y un challenge aleatorio que la TV debera firmar.
router.post('/new', newLimiter, (req, res) => {
    const { publicKey } = req.body || {};
    const keyObject = publicKeyFromRawB64(publicKey);
    if (!keyObject) {
        return res.status(400).json({ error: 'invalid_public_key' });
    }

    const code = generateCode();
    const challenge = crypto.randomBytes(16).toString('hex');
    links.set(code, {
        publicKey: keyObject,
        challenge,
        status: 'pending',
        authCode: null,
        expiresAt: Date.now() + CODE_TTL_MS,
    });

    return res.json({ code, challenge, expiresInSeconds: CODE_TTL_MS / 1000 });
});

// 2) El movil reclama el codigo entregando el authorization code de Discord.
router.post('/claim', claimLimiter, (req, res) => {
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

// 3) La TV consulta el estado (polling) firmando `code.challenge`. La firma
// prueba la posesion de la llave privada sin transmitir ningun secreto
// reutilizable: quien solo vea el code (p.ej. por el QR) no puede recuperar el
// authCode porque no puede producir una firma valida.
router.get('/status', (req, res) => {
    const { code, signature } = req.query;
    if (typeof code !== 'string' || !CODE_RE.test(code)) {
        return res.status(400).json({ error: 'invalid_code' });
    }

    const entry = links.get(code);
    if (isExpired(entry)) {
        if (entry) links.delete(code);
        // La TV regenera un codigo nuevo al ver esto.
        return res.json({ status: 'expired' });
    }

    const message = `${code}.${entry.challenge}`;
    if (!verifySignature(entry.publicKey, message, signature)) {
        return res.status(403).json({ error: 'bad_signature' });
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

// 4) Pagina de aterrizaje del QR. El movil escanea el QR de la TV (una URL
// https, que las camaras abren de forma fiable), cae aqui con el code y desde
// esta pagina abre la app por deep link con el code prellenado. Si la app no
// esta instalada o el deep link falla, la pagina muestra el code e
// instrucciones para vincular a mano. El code se valida antes de reflejarlo
// en el HTML (evita inyeccion).
router.get('/open', (req, res) => {
    const { code } = req.query;
    const valid = typeof code === 'string' && CODE_RE.test(code);
    const safeCode = valid ? code : '';
    const deepLink = valid ? `animeflvtv://link?code=${safeCode}` : '';

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Vincular TV · AnimeFLV</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
         background:#0e0e10; color:#fff; display:flex; min-height:100vh;
         align-items:center; justify-content:center; padding:24px; }
  .card { width:100%; max-width:420px; text-align:center; }
  h1 { font-size:22px; margin:0 0 8px; }
  p { color:#b7b7bd; font-size:15px; line-height:1.5; margin:0 0 20px; }
  .code { display:inline-block; font-size:34px; font-weight:800; letter-spacing:10px;
          background:#1a1a1d; border:1px solid #2a2a2e; border-radius:14px;
          padding:14px 20px; margin:8px 0 24px; }
  .btn { display:block; width:100%; background:#01b9ee; color:#fff; text-decoration:none;
         font-weight:700; font-size:17px; padding:16px; border-radius:14px; margin-bottom:16px; }
  .steps { text-align:left; color:#b7b7bd; font-size:14px; line-height:1.6; }
  .brand { color:#01b9ee; font-style:italic; }
</style>
</head>
<body>
  <div class="card">
    <h1>Vincular esta <span class="brand">TV</span></h1>
    ${valid ? `
    <p>Toca el botón para abrir AnimeFLV en este teléfono y vincular la TV. El código ya va incluido.</p>
    <div class="code">${safeCode}</div>
    <a class="btn" href="${deepLink}">Abrir en AnimeFLV</a>
    <div class="steps">
      ¿No se abrió? Abre <b>AnimeFLV</b> a mano →<br>
      <b>Perfil → Vincular TV</b> e ingresa el código <b>${safeCode}</b>.
    </div>` : `
    <p>El enlace no es válido o el código expiró. Genera un código nuevo en tu televisor e inténtalo otra vez.</p>`}
  </div>
  ${valid ? `<script>
    // Intento de apertura automatica; si la app no esta, no pasa nada y queda
    // el boton + instrucciones.
    setTimeout(function(){ window.location.href = ${JSON.stringify(deepLink)}; }, 400);
  </script>` : ''}
</body>
</html>`);
});

module.exports = router;
