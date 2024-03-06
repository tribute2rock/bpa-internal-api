const categoriesController = require('./categories');
const formsController = require('./forms');
const requestsController = require('./requests');
const authenticationController = require('./authentication');
const formBuilderController = require('./formbuilder');
const draftRequestController = require('./draftRequest');
const externalController = require('./external');
const workFlowLogController = require('./workFlowLogs');
const requestStoreController = require('./requeststore');
const internalAuthenticationController = require('./internalAuthentication');
const branchController = require('./branches');
const generateReference = require('./generateReference');
const generateRefNumberBibini = require('./generateReference');

module.exports = {
  categoriesController,
  formsController,
  requestsController,
  authenticationController,
  formBuilderController,
  draftRequestController,
  externalController,
  workFlowLogController,
  requestStoreController,
  internalAuthenticationController,
  branchController,
  generateReference,
  generateRefNumberBibini,
};
