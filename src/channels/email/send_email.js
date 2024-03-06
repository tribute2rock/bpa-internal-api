const {
  userAuthorizationEmailTemplate,
  authCodeEmailTemplate,
} = require("./email_templates");
const { sendMessage } = require("./email");

//function to send email to the user
// const body = {
//   name: "Dilli Chalise",
//   email: "dillichalise@gmail.com",
//   requestId: "BPA-123",
//   authCode: "123456789",
// };
module.exports.sendAuthorizationEmail = async (body) => {
  sendMessage(userAuthorizationEmailTemplate(body));
};

module.exports.sendAuthCodeEmail = async (body) => {
  sendMessage(authCodeEmailTemplate(body));
};
