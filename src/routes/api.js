const { Router } = require('express');
const router = Router();
const fs = require('fs');
const path = require('path');

router.get('/', async (req, res) => {
  res.json("Hacked");
});

router.get('/app', (req, res) => {
  const app = req.query.q;
  const packageRegex = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/;
  if (!app || !packageRegex.test(app)) {
    return res.status(400).json({ error: 'Invalid app ID' });
  }
  res.redirect("market://details?id=" + app);
});


function getJson(p, a, c, k, e, d) {
  while (c--)
    if (k[c])
      p = p.replace(new RegExp('\\b' + c.toString(a) + '\\b', 'g'), k[c]);
  return p;
}

function isValidURL(urlString) {
  try {
    const url = new URL(urlString);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (err) {
    return false;
  }
}

router.post('/sw', (req, res) => {
  let { code, base, length, splits } = req.body;
  if (!code || !base || !length || !splits) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }
  try {
    let decodedCode = Buffer.from(code, 'base64').toString('utf-8');
    let deobfuscatedCode = getJson(decodedCode, base, length, splits.split("|"));
    let url = deobfuscatedCode.split("hls2\":\"")[1].split("\"}")[0];

    console.log({ url });
    res.json({ url });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Invalid data' });
  }
});


router.post('/eval', (req, res) => {
  let { code } = req.body;
  if (!code) {
    return res.status(400).json({ error: 'Missing required parameter: code' });
  }
  try {

    let decodedCode = Buffer.from(code, 'base64').toString('utf-8');
    let code1 = `${decodedCode.split("}('")[1].split("}',")[0]}}`;
    let base = parseInt(decodedCode.split("}',")[1].split(",")[0].trim());
    let length = parseInt(decodedCode.split(`}',${base},`)[1].split(",")[0].trim());
    let splits = decodedCode.split(`}',${base},${length},'`)[1].split("'")[0];
    let deobfuscatedCode = getJson(code1, base, length, splits.split("|"));
    let url = deobfuscatedCode.split("hls2\":\"")[1].split("\"}")[0];

    console.log({ url });
    res.json({ url })

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Invalid data' });
  }
});

router.get('/discord-callback', (req, res) => {
  const { code, state, error, error_description } = req.query;

  let redirectUri = 'animeflv-callback://discord-callback';
  const params = [];

  if (code) params.push(`code=${code}`);
  if (state) params.push(`state=${state}`);
  if (error) params.push(`error=${error}`);
  if (error_description) params.push(`error_description=${error_description}`);

  if (params.length > 0) {
    redirectUri += `?${params.join('&')}`;
  }

  res.redirect(redirectUri);
});

router.get('/:nombreArchivo', (req, res) => {

  const regex = /\.(html|json|txt)$/i;
  const regexJSON = /\.(json)$/i;
  const regexTXT = /\.(txt)$/i;
  const regexHTML = /\.(HTML)$/i;
  const nombreArchivo = req.params.nombreArchivo;


  if (regex.test(nombreArchivo)) {
    if (regexJSON.test(nombreArchivo)) {
      readJSONFile(nombreArchivo, res)
    } else if (regexHTML.test(nombreArchivo)) {
      readHTMLFile(nombreArchivo, res)
    } else if (regexTXT.test(nombreArchivo)) {
      readTXTFile(nombreArchivo, res)
    }
  } else {
    return res.status(500).json({ error: 'Ruta no válida' });
  }


});

async function readJSONFile(fileName, res) {
  const rutaArchivo = path.join(__dirname, '..', 'public_files', path.basename(fileName));
  try {
    const data = await fs.promises.readFile(rutaArchivo, 'utf8');
    const jsonData = JSON.parse(data);
    res.json(jsonData);
  } catch (err) {
    res.status(500).json({ error: 'No se pudo leer o parsear el archivo JSON.' });
  }
}

async function readHTMLFile(fileName, res) {
  const rutaArchivo = path.join(__dirname, '..', 'public_files', path.basename(fileName));
  try {
    const data = await fs.promises.readFile(rutaArchivo, 'utf8');
    res.send(data);
  } catch (err) {
    res.status(500).json({ error: 'No se pudo leer el archivo HTML.' });
  }
}

async function readTXTFile(fileName, res) {
  const rutaArchivo = path.join(__dirname, '..', 'public_files', path.basename(fileName));
  try {
    const data = await fs.promises.readFile(rutaArchivo, 'utf8');
    res.setHeader('Content-Type', 'text/plain');
    res.send(data);
  } catch (err) {
    res.status(500).json({ error: 'No se pudo leer el archivo TXT.' });
  }
}



module.exports = router;