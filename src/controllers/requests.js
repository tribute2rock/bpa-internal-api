const argon2 = require('argon2');
const moment = require('moment');
const { Op } = require('sequelize');
const { isEmpty, update } = require('lodash');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const Handlebars = require('handlebars');
const pdf = require('pdf-creator-node');
const fs = require('fs');
const FormData = require('form-data');
const { referenceNumberBackend } = require('./generateReference');

const axios = require('axios');
const {
  Request,
  RequestValue,
  Form,
  WorkflowLog,
  DraftRequest,
  DraftRequestValue,
  WorkflowFiles,
  Workflow,
  Category,
  SubRequest,
} = require('../models');
const { HTTP, Status } = require('../constants/response');
const { status: RequestStatus, actions } = require('../constants/request');
const db = require('../config/database');
const Validate = require('../validations/dynamic');
const { sendNewRequestEmail } = require('../utils/request');
const { respond } = require('../utils/response');
const { decode } = require('html-entities');
const { sendOTP } = require('../controllers/authentication');
const { createRequest } = require('./requeststore');
const { TO_DMS } = require('../config/index');
const { response } = require('../app');
const request = require('../models/request');
const sub_request = require('../../../bpa-api-new/src/models/sub_request');
const MULTER_FILE_PATH = process.env.MULTER_FILE_PATH;

const getPagination = (page, size) => {
  const limit = size ? +size : 3;
  const offset = page ? page * limit : 0;
  return { limit, offset };
};
const getPagingData = (data, page, limit, offset) => {
  const { count: totalItems, rows: pageData } = data;
  const currentPage = page ? +page : 0;
  const totalPages = Math.ceil(totalItems / limit);
  return { totalItems, pageData, totalPages, currentPage, offset };
};

const generateAuthCode = async () =>
  Math.random()
    .toString(36)
    .replace(/[^a-z0-9]+/g, '')
    .substr(0, 6);

// const generateRequestKey = async (tag = 'A') => {
//   let today = new Date();
//   let dd = String(today.getDate()).padStart(2, '0');
//   let mm = String(today.getMonth() + 1).padStart(2, '0'); //January is 0!
//   let yyyy = today.getFullYear().toString().substr(-2);
//   today = yyyy + mm + dd;

//   Request.belongsTo(Form);
//   const RequestCount = await Request.findAndCountAll({
//     where: {
//       createdAt: {
//         [Op.gte]: moment().startOf('year').toISOString(),
//         [Op.lte]: moment().endOf('year').toISOString(),
//       },
//     },
//     include: [
//       {
//         model: Form,
//         where: { tag: tag },
//       },
//     ],
//   });
//   return `${tag}-${today}-${RequestCount.count + 1}`;
//   // return `BPA-${Math.round(new Date().getTime() / 1000)}-${RequestCount.count + 1}`;
// };

const generateRequestKeyNew = async (formid, mode) => {
  const result = (await db.query(`exec [dbo].[ReferenceNumberGenerate] ${formid},'${mode}'`))[0];
  return result[0].serial;
};

const uploadToDMS = async (requestKey, files) => {
  const url = TO_DMS.UPLOAD_TO_DMS;
  const formData = new FormData();
  formData.append('document', requestKey);
  files.map((file) => {
    formData.append('files', fs.createReadStream(file.path));
    return true;
  });

  try {
    const { data } = await axios({
      method: 'post',
      url,
      data: formData,
      headers: formData.getHeaders(),
    });
    return {
      success: true,
      data: data.data.attachRes,
    };
  } catch (error) {
    return {
      success: false,
      data: null,
    };
  }
};

const countRequest = async (userId) => {
  const result = (
    await db.query(`
select isnull(a.total,0) count, s.name from (
select count(id) total, statusId from requests r
where requestSenderId = ${userId} and requestSenderType = 'user' group by statusId
) a right join statuses s on s.id = a.statusId
union all
select count(id) as total, 'draft' as name from draft_requests where requestSenderId = ${userId}  and requestSenderType = 'user' and draft_requests.isDeleted = 0`)
  )[0];
  return result;
};

/**
 * Post Request Send by Client.
 */
