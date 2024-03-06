const { logger } = require('../../config/logger');
const nodemailer = require('nodemailer');
const { EMAIL } = require('../../config');

const transporter = nodemailer.createTransport({
  host: EMAIL.HOST,
  port: EMAIL.PORT,
  secure: EMAIL.SECURE,
  auth: {
    user: EMAIL.USERNAME,
    pass: EMAIL.PASSWORD,
  },
});

module.exports.sendMessage = async (email) => {
  return transporter
    .sendMail({
      from: '"Sunrise Bank " <info@generaltechnology.com.np>',
      ...email,
    })
    .then((info) => {
      if (info.rejected.length) {
        // console.log(info.rejected);
      }
      return info;
    })
    .catch((err) => {
      // logger.error(err);
      // console.log(err);
    });
};
