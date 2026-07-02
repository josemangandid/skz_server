const express = require('express');
const morgan = require('morgan');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

class Server {
    constructor() {
        this.app = express();
        this.port = process.env.PORT || '8080';

        this.settings();
        this.middlewares();
        this.routes();
    }

    connectToDB() {
        connection();
    }

    settings() {
        this.app.set('json spaces', 3);
        this.app.set('trust proxy', 1);
    }

    middlewares() {
        const limiter = rateLimit({
            windowMs: 15 * 60 * 1000,
            max: 100,
            message: { error: 'Demasiadas peticiones desde esta IP, por favor intenta de nuevo en unos minutos.' },
            standardHeaders: true,
            legacyHeaders: false,
        });

        this.app.use(helmet());
        this.app.use(cors());
        this.app.use(limiter);
        this.app.use(morgan('dev'));
        this.app.use(express.urlencoded({ extended: true }))
        this.app.use(express.json());
        this.app.use('/', express.static(path.join(__dirname, '..', 'public_files')));
    }

    routes() {
        // House ads live under /ads and must be mounted before the api router,
        // whose single-segment catch-all (/:nombreArchivo) would otherwise
        // shadow these multi-segment routes.
        this.app.use('/ads', require('../routes/ads'));
        this.app.use(require('../routes/api'));
        this.app.use('*', (req, res) => {
            res.status(404).json({
                success: false,
                message: "Page not found",
                error: {
                    statusCode: 404,
                    message: "You reached a route that is not defined on this server"
                },
            });
        });
    }

    listen() {
        this.app.listen(this.port, () => {
            console.log(`Server on port ${this.port}`);
        });
    }
}

module.exports = Server;