const store = async (req, res) => {
  const draftRequestId = req.body.id;
  let { formId, statusId, isDraft, customerAccount } = req.body;
  const isDynamic = req.body.isDynamic ? req.body.isDynamic === 'true' : null;
  const requestSenderId = req.user.id;
  const requestSenderType = 'user';
  const requestValues = JSON.parse(req.body.requestValues);
  const requestedBranch = req.body.requestedBranch;

  const form = await db.query(
    `SELECT name, limitType, limitValues, workflowId, categoryId, tag FROM forms WHERE id = ${formId} and isDeleted = 0`
  );
  // const form = (await db.query(`select name, limitType, limitValues, tag, workflowId, categoryId from forms where id = ${formId} and isDeleted = 0 and availableFor in ('Internal', 'both)`))[0][0]
  console.log(form, '==========FORMS========');
  let limitType = form[0][0]?.limitType;
  let limitValues = form[0][0]?.limitValues;

  if (formId == 2 || formId == 4) {
    let test = requestValues.filter((value) => {
      if (value.name == 'type_of_guarantee') {
        return value;
      }
    });
    if (
      test[0].value == 'Bid Bond' ||
      test[0].value == 'Performance Bond' ||
      test[0].value == 'Advance Payment' ||
      test[0].value == 'Supply Credit Guarantee' ||
      test[0].value == 'Line of Credit Commitment' ||
      test[0].value == 'Custom Guarantee'
    ) {
    } else {
      return respond(res, HTTP.StatusPreconditionFailed, 'Submission Failed! Guarantee type cannot be empty.');
    }
  }

  const repetedRequest = await Request.findAndCountAll({
    where: { formId: formId, isDeleted: false, requestSenderId: requestSenderId, requestSenderType: 'user' },
    attributes: ['statusId'],
  });

  if (form[0][0].workflowId == 9) {
    statusId = 4;
  }

  // const bibiniRef = await referenceNumberBackend(form[0][0].name);
  // const refNum = bibiniRef.data;
  // for (let i of requestValues) {
  //   if (i.name == 'requestIdentifier_copy') {
  //     i.value = refNum;
  //   }
  // }

  const requestStatus = repetedRequest?.rows[0]?.dataValues?.statusId || 0;
  const requestCount = repetedRequest.count;
  const requestRepeat = repetedRequest.rows.length !== 0 ? repetedRequest.count : null;

  let fileList = [];
  if (req.body.fileList) {
    fileList = JSON.parse(req.body.fileList);
  }
  if (isDynamic) {
    console.log('Logg: IsDynamic true');
    if (isDraft && isDraft !== 'true') {
      console.log('Logg: IsDraft && IsDraft false');
      const error = await Validate(req);
      if (!isEmpty(error)) {
        console.log('Logg: Is Empty error');
        return respond(res, HTTP.StatusPreconditionFailed, 'There are some errors in the data provided.', error);
      }
    }
  }

  try {
    const request = {
      formId,
      statusId,
      requestSenderId,
      requestSenderType,
      isDraft,
      requestRepeat,
      requestedBranch,
      customerAccount,
    };
    // get request Key
    // request.requestKey = await generateRequestKey(form[0][0].tag);

    let mode = form[0][0].name.includes('BIBINI') ? 'bibini' : 'form';
    console.log(mode, 'Test MODE=====', form[0][0].name);
    request.requestKey = await generateRequestKeyNew(formId, mode);
    console.log(request.requestKey, 'GENERATED REQUEST KEY=========');
    for (let i of requestValues) {
      if (i.name == 'requestIdentifier_copy') {
        i.value = request.requestKey;
      }
    }

    // get auth code
    const authCode = await generateAuthCode();

    request.authCode = await argon2.hash(authCode);

    let createdRequest;
    if (limitType === 1) {
      createdRequest = await createRequest(formId, form[0][0].name, request, requestValues, fileList, req.files);
    } else if (limitType === 2 && requestCount && limitValues > requestCount) {
      createdRequest = await createRequest(formId, form[0][0].name, request, requestValues, fileList, req.files);
    } else if ((limitType === 3 && requestStatus == 4) || requestStatus == 0) {
      createdRequest = await createRequest(formId, form[0][0].name, request, requestValues, fileList, req.files);
    } else {
      // console.log(limitValues, requestCount);
      return respond(res, HTTP.StatusInternalServerError, 'Failed to create new request(Limit Form Request).');
    }

    if (draftRequestId) {
      await DraftRequestValue.destroy({ where: { draftRequestId } });
      await DraftRequest.destroy({ where: { id: draftRequestId } });
    }

    return respond(res, HTTP.StatusOk, 'New request submitted successfully.');
  } catch (e) {
    console.log(e);
    return respond(res, HTTP.StatusInternalServerError, 'Failed to create new request.');
  }
};

/**
 * Edit Verification.
 */
const getRequestById = async (req, res) => {
  // let { id, key, authCode } = req.query;
  const { id, authCode } = req.query;
  try {
    const findOne = await Request.findOne({
      where: {
        id,
        // key,
      },
    });
    if (findOne.authCode) {
      // TODO: Remove const authCode from code.
      const verification = argon2.verify(findOne.authCode, authCode) || findOne.authCode === '123456';
      if (verification) {
        res.status(HTTP.StatusOk).json({
          status: Status.Success,
          message: 'Fetched Request Data.',
          data: findOne,
        });
      } else {
        res.status(HTTP.StatusNotFound).json({
          status: Status.Failed,
          message: 'Invalid Auth Code.',
          data: null,
        });
      }
    }
  } catch (e) {
    res.status(HTTP.StatusInternalServerError).json({
      status: Status.Failed,
      message: 'Auth Code Empty',
      data: null,
    });
  }
};

const getFiles = async (rea, res) => {
  const { id } = req.params;
};

const getComment = async (req, res) => {
  const { id } = req.params;
  const forms = await db.query(`select id,
                                       comment
                                from workflow_logs
                                       where requestId = ${id}`);
  res.send(forms[0]);
};

/**
 * Get Request by customer id.
 */
