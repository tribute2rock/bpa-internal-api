const { verifyToken } = require('../utils/jwt');
const { generateRefreshToken } = require('../utils/jwt');
const { generateAccessToken } = require('../utils/jwt');
const { respond } = require('../utils/response');
const { HTTP } = require('../constants/response');
const { Customer, User } = require('../models');
const cryptoRandomString = require('crypto-random-string');
const redis = require('../config/redis');
const argon2 = require('argon2');
const { promisify } = require('util');
const api = require('../external');
const { customerAuthCBS } = require('../controllers/channelManager');
const urlSMS = process.env.CUSTOMER_SMS;
const axios = require('axios');

const staticCustomer = {
  id: 1,
  accountName: 'Ram Khanal',
  accountNumber: '1111111111',
  mobileNumber: '9999999999',
  email: 'customer@bpa.com',
};

const staticOTP = '123456';

/**
 * Checks if the customer provided accountNumber
 * and mobileNumber matches the customer view recors.
 * @param accountNumber
 * @param mobileNumber
 * @returns {void}
 */
const validateCustomerCredentials = async (accountNumber, mobileNumber) => {
  let response = await api.authenticate(accountNumber, mobileNumber);
  if (response.status) {
    // insert into customer or update if customer exists by account number.
    const customer = await Customer.findOne({
      where: {
        accountNumber: response.data.accountNo ? response.data.accountNo : response.data.ACCOUNT_NUMBER,
      },
    });
    const data = response.data;
    let newCustomer;
    if (customer) {
      newCustomer = await Customer.update(
        {
          accountName: data?.fullName ? data?.fullName : data.CUSTOMER_NAME,
          mobileNumber: data?.mobileNo ? data.mobileNo : data?.MOBILE_NUMBER,
          email: data?.email ? data?.email : data?.EMAIL,
          branchSol: data?.branchSol ? data?.branchSol : data?.branchSol,
        },
        {
          where: {
            accountNumber: data?.accountNo ? data?.accountNo : data?.ACCOUNT_NUMBER,
          },
        }
      );
    } else {
      newCustomer = await Customer.create({
        accountNumber: data?.accountNo ? data?.accountNo : data?.ACCOUNT_NUMBER,
        accountName: data?.fullName ? data?.fullName : data.CUSTOMER_NAME,
        mobileNumber: data?.mobileNo ? data.mobileNo : data?.MOBILE_NUMBER,
        email: data?.email ? data?.email : data?.EMAIL,
        branchSol: data?.branchSol ? data?.branchSol : data?.branchSol,
      });
    }
    return newCustomer;
  } else {
    return false;
  }
};

/**
 * Generates a One time password for the customer and
 * stores it in cache for 5 minutes.
 *
 * @param accountNumber
 * @param mobileNumber
 */
const generateOTP = async (accountNumber, mobileNumber) => {
  const otp = cryptoRandomString(6);
  const key = `customer-otp-${accountNumber}`;
  await redis.set(key, await argon2.hash(otp));
  await redis.expire(key, 300); //TODO: take redis expiration from env.
  return otp;
};

/**
 * Sends one time password to the customer's mobile phone.
 *
 * @param mobileNumber
 * @param otp
 */
const sendOTP = async (mobileNumber, message) => {
  //TODO: Use SMS channel to send OTP to customer.
  try {
    const authtoken = await authToken('kiosk', 'kiosk');
    const responseSMS = await axios.post(
      urlSMS,
      {
        mob_no: mobileNumber,
        msg_str: message,
        user_name: 'gentech',
        purpose: 'BPA KEY',
      },
      {
        headers: {
          'Content-Type': 'application/json',
          AccessToken: `Bearer ${authtoken}`,
        },
      }
    );
    return responseSMS;
  } catch (error) {
    return error;
  }
};

/**
 * Verifies if the otp provided by the customer is valid.
 *
 * @param accountNumber
 * @param otp
 * @returns {boolean}
 */
const verifyOTP = async (accountNumber, otp) => {
  const redisGet = promisify(redis.get).bind(redis);
  const value = await redisGet(`customer-otp-${accountNumber}`);
  if (!value) {
    return false;
  }
  return argon2.verify(value, otp);
};

/**
 * Fetches customer information from the customer view.
 *
 * @param accountNumber
 */
const getCustomerInfo = (accountNumber) => {
  //TODO: fetch customer info from customer database view.
  return {
    accountName: staticCustomer.accountNumber,
    mobileNumber: staticCustomer.mobileNumber,
    email: staticCustomer.email,
  };
};

/**
 * Validates the accountNumber and mobileNumber
 * provided by the customer. Generates an OTP and
 * sends it to the customer through SMS channel.
 *
 * @param req
 * @param res
 */
