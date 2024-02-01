
const express = require('express');
const morgan = require('morgan');
const path = require('path');

class Server {
    constructor(){
        this.app = express();
        this.port = process.env.PORT || '8080';

        this.settings();
        this.middlewares();
        this.routes();
    }

    connectToDB(){
        connection();
    }

    settings(){
        this.app.set('json spaces', 3);
    }

    middlewares(){
        this.app.use(morgan('dev'));
        this.app.use(express.urlencoded({ extended: true }))
        this.app.use(express.json());
        this.app.use('/', express.static(path.join(__dirname, 'src', 'public_files')));
    }

    routes(){
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

    listen(){
        this.app.listen(this.port, () => {
            console.log(`Server on port ${this.port}`);
        });
    }
}

module.exports = Server;