const all = async (req, res) => {
  let request;
  let message;

  const { page, pageSize, requestCategory } = req.query;
  const { limit, offset } = getPagination(page, pageSize);
  // TODO: get customer id from authentication token
  const customerId = req.user.id;
  const customerSol = req.user?.solId;
  let search = '';
  searchBase = req.query.searchBase || 'requestKey';
  if (req.query?.search && req.query?.searchBase) {
    search = req.query.search;
  }
  // TODO: validate if the status id is valid and exists in the status list
  // TODO: validate if page number and limit are instance of unsigned integer
  const statusId = req.query.status ? req.query.status : RequestStatus.completed;
  // const statusId = 2;
  let obj;
  if (statusId == 0) {
    obj = {};
  } else {
    obj = { statusId: statusId };
  }
  if (requestCategory == 'branch' && customerSol) {
    obj = { ...obj, requestedBranch: customerSol };
  } else {
    obj = { ...obj, requestSenderId: customerId };
  }
  try {
    Request.belongsTo(Form);
    Request.hasMany(RequestValue);
    request = await Request.findAndCountAll({
      limit: limit,
      offset: offset,
      where: {
        [searchBase]: { [Op.substring]: search },
        ...obj,
        requestSenderId: customerId,
        requestSenderType: 'user',
      },
      attributes: ['id', 'requestKey', 'requestRepeat', 'requestedBranch', 'statusId', 'createdAt', 'identifier'],
      include: [
        {
          model: Form,
          required: true,
          attributes: ['name'],
        },
        {
          model: RequestValue,
          required: false,
          attributes: ['value'],
          where: { name: 'beneficiary_name' },
        },
      ],
      order: [['createdAt', 'DESC']],
    });
  } catch (e) {
    res.status(HTTP.StatusInternalServerError).json({
      status: Status.Failed,
      message: 'Failed to fetch Request.',
      data: null,
    });
  }
  request = getPagingData(request, page, limit, offset);

  if (request !== null) {
    message = 'Fetched all requests.';
  } else {
    message = 'No requests were found.';
  }

  const count = await countRequest(customerId);
  res.status(HTTP.StatusOk).json({
    status: Status.Success,
    message,
    data: { request, count } || null,
  });
};

const allWorkflowLog = async (req, res) => {
  let request;
  let message;

  // TODO: get customer id from authentication token
  const requestId = 1;

  // TODO: validate if the status id is valid and exists in the status list
  // TODO: validate if page number and limit are instance of unsigned integer
  const statusId = req.query.status ? req.query.status : RequestStatus.completed;
  // let page = req.query.page ? parseInt(req.query.page) : 1;
  // let limit = req.query.limit ? parseInt(req.query.limit) : 10;
  // let offset = limit * (page - 1);

  try {
    WorkflowLog.belongsTo(Request);
    request = await WorkflowLog.findAll({
      // limit: limit,
      // offset: offset,
      where: {
        statusId,
        requestSenderId: customerId,
        requestSenderType: 'user',
      },
      attributes: ['id', 'statusId', 'createdAt'],
      include: [
        {
          model: Form,
          required: true,
          attributes: ['name'],
        },
      ],
      order: [['createdAt', 'DESC']],
    });
  } catch (e) {
    res.status(HTTP.StatusInternalServerError).json({
      status: Status.Failed,
      message: 'Failed to fetch Request.',
      data: null,
    });
  }
  if (request !== null) {
    message = 'Fetched all requests.';
  } else {
    message = 'No requests were found.';
  }
  res.status(HTTP.StatusOk).json({
    status: Status.Success,
    message,
    data: request || null,
  });
};

const getCategoryByRequestId = async (req, res) => {
  const { id } = req.params;
  const result = await db.query(
    `select c.* from requests r join forms f on r.formId = f.id join categories c on c.id = f.categoryId where r.id = ${id};`
  );

  res.status(HTTP.StatusOk).json({
    status: Status.Success,
    message: 'Category fetched',
    data: result[0][0],
  });
};

/**
 * Gets Single Request.
 */
const getSingleRequestById = async (req, res) => {
  const { id } = req.params;
  let request;

  // Fetch the specific form
  Request.belongsTo(Form);
  Form.belongsTo(Category);

  // Fetch Specific Request Values
  Request.hasMany(RequestValue, {
    sourceKey: 'id',
    foreignKey: 'requestId',
  });
  // Fetch Specific WorkFlow logs
  Request.hasMany(WorkflowLog, {
    sourceKey: 'id',
    foreignKey: 'requestId',
  });

  WorkflowLog.hasMany(WorkflowFiles, {
    sourceKey: 'id',
    foreignKey: 'workflowLogId',
  });
  // Fetch the specific Request.
  try {
    request = await Request.findOne({
      where: {
        id,
        isDeleted: false,
      },
      attributes: ['id', 'requestKey', 'statusId', 'customerAccount', 'requestedBranch', 'createdAt'],
      include: [
        {
          model: Form,
          required: true,
          attributes: [
            'name',
            'type',
            'formData',
            'javascript',
            'categoryId',
            'enableFormEdit',
            'enableReSubmit',
            'viewData',
            'viewScript',
          ],
          include: [
            {
              model: Category,
            },
          ],
        },
        {
          model: RequestValue,
          attributes: ['name', 'value'],
          required: false,
        },
        {
          model: WorkflowLog,
          include: [WorkflowFiles],
          attributes: ['id', 'comment', 'requestId', 'groupId', 'nextGroupId', 'currentUserId', 'actionId', 'createdAt'],
          required: false,
          where: {
            [Op.or]: [
              {
                [Op.and]: [{ actionId: 2 }, { nextGroupId: null }],
              },
              {
                [Op.and]: [{ actionId: 1 }, { groupId: null }],
              },
              {
                [Op.and]: [{ actionId: 11 }, { groupId: null }],
              },
            ],
          },
        },
      ],
      order: [['createdAt', 'DESC']],
    });
  } catch (e) {
    res.status(HTTP.StatusForbidden).json({
      status: Status.Failed,
      message: 'Failed to fetch single request.',
      data: null,
    });
  }

  // if no request return 404
  if (request == null) {
    res.status(HTTP.StatusNotFound).json({
      status: Status.Failed,
      message: 'No request was found.',
      data: null,
    });
  } else {
    res.status(HTTP.StatusOk).json({
      status: Status.Success,
      message: 'fetch single request success',
      data: request,
    });
  }
};