const initiateLogin = async (req, res) => {
  try {
    const accountNumber = req.body.accountNumber;
    const mobileNumber = req.body.mobileNumber;
    const verified = await validateCustomerCredentials(accountNumber, mobileNumber);
    if (!verified) {
      return respond(
        res,
        HTTP.StatusPreconditionFailed,
        'Provided account number or mobile number is incorrect. Please contact your branch to update the details.'
      );
    }
    return respond(res, HTTP.StatusOk, 'Credintials matches bank records.');

    // if (verified) {
    //   const otp = await generateOTP(accountNumber, mobileNumber);
    //   try {
    //     const message = 'Do not share OTP!\nYour OTP for Customer Service is ' + otp + '.\nThank you.\nSunrise Bank.';
    //     sendOTP(mobileNumber, message);
    //   } catch (e) {
    //     return respond(res, HTTP.StatusInternalServerError, 'Failed to send OTP.');
    //   }
    //   console.log(otp);
    //   return respond(res, HTTP.StatusOk, 'OTP sent to registered mobile number.');
    // } else {
    //   return respond(
    //     res,
    //     HTTP.StatusPreconditionFailed,
    //     'Provided account number or mobile number is incorrect. Please contact your branch to update the details.'
    //   );
    // }
  } catch {
    return respond(res, HTTP.StatusInternalServerError, 'Something went wrong. Please contact the bank');
  }
};

// hasOTP will check if the OTP is already send to the user or not. if already send, not to resend on every reload
const hasOTP = async (accountNumber) => {
  const redisGet = promisify(redis.get).bind(redis);
  const value = await redisGet(`customer-otp-${accountNumber}`);
  if (!value) {
    return false;
  }
  return true;
};

/**
 *  To generate and send otp to customer on otp page load
 * @param {*} req
 * @param {*} res
 * @returns
 */
const generateAndSendOTP = async (req, res) => {
  const accountNumber = req.body.accountNumber;
  const mobileNumber = req.body.mobileNumber;
  const otpSend = await hasOTP(accountNumber);
  let otp;
  if (!otpSend) {
    otp = await generateOTP(accountNumber, mobileNumber);
    console.log(otp, 'otp');
    try {
      const message = 'Do not share OTP!\nYour OTP for Customer Service is ' + otp + '.\nThank you.\nGlobal Bank.';
      sendOTP(mobileNumber, message);
    } catch (e) {
      return respond(res, HTTP.StatusInternalServerError, 'Failed to send OTP.');
    }
  }
  return respond(res, HTTP.StatusOk, 'OTP sent to registered mobile number.', otp);
};

const getOTP = async (otp, req, res) => {
  console.log(otp);
  // res.status(200).send('OK');
};
/**
 * Verifies the OTP provided by the customer for
 * the authorization process.
 *
 * @param req
 * @param res
 */
const login = async (req, res) => {
  const accountNumber = req.body.accountNumber;
  const otp = req.body.otp;
  const verified = await verifyOTP(accountNumber, otp);
  if (!verified) {
    return respond(res, HTTP.StatusPreconditionFailed, 'Invalid one time password.');
  }
  const customer = await Customer.findOne({
    where: {
      accountNumber: accountNumber,
    },
  });
  if (!customer) {
    return respond(
      res,
      HTTP.StatusInternalServerError,
      'Your account details did not match our record. Please contact your branch to update the details.'
    );
  }

  await redis.del(`customer-otp-${accountNumber}`);

  respond(res, HTTP.StatusOk, 'Login Successful', {
    accessToken: generateAccessToken(customer),
    refreshToken: generateRefreshToken(customer.id),
  });
};

/**
 * Refreshes the access token of the customer. Also,
 * new refresh token is generated for refresh token rotation.
 *
 * @param req
 * @param res
 */
const refresh = async (req, res) => {
  const refreshToken = req.body.refreshToken;
  const { verified, customerId } = verifyToken(refreshToken);
  if (!verified) {
    return respond(res, HTTP.StatusUnauthorized, 'Invalid refresh token');
  } else {
    //TODO: Search for customer using customer ID.
    const customer = await Customer.findOne({
      where: {
        id: customerId,
      },
    });
    if (!customer) {
      return respond(res, HTTP.StatusUnauthorized, 'Invalid refresh token');
    } else {
      respond(res, HTTP.StatusOk, 'Tokens generated successfully.', {
        accessToken: generateAccessToken(customer),
        refreshToken: generateRefreshToken(customer.id),
      });
    }
  }
};

module.exports = {
  login,
  generateAndSendOTP,
  initiateLogin,
  refresh,
  sendOTP,
  getOTP,
};
