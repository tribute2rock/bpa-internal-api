// const { UserNotAuthenticated } = require('../errors/authorization');
const { extractAuthorizationToken } = require('../utils/request');
const { respond } = require('../utils/response');
const { HTTP } = require('../constants/response');
const { verifyToken } = require('../utils/jwt');

/**
 * Checks if the user is authorized or not based on the
 * access token passed in the authorization header.
 *
 * @param req
 * @param res
 * @param next
 */
const authorize = async (req, res, next) => {
  const token = extractAuthorizationToken(req);
  const { verified, user } = verifyToken(token);
  if (verified) {
    req.user = user;
    next();
  } else {
    // throw new UserNotAuthenticated();
    return respond(res, HTTP.StatusUnauthorized, 'User Not Authenticated.');
  }
};

module.exports = {
  authorize,
};
