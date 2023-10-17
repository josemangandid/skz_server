const { Router } = require('express');
const router = Router();
const fs = require('fs');
const path = require('path');

router.get('/', async (req, res)=> {
    res.json("Hacked");
});

router.get('/app', (req, res) => {
  const app = req.query.q;

  res.redirect("market://details?id=" + app);
});

router.get('/:nombreArchivo', (req, res) => {
    const nombreArchivo = req.params.nombreArchivo;
    const rutaArchivo = path.join(__dirname, '..', 'app-json', nombreArchivo);
  
    fs.readFile(rutaArchivo, 'utf8', (err, data) => {
      if (err) {
        return res.status(500).json({ error: 'No se pudo leer el archivo JSON.' });
      }
  
      try {
        const jsonData = JSON.parse(data);
        res.json(jsonData);
      } catch (parseError) {
        if(nombreArchivo.includes("html")){
          res.send(data);
        } else {
          res.status(500).json({ error: 'No se pudo leer el archivo JSON.' });
        }
      }
    });
  });

  

module.exports = router;