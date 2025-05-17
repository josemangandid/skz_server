const { Router } = require('express');
const router = Router();
const fs = require('fs');
const path = require('path');
const vm = require('vm');

router.get('/', async (req, res) => {
  res.json("Hacked");
});

router.get('/app', (req, res) => {
  const app = req.query.q;

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
  let { code, base, length, splits } = req.body
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
  let { code } = req.body
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
  const rutaArchivo = path.join(__dirname, '..', 'public_files', fileName);
  fs.readFile(rutaArchivo, 'utf8', (err, data) => {
    if (err) {
      return res.status(500).json({ error: 'No se pudo leer el archivo.' });
    }

    try {
      const jsonData = JSON.parse(data);
      res.json(jsonData);
    } catch (parseError) {
      res.status(500).json({ error: 'No se pudo leer el archivo JSON.' });
    }
  });
}

async function readHTMLFile(fileName, res) {
  const rutaArchivo = path.join(__dirname, '..', 'public_files', fileName);
  fs.readFile(rutaArchivo, 'utf8', (err, data) => {
    if (err) {
      return res.status(500).json({ error: 'No se pudo leer el archivo HTML.' });
    }

    res.send(data);
  });
}

async function readTXTFile(fileName, res) {
  const rutaArchivo = path.join(__dirname, '..', 'public_files', fileName);
  fs.readFile(rutaArchivo, 'utf8', (err, data) => {
    if (err) {
      return res.status(500).json({ error: 'No se pudo leer el archivo TXT.' });
    }

    res.setHeader('Content-Type', 'text/plain');
    res.send(data);
  });
}



module.exports = router;