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
            // El device-link de TV hace polling y superaria este limite; tiene
            // su propio limitador dedicado en su router.
            skip: (req) => req.path.startsWith('/tv-link'),
        });

        this.app.use(helmet({
            // HSTS explicito: fuerza a los navegadores a usar siempre HTTPS en
            // este host y subdominios durante 1 año. (La app movil no depende de
            // esto: usa una URL base https:// fija.)
            hsts: { maxAge: 31536000, includeSubDomains: true },
        }));
        // CORS permisivo global, EXCEPTO /tv-link: esos endpoints de vinculacion
        // no deben ser invocables por JS desde otros origenes en un navegador.
        // Al no emitir cabecera Access-Control-Allow-Origin para /tv-link, el
        // navegador bloquea las peticiones cross-origin. La app movil (cliente
        // http nativo) y la pagina /tv-link/open (navegacion top-level) no se
        // ven afectadas: CORS solo aplica a XHR/fetch cross-origin de navegador.
        const corsMiddleware = cors();
        this.app.use((req, res, next) => {
            if (req.path.startsWith('/tv-link')) return next();
            return corsMiddleware(req, res, next);
        });
        this.app.use(limiter);
        this.app.use(morgan('dev'));
        this.app.use(express.urlencoded({ extended: true }))
        this.app.use(express.json());
        this.app.use('/', express.static(path.join(__dirname, '..', 'public_files')));
    }

    routes() {
        this.app.use('/tv-link', require('../routes/tv_link'));
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