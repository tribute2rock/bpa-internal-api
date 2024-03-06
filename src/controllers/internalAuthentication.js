const { verifyToken } = require('../utils/jwt');
const { respond } = require('../utils/response');
const redis = require('../config/redis');
const { default: axios } = require('axios');
const { HTTP, Status } = require('../constants/response');
const { promisify } = require('util');

const authorizeInternalUser = async (req, res) => {
  const token = req.body.token;
  const id = req.body.id;
  const tokenVerify = await axios.get('http://localhost:8080/api/v1/handle-access-token', {
    params: { access: token, j: id },
  });
  const accessToken = tokenVerify.data.data.accessToken;
  const refreshToken = tokenVerify.data.data.refreshToken;

  //  Way to  JWt decodea
  // const decodedToken = jwt.decode(accessToken, {
  //   complete: true,
  // });

  // if (!decodedToken) {
  //   console.log(`provided token does not decode as JWT`);
  // }

  const { verified } = verifyToken(refreshToken);
  if (!verified) {
    return respond(res, HTTP.StatusUnauthorized, 'Invalid refresh token');
  } else {
    // const userId = decodedToken.payload.id;
    // const key = `internal-access-token-${token}`;
    // const key2 = `internal-refresh-token-${token}`;
    // await redis.set(key, accessToken);
    // await redis.set(key2, refreshToken);
    // await redis.expire(key, 3000);
    // return respond(res, HTTP.StatusOk, 'sucessfully send token', {status: Status.Success, accessToken: accessToken, refreshToken: refreshToken, type: 'Internal'});
    res.json({
      status: Status.Success,
      message: 'sucessfully send token',
      accessToken: accessToken,
      refreshToken: refreshToken,
      type: 'Internal',
    });
  }
};

const getInternalUser = async (req, res) => {
  const token = req.query.access;
  const redisGet = promisify(redis.get).bind(redis);
  const accessToken = await redisGet(`internal-access-token-${token}`);
  const refreshToken = await redisGet(`internal-refresh-token-${token}`);

  if (!accessToken && refreshToken) {
    return false;
  }
  res.status(HTTP.StatusOk).json({
    status: Status.Success,
    message: 'sucessfully recived token',
    accessToken: accessToken,
    refreshToken: refreshToken,
  });
};
// respond(res, HTTP.StatusOk, 'Authentication Successful', {
//   status: Status.Success,
//   message: 'sucessfully send token',
// });

// const user = adUsers.find(
//   (adUsers) =>
//     adUsers.USER_ID === decodedToken.payload.userId && adUsers.OFFICIAL_EMAIL === decodedToken.payload.email
// );
// if (user) {
//   res.status(200).json([user]);
// } else {
//   res.status(402).json({ Message: 'Invalid login credentials' });
// }
// if (!user) {
//   return respond(
//     res,
//     HTTP.StatusInternalServerError,
//     'Your adUser details did not match our record. Please contact your branch to update the details.'
//   );
//   return;
// }

// res.status(HTTP.StatusOk).json({
//   status: Status.Success,
//   message: 'sucessfully send token',
// });
// console.log(tokenOutput);

// if (user) {
//   res.status(200).json([user]);
// } else {
//   res.status(402).json({ Message: 'Invalid login credentials' });
// }
// if (!user) {
//   return respond(
//     res,
//     HTTP.StatusInternalServerError,
//     'Your adUser details did not match our record. Please contact your branch to update the details.'
//   );
//   return;
// }
// respond(res, HTTP.StatusOk, 'Authentication Successful', {
//   accessToken: generateAccessToken(user),
//   refreshToken: generateRefreshToken(user.id),
// });

module.exports = {
  authorizeInternalUser,
  getInternalUser,
};