/**
 * Get Form and Request value from Request By Auth Id And Key.
 */
const getRequestByAuthIdAndKey = async (req, res) => {
  const { id } = req.params;
  let requestById;
  Request.hasOne(Form, { sourceKey: 'formId', foreignKey: 'id' });
  Request.hasMany(RequestValue, {
    sourceKey: 'id',
    foreignKey: 'requestId',
  });
  try {
    requestById = await Request.findOne({
      where: {
        id,
      },
      attributes: ['id', 'statusId', 'formId', 'customerAccount', 'requestedBranch'],
      include: [
        {
          model: Form,
          attributes: ['id', 'name', 'type', 'formData', 'javascript', 'categoryId'],
          required: true,
        },
        {
          model: RequestValue,
          attributes: ['name', 'value'],
          required: true,
        },
      ],
    });
    // if no form by Id return 404
    if (requestById === null) {
      res.status(HTTP.StatusNotFound).json({
        status: Status.Failed,
        message: 'Request Not found.',
        data: null,
      });
    } else {
      res.status(HTTP.StatusOk).json({
        status: Status.Success,
        message: 'Fetched Request data.',
        data: requestById,
      });
    }
  } catch (e) {
    res.status(HTTP.StatusInternalServerError).json({
      status: Status.Failed,
      message: 'Failed to fetch Request Data.',
      data: null,
    });
  }
};

/**
 * Edit a request
 */
const editRequest = async (req, res) => {
  const requestVal = req.body.requestValues;
  const requestValues = JSON.parse(requestVal);
  const formId = req.body.formId;
  const requestSenderId = req.user.id;
  const requestId = req.body.id;
  let filesList = [];

  if (req.body.fileList) {
    filesList = JSON.parse(req.body.fileList);
  }

  const updateValues = {
    currency: requestValues.find((item) => item.name === 'currency'),
    type_of_guarantee: requestValues.find((item) => item.name === 'type_of_guarantee'),
  };

  const updatedCurrencyValue = updateValues.currency ? updateValues.currency.value : null;
  const updatedGuaranteeType = updateValues.type_of_guarantee ? updateValues.type_of_guarantee.value : null;

  const data = await Request.findOne({
    where: {
      id: req.body.id,
    },
  });

  const id = req.body.id;
  const originalIdentifier = data.dataValues.identifier;
  if (formId == 2 || formId == 4) {
    if (originalIdentifier !== null) {
      let regex;
      if (updatedGuaranteeType.includes('Line of Credit Commitment')) {
        if (updatedCurrencyValue.length == 3) {
          regex = /^(.{6})([A-Z]{3})/;
        } else {
          regex = /^(.{6})([A-Z]{4})/;
        }
      } else {
        if (updatedCurrencyValue.length == 3) {
          regex = /^(.{7})([A-Z]{3})/;
        } else {
          regex = /^(.{7})([A-Z]{4})/;
        }
      }

      const modifiedIdentifier = originalIdentifier.replace(regex, `$1${updatedCurrencyValue}`);

      const identifierQuery = `
          UPDATE requests
            SET identifier = '${modifiedIdentifier}'
          WHERE id = ${id}`;
      await db.query(identifierQuery);

      const referenceNumberQuery = ` UPDATE referenceNumbers
     SET reference_Number='${modifiedIdentifier}'
     WHERE requestId=${id}`;
      await db.query(referenceNumberQuery);

      const subreq = await SubRequest.findOne({
        where: {
          requestId: req.body.id,
        },
      });

      const subReqValuesQuery = `UPDATE sub_request_values
      SET value = '"${modifiedIdentifier}"'
      WHERE (name LIKE '%reference_number%')
      AND subRequestId = ${subreq.dataValues.id}
      `;
      await db.query(subReqValuesQuery);

      const subReqCurrency = `UPDATE sub_request_values
      SET value = '"${updatedCurrencyValue}"'
      WHERE (name LIKE '%currency%')
      AND subRequestId = ${subreq.dataValues.id}`;
      await db.query(subReqCurrency);
    }
  }

  await Request.update(
    {
      statusId: req.body.statusId,
      isDraft: req.body.isDraft,
    },
    {
      where: {
        id: requestId,
        requestSenderId: requestSenderId,
      },
    }
  );

  // await Promise.all([
  //   filesList &&
  //     requestValues.map(async (item) => {
  //       return Promise.all([
  //         RequestValue.update(
  //           {
  //             name: item.name,
  //             value: JSON.stringify(item.value),
  //             label: item.label,
  //           },
  //           {
  //             where: {
  //               requestId: requestId,
  //               name: item.name,
  //             },
  //           }
  //         ),
  //       ]);
  //     }),
  // ]);

  const requestValuesLength = requestValues.length;
  for (let i = 0; i < requestValuesLength; i++) {
    const insertRequestValue = {
      formId: formId,
      requestId: requestId,
      name: requestValues[i].name,
      value: JSON.stringify(requestValues[i].value),
    };
    if (requestValues[i].name.includes('fileupload')) {
      const fileField = filesList.find((x) => x.fieldName === requestValues[i].name);
      if (fileField) {
        const fileInfo = req.files.find((x) => x.fieldname === requestValues[i].name);
        if (fileInfo) {
          insertRequestValue.type = 'file';
          insertRequestValue.label = fileField.label ? fileField.label : requestValues[i].name;
          // const uploadedFileInfo = await uploadToDMS(request.key, [fileInfo]);
          // fileInfo.url = uploadedFileInfo.data[0].url;
          insertRequestValue.value = JSON.stringify(fileInfo);
          await RequestValue.update(
            {
              name: insertRequestValue.name,
              value: insertRequestValue.value,
            },
            {
              where: {
                requestId: insertRequestValue.requestId,
                name: insertRequestValue.name,
              },
            }
          );
        }
      }
    } else {
      insertRequestValue.type = 'text';
      insertRequestValue.label = requestValues[i].label ? requestValues[i].label : requestValues[i].name;
      await RequestValue.update(
        {
          name: insertRequestValue.name,
          value: insertRequestValue.value,
        },
        {
          where: {
            requestId: insertRequestValue.requestId,
            name: insertRequestValue.name,
          },
        }
      );
    }
  }
  const workFlowId = await getWorkFlowId(requestId);
  const workFlowGroups = await getWorkflowGroups(workFlowId, requestId);
  await writeToLog(requestId, actions.Forward, workFlowGroups[0], null, null);
  res.status(200).send({ message: 'Success' });
};
/**
 * Add a record to workflow logs.
 *
 * @param requestId
 * @param actionId
 * @param nextGroupId
 * @param currentUserId
 * @param comment
 * @returns {*}
 */
