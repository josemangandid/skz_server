const { Router } = require('express');
const router = Router();
const fs = require('fs');
const path = require('path');

router.get('/', async (req, res) => {
  res.json("Hacked");
});

router.get('/app', (req, res) => {
  const app = req.query.q;

  res.redirect("market://details?id=" + app);
});

router.get('/:nombreArchivo', (req, res) => {

  const regex = /\.(html|json|txt)$/i;
  const regexJSON = /\.(json)$/i;
  const regexTXT = /\.(txt)$/i;
  const regexHTML = /\.(HTML)$/i;
  const nombreArchivo = req.params.nombreArchivo;


  if(regex.test(nombreArchivo)){
    if(regexJSON.test(nombreArchivo)){
      readJSONFile(nombreArchivo, res)
    } else if(regexHTML.test(nombreArchivo)){
      readHTMLFile(nombreArchivo, res)
    } else if(regexTXT.test(nombreArchivo)){
      readTXTFile(nombreArchivo, res)
    }
  } else {
    return res.status(500).json({ error: 'Ruta no válida' });
  }


});

async function readJSONFile(fileName, res){
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

async function readHTMLFile(fileName, res){
  const rutaArchivo = path.join(__dirname, '..', 'public_files', fileName);
    fs.readFile(rutaArchivo, 'utf8', (err, data) => {
      if (err) {
        return res.status(500).json({ error: 'No se pudo leer el archivo HTML.' });
      }

      res.send(data);
    });
}

async function readTXTFile(fileName, res){
  const rutaArchivo = path.join(__dirname, '..', 'public_files', fileName);
    fs.readFile(rutaArchivo, 'utf8', (err, data) => {
      if (err) {
        return res.status(500).json({ error: 'No se pudo leer el archivo TXT.' });
      }

      res.send(data);
    });
}



module.exports = router;