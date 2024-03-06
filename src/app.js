const express = require("express");
require('express-async-errors');
const bodyParser = require("body-parser");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const ErrorHandler = require("./errors/handlers");
const config = require('./config');
const morgan = require('./config/morgan');
const routes = require('./routes');
const xss = require('xss-clean');

const app = express();
app.use('/', express.static('./public'));
if (config.env !== 'test') {
  app.use(morgan.successHandler);
  app.use(morgan.errorHandler);
}

// set security HTTP headers
app.use(helmet());

// parse json request body
app.use(bodyParser.json());

// parse urlencoded request body
app.use(bodyParser.urlencoded({extended: true}));

// sanitize request data
app.use(xss());

// gzip compression
app.use(compression());

// enable cors
app.use(cors());
app.options('*', cors());

app.use("/api", routes);

app.use(ErrorHandler);

require("./config/database");

module.exports = app;