const writeToLog = (requestId, actionId, nextGroupId, currentUserId, comment) => {
  // add an entry to workflow log
  return WorkflowLog.create({
    requestId,
    groupId: null,
    nextGroupId,
    currentUserId: null,
    actionId,
    comment,
  });
};

/**
 * Gets workflow id from request
 * @param requestId
 * @returns {string|*}
 */
const getWorkFlowId = async (requestId) => {
  return (await db.query(`select top 1 workflowId from workflow_masters where requestId = ${requestId}`))[0][0].workflowId;
};

/**
 * Get all the users in a workflow.
 *
 * @param workflowId
 * @param requestId
 * @returns {Promise<*>}
 */
const getWorkflowUsers = async (workflowId, requestId) => {
  const users = [];
  const records = (
    await db.query(
      `select wm.userId from workflow_masters wm
     join workflow_levels wl on wl.id = wm.workflowLevelId
     where wm.workflowId = ${workflowId} and wm.requestId = ${requestId} order by level`
    )
  )[0];
  await records.forEach((x) => {
    users.push(x.userId);
  });
  return users;
};

const getFileofRequest = async (req, res) => {
  let file;
  const logId = req.params.id;

  WorkflowLog.hasMany(WorkflowFiles, {
    sourceKey: 'id',
    foreignKey: 'workflowLogId',
  });
  try {
    file = await WorkflowLog.findAll({
      where: {
        id: logId,
      },
      attributes: [],
      include: [
        {
          model: WorkflowFiles,
          required: true,
          attributes: ['id', 'originalName', 'mimeType', 'path', 'filename', 'size', 'url'],
        },
      ],
    });
  } catch (e) {
    res.status(HTTP.StatusInternalServerError).json({
      status: Status.Failed,
      message: 'Failed to fetch file.',
      data: null,
    });
  }

  // if no request return 404
  if (file === null) {
    res.status(HTTP.StatusNotFound).json({
      status: Status.Failed,
      message: 'No file was found.',
      data: null,
    });
  }
  res.status(HTTP.StatusOk).json({
    status: Status.Success,
    message: 'file fetch successful',
    data: file,
  });
};

/**
 * Get the groups involved in the workflow ordered by their level.
 *
 * @param workflowId
 * @param requestId
 * @returns {Promise<[]>}
 */
const getWorkflowGroups = async (workflowId, requestId) => {
  const groups = [];
  const records = (
    await db.query(
      `select wm.groupId from workflow_masters wm
     join workflow_levels wl on wl.id = wm.workflowLevelId
     where wm.workflowId = ${workflowId} and wm.requestId = ${requestId} order by level`
    )
  )[0];
  await records.forEach((x) => {
    groups.push(x.groupId);
  });
  return groups;
};

