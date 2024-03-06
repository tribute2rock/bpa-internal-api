const validator = require('../config/validator');

/**
 * Validates the login request.
 *
 * @param req
 * @param res
 * @param next
 */
const login = async (req, res, next) => {
  //TODO: add more validation.
  validator(req.body, {
    accountNumber: 'required',
    otp: 'required',
  });
  next();
};

/**
 * Validates the authorization request.
 *
 * @param req
 * @param res
 * @param next
 */
const initiateLogin = async (req, res, next) => {
  //TODO: add validation rules.
  // validator(req.body, {
  //   accountNumber: 'required',
  //   mobileNumber: 'required',
  // });
  next();
};

/**
 * Validates the authorization request.
 *
 * @param req
 * @param res
 * @param next
 */
const refresh = async (req, res, next) => {
  //TODO: add validation rules.
  validator(req.body, {
    refreshToken: 'required',
  });
  next();
};

module.exports = {
  login,
  initiateLogin,
  refresh,
};
