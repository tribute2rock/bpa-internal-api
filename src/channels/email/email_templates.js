const fs = require('fs');
const { resolve } = require('path');

module.exports.userAuthorizationEmailTemplate = (data) => {
  const html =
    `<p>Dear ${data.name},</p>` +
    `<br/>` +
    `<p>We received a request to verify client through your email Address.` +
    `</br>` +
    `Your authorization code for the request ${data.requestId} is:  </p>` +
    `<strong> ${data.authCode} </strong>` +
    `<br/>` +
    `If you did not request this code, please ignore this email.` +
    `<br/>` +
    `<strong>Please do not forward or give this code to anyone.</strong>` +
    `<br/>` +
    `Sincerely Yours,` +
    `<br/>` +
    `Global Bank .` +
    `</p>`;

  return {
    to: data.email,
    subject: 'Global Bank - BPA Authorization Code ',
    text: '',
    html: html,
  };
};

module.exports.authCodeEmailTemplate = (data) => {
  const html = template();

  return {
    to: data.email,
    subject: 'Global Bank - BPA Authorization Code ',
    text: '',
    html: html,
  };
};

const template = () => {
  return fs.readFileSync(resolve(__dirname, './template.html')).toString();
};