const viewCustomerFile = async (req, res) => {
  let requestValue;
  const { id } = req.params;
  const { filename } = req.params;
  const fileNameInfo = await WorkflowFiles.findOne({
    where: {
      id,
    },
  });
  //  for fetching file name
  if (fileNameInfo) {
    const fileInfo = fileNameInfo;
    requestValue = {
      originalName: fileInfo.originalName,
      filename: fileInfo.filename,
    };
  } else {
    return respond(res, httpStatus.NOT_FOUND, 'File not found');
  }
  // file path
  const filePath = await path.resolve(__dirname, `../../${MULTER_FILE_PATH}/${filename}`);
  if (!filePath) {
    return respond(res, httpStatus.NOT_FOUND, 'File not found');
  }

  // comparing the file name and sending download response

  if (requestValue.filename.includes(filename)) {
    return res.download(filePath, requestValue.originalName);
  }
};

/**
 * Query to fetch the template according to request Id.
 *
 * @param requestId
 * @returns {Promise<*>}
 */
const templateQuery = async (requestId) => {
  return (
    await db.query(`select DISTINCT pt.* from requests r
    join forms f on f.id = r.formId
    join print_temp_forms ptf on f.id = ptf.formId 
    join request_values rv on rv.requestId  = r.id
    join print_temps pt on  
      CASE WHEN f.name LIKE 'BG Form%' THEN 
      (CASE WHEN pt.type = REPLACE((SELECT value FROM request_values rv WHERE name = 'type_of_guarantee' and requestId = ${requestId}), '"', '')
        THEN 
        ptf.printTempId
        ELSE 
        0
        END)
      ELSE
         ptf.printTempId 
      END = pt.id where pt.customerAccess = 1 and r.id = ${requestId};`)
  )[0];
};

/**
 * Print template get by request id
 * @param {*} req
 * @param {*} res
 */
const getPrintRequest = async (req, res) => {
  const requestId = req.params.id;

  //Check BIBINI Request downloadable
  const bibiniDownloadable = await db.query(
    `select * from requests where id = ${requestId} and templateDownloadCount = 1 and formId in (31, 32, 33, 34, 35)`
  );
  const template = bibiniDownloadable[0].length > 0 ? {} : await templateQuery(requestId);
  if (template) {
    return respond(res, HTTP.StatusOk, 'Get print templates', template);
  }
  return respond(res, HTTP.StatusNotFound, 'Error!!');
};

/**
 * Query for retrieving template data
 *
 * @param {*} templateId
 * @returns
 */
const getTemplateData = async (templateId) => {
  return (await db.query(`select * from print_temps where id = ${templateId};`))[0][0];
};

