const { respond } = require('../utils/response');
const { HTTP } = require('../constants/response');
const logger = require('../config/logger');

/**
 * Handles the error when ValidationError is captured.
 *
 * @param err
 * @param res
 */
function ValidationErrorHandler(err, res) {
  const { message, data } = err;
  respond(res, HTTP.StatusPreconditionFailed, message, data);
}

/**
 * Handles the error when no token was found in the authorization header.
 *
 * @param err
 * @param res
 */
function AuthorizationTokenNotFoundErrorHandler(err, res) {
  return respond(res, HTTP.StatusUnauthorized, 'Unauthorized Action.');
}

const ErrorHandler = (err, req, res, next) => {
  const { name } = err;
  logger.error(err);
  
  console.log(err);
  switch (name) {
    case 'Validation Error':
      ValidationErrorHandler(err, res);
      return;
    case 'Authorization Token Not Found':
      AuthorizationTokenNotFoundErrorHandler(err, res);
      return;
    default:
      respond(res, HTTP.StatusInternalServerError, 'Internal Server Error.');
  }
};

module.exports = ErrorHandler;