const sanitizeTemplate = (template) => {
  // let temp = template.slice(1, -1);
  if (template) {
    let temp = template.replace(/^"/, '');
    temp = temp.replace(/"$/, '');
    temp = temp.replace(/\\n/gm, '\n');
    return temp;
  } else {
    return '';
  }
};

/**
 * Query to restrieve only request values and export in key value pair
 * @param {*} requestId
 * @returns
 */
const getRequestData = async (requestId) => {
  const result = (
    await db.query(`select rv.* from requests r
  join request_values rv on rv.requestId = r.id where r.id = ${requestId}`)
  )[0];
  const data = {};
  for (let i = 0; i < result.length; i++) {
    if (result[i].value && result[i].value.includes('%')) {
      data[result[i].name] = sanitizeTemplate(result[i].value);
    } else {
      data[result[i].name] = sanitizeTemplate(decodeURI(result[i].value));
    }
  }
  return data;
};

/**
 * Getting sub form details (key value pair with subform id)
 * @param {*} req
 * @param {*} res
 */
const getSubRequestValue = async (requestId) => {
  const result = (
    await db.query(`select subformId, srv.* from sub_requests sr 
    join sub_request_values srv
    on sr.id = srv.subRequestId
    where sr.requestId = ${requestId}
    order by sr.updatedAt asc`)
  )[0];

  const data = {};
  const subData = {};
  for (let i = 0; i < result.length; i++) {
    if (result[i].name.includes('date')) {
      //filtering date to generate LC-Draft formatted date
      let dateValue = sanitizeTemplate(decodeURI(result[i].value));
      let dateformat = {};
      if (dateValue) {
        let now = new Date(dateValue);
        const day = ('0' + now.getDate()).slice(-2);
        const month = ('0' + (now.getMonth() + 1)).slice(-2);
        const year = now.getFullYear().toString().slice(-2);
        let formattedValue = year + month + day;
        dateformat = { default: dateValue, formatted: formattedValue };
      }
      subData[result[i].name] = dateformat;
      data[result[i].subformId] = subData;
    } else {
      if (result[i].value && result[i].value.includes('%')) {
        subData[result[i].name] = sanitizeTemplate(result[i].value);
      } else {
        subData[result[i].name] = sanitizeTemplate(decodeURI(result[i].value));
      }
      data[result[i].subformId] = subData;
    }
  }

  return data;
};

/**
 * Retrieve request initiator details
 * @param {*} req
 * @param {*} res
 */

const getRequestInitiator = async (requestId) => {
  const initiator = (
    await db.query(`select r.requestSenderId, r.requestSenderType from forms f
  join requests r
  on r.formId = f.id
  where r.id = ${requestId}`)
  )[0][0];

  let initiatorDetail = {};
  if (initiator && initiator.requestSenderType == 'customer') {
    const detail = (await db.query(`select * from customers where id = ${initiator.requestSenderId}`))[0][0];
    initiatorDetail = {
      id: detail.id,
      name: detail.accountName,
      email: detail.email,
      phone: detail.mobileNumber,
      account: detail.accountNumber,
    };
  } else if (initiator && initiator.requestSenderType == 'user') {
    const detail = (await db.query(`select * from users where id = ${initiator.requestSenderId}`))[0][0];

    initiatorDetail = {
      id: detail.id,
      name: detail.name,
      email: detail.email,
      phone: '',
      account: '',
    };
  }
  return initiatorDetail;
};

/**
 * Generates a pdf and sends for download.
 *
 * @param {*} name
 * @param {*} request
 * @param {*} template
 * @returns
 */
const generatePdf = async (name, request, template, action) => {
  const fileName = `${name}.pdf`;
  const options = {
    format: 'A4',
    orientation: 'portrait',
  };

  let templateData = template.fields;

  templateData = templateData.toString().replace(/\\n/g, ' ').replace(/\\/g, '') || '';
  templateData = sanitizeTemplate(templateData);
  templateData = decode(templateData, { level: 'html5' });
  Handlebars.registerHelper('ifEquals', function (value, testValue, options) {
    if (value === testValue) {
      return options.fn(this);
    }
    return options.inverse(this);
  });
  if ((template.name == 'MT-700 Expanded' || template.name == 'Approver Log Timeline') && action == 'download') {
    function replaceBR(text) {
      if (typeof text == 'string') {
        return text.replace(/\n/g, '<br/>');
      }
    }
    const changeObject = {
      description_of_good: replaceBR(request?.subform[1]?.description_of_good || ''),
      additional_conditions: replaceBR(request?.subform[1]?.additional_conditions || ''),
      instruction_to_pay: replaceBR(request?.subform[1]?.instruction_to_pay || ''),
      documents_required: replaceBR(request?.subform[1]?.documents_required || ''),
    };
    request = { ...request, subform: { ...request.subform, 1: { ...request.subform[1], ...changeObject } } };
  }
  const temp = Handlebars.compile(sanitizeTemplate(templateData));
  templateData = temp(request);
  if (template.name == 'MT-700 Expanded' || template.name == 'Approver Log Timeline') {
    templateData = templateData.toUpperCase();
  }
  if (action == 'view') {
    return templateData || 'Empty';
  } else if (action == 'download') {
    const document = {
      html: templateData.replace(/\&LT;/g, '<').replace(/\&GT;/g, '>'),
      path: `./temp/${fileName}`,
      data: {},
      type: '',
    };

    const data = await pdf.create(document, options);
    const fileData = {
      file: data.filename,
      filename: fileName,
      originalName: fileName,
      path: fileName,
      mimeType: path.extname(data.filename),
      size: fs.statSync(data.filename).size,
    };
    return fileData;
  }
};

/**
 * Generates a text file.
 *
 * @param name
 * @param request
 * @param template
 * @returns {Promise<{file: string, filename: string}>}
 */
const generateTextFile = async (name, request, template) => {
  const fileName = `${name}.txt`;

  const filePath = path.resolve(__dirname, '../../temp', fileName);
  Handlebars.registerHelper('ifEquals', function (value, testValue, options) {
    if (value === testValue) {
      return options.fn(this);
    }
    return options.inverse(this);
  });
  const temp = Handlebars.compile(sanitizeTemplate(template.fields));

  const data = temp(request);
  try {
    fs.appendFileSync(filePath, data.toUpperCase());
  } catch (e) {
    // TODO: Handle failure gracefully.
  }

  const fileData = { file: filePath, filename: fileName };
  return fileData;
};

/**
 * Returns file data based on export type.
 *
 * @param {*} request
 * @param {*} template
 * @returns
 */
const generateFile = (request, template, action) => {
  switch (template.output) {
    case 'TXT':
      return generateTextFile(uuidv4(), request, template, action);
    default:
      // Generates a pdf by default.
      return generatePdf(uuidv4(), request, template, action);
  }
};

const getFormDetail = async (requestId) => {
  let result = (
    await db.query(`SELECT r.requestKey AS requestId
    ,f.name AS form
    ,f.formData AS formData
    ,f.type AS formType
    ,c.name AS category
    ,r.createdAt AS requestDate
    ,r.requestedBranch AS requestedBranch
    ,r.statusId AS reqStatus
    ,r.updatedAt AS finalDate
  FROM requests r
  JOIN forms f ON f.id = r.formId
  JOIN categories c ON c.id = f.categoryId
  WHERE r.id = ${requestId}`)
  )[0][0];
  let date = new Date(result.requestDate);
  let newDate = date.toISOString().replace(/T/, ' ').replace(/\..+/, '');
  result = { ...result, requestDate: newDate };

  date = new Date(result.finalDate);
  newDate = date.toISOString().replace(/T/, ' ').replace(/\..+/, '');
  result = { ...result, finalDate: newDate };

  return result;
};

/**
 *
 * @param {requestId} req
 * @param {templateId} res
 * @returns preview of request before downloading
 */
const generateRequestDocument = async (req, res) => {
  const { requestId } = req.params;
  const { templateId } = req.params;
  const { action } = req.query;

  const form = await getFormDetail(requestId);
  let formFields;
  // check for formDetails
  if (form.formType === 'dynamic') {
    let formData = JSON.parse(form.formData);
    formData.map((item) => {
      if (item.hasOwnProperty('field_name')) {
        item.field_name = item.field_name.replace(/-/g, '_');
        return true;
      }
      return false;
    });
    formFields = formData;
  }
  const main = await getRequestData(requestId);
  const subrequests = await getSubRequestValue(requestId);
  const initiator = await getRequestInitiator(requestId);
  const log = await getLogDetail(requestId);
  const allRequest = await getRequestDataArray(requestId, formFields);
  const request = {
    main,
    subform: subrequests,
    initiator,
    log,
    form,
    allRequest,
  };
  const template = await getTemplateData(templateId);
  const files = await generateFile(request, template, action);
  if (files && action == 'view') {
    return res.json(files);
  } else if (files && action == 'download') {
    return res.download(files.file, files.filename);
  }
};

const getRequestDataArray = async (requestId, formFields) => {
  const result = (
    await db.query(`select rv.* from requests r
  join request_values rv on rv.requestId = r.id where r.id = ${requestId}`)
  )[0];
  const data = {};
  for (let i = 0; i < result.length; i++) {
    const decodeValue = result[i].value;
    if (result[i].type == 'text') {
      //filter incase of radiobox and checkbox
      if (Array.isArray(JSON.parse(decodeValue))) {
        data[result[i].label] = filterRadioValue(JSON.parse(decodeValue), result[i].name, formFields);
      } else {
        data[result[i].label] = sanitizeTemplate(decodeValue);
      }
    }
    //filter incase of file
    else if (result[i].type == 'file') {
      data[result[i].label] = sanitizeFile(decodeValue);
    }
  }

  let values = [];
  Object.entries(data).forEach((entry) => {
    const [key, value] = entry;
    values.push({ column: key, value: value || '  ' });
  });
  return values;
};

const sanitizeFile = (fileDetails) => {
  let file = JSON.parse(fileDetails);
  return `Filename: ${file.filename}, Size: ${file.size} KB`;
};

const getLogDetail = async (requestId, template) => {
  const log = (
    await db.query(`select wl.* from workflow_logs wl join requests r on r.id = wl.requestId where r.id = ${requestId}`)
  )[0];
  let logDetail = [];
  let action = '';
  for (let i = 0; i < log.length; i++) {
    switch (Number(log[i].actionId)) {
      case actions.Return:
        action = 'Rejected';
        break;
      case actions.Approve:
        action = 'Approved';
        break;
      case actions.Pick:
        action = '';
        if (template === 'Resignation_Report') action = 'Picked';
        break;
      case actions.Reassign:
        action = '';
        if (template === 'Resignation_Report') action = 'Reassigned';
        break;
      case actions.Forward:
        action = '';
        if (template === 'Resignation_Report') action = 'Forward';
        break;
      default:
        action = '';
    }

    if (action != '') {
      let user = (await db.query(`select * from users where id = ${log[i].currentUserId}`))[0][0];
      let group = (await db.query(`select * from groups where id = ${log[i].groupId}`))[0][0];
      let comment = log[i].comment;
      let date = log[i].createdAt;
      const finaldate = new Date(date).toUTCString().split(' ').slice(0, 5).join(' ');
      if (comment != null) {
        comment = comment.replace(/<[^>]+>/g, '').replace(/\n/g, '');
      }
      logDetail.push({ group: group.name, name: user.name, action: action, comment: comment, date: finaldate });
    }
  }
  return logDetail;
};

const voidBibiniRequest = async (req, res) => {
  const checkVoidRequest = await db.query(`SELECT * FROM requests r 
                                            JOIN forms f ON r.formId = f.id and f.name like 'BIBINI%' WHERE r.id = ${req.params.id}  and r.statusId != 6`);
  if (checkVoidRequest[0].length > 0) {
    Request.update({ statusId: 6 }, { where: { id: req.params.id } }).then((res) => {
      WorkflowLog.create({
        requestId: req.params.id,
        groupId: null,
        nextGroupId: null,
        currentUserId: req.user.id,
        actionId: actions.Close,
        comment: null,
      });
    });
    res.status(200).json({ status: true, msg: 'Void bibini successful' });
  } else {
    res.status(404).json({ status: false, msg: 'Bibini request for void not found' });
  }
};

module.exports = {
  store,
  getRequestById,
  all,
  getSingleRequestById,
  getRequestByAuthIdAndKey,
  getCategoryByRequestId,
  editRequest,
  getFileofRequest,
  viewCustomerFile,
  allWorkflowLog,
  getComment,
  getPrintRequest,
  voidBibiniRequest,
  generateRequestDocument,
};
