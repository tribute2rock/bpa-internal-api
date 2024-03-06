const { Form, Request, Category , FormGroup,GroupUser } = require('../models');
const { HTTP, Status } = require('../constants/response');
const db = require('../config/database');
const category = require('../models/category');
// const { authToken } = require('../controllers/channelManager');
const { Op } = require('@sequelize/core');

/**
 * Get all the  forms available.
 */

const getForms = async (req, res) => {
  try {
    Form.findAll({
      where: {
        isDeleted: false,
        [Op.or]: [{ availableFor: 'Internal' }, { availableFor: 'both' }],
      },
    }).then((forms) => {
      res.status(HTTP.StatusOk).json({
        status: Status.Success,
        message: 'Successfully fetch all forms.',
        data: forms,
      });
    });
  } catch (e) {
    res.status(HTTP.StatusInternalServerError).json({
      status: Status.Failed,
      message: 'Failed to fetch form.',
      data: null,
    });
  }
};

/**
 * Get single form By id.
 */
const getFormsById = async (req, res) => {
  const id = req.params.id;
  const requestSenderId = req.user.id;
  const requestSenderType = 'Internal';
  const forms = await Form.findOne({
    where: { id: id, isDeleted: false },
  });

  const limitType = forms.limitType;
  const limitValues = forms.limitValues;

  const repetedRequest = await Request.findAndCountAll({
    where: { formId: id, isDeleted: false, requestSenderId: requestSenderId, requestSenderType: 'Internal' },
    attributes: ['statusId'],
  });
  const requestStatus = repetedRequest?.rows[0]?.dataValues?.statusId || 0;
  const requestCount = repetedRequest.count;

  if (limitType === 1) {
    res.json({ success: false, data: forms });
  } else if (limitType === 2 && requestCount && limitValues > requestCount) {
    res.json({ success: false, data: forms });
  } else if ((limitType === 3 && requestStatus == 1) || requestStatus == 2 || requestStatus == 3) {
    res.json({
      success: false,
      data: forms,
      message: 'Cannot fill the form unless your previous form request is completed.',
    });
  } else if ((limitType === 3 && requestStatus == 4) || requestStatus == 0) {
    res.json({ success: false, data: forms });
  } else {
    // res.status(500);
    res.json({ success: false, data: forms, message: 'Form Limit has been crossed. Please contact Support.' });
  }
};

const getFormsByCatId = async (req, res) => {
  
  let Id = req.params.catid;
  let FormData;
  let FormById;
  let catName;
  //Fetch all form data.
  try {
    FormData = await Form.findAll({
      where: {
        isDeleted: false,
        [Op.or]: [{ availableFor: 'Internal' }, { availableFor: 'both' }],
      },
    });

    catName = await Category.findOne({ where: { id: Id, isDeleted: false }, attributes: ['name'] });
   
  } catch (e) {

    res.status(HTTP.StatusInternalServerError).json({
      status: Status.Failed,
      message: 'Failed to fetch form.',
      data: null,
    });
  }

  // if no form return 404
  if (FormData === null) {
    res.status(HTTP.StatusNotFound).json({
      status: Status.Failed,
      message: 'No form was found.',
      data: null,
    });
  }

  // get the form by category id
  try {
    const query = `select distinct f.* from forms f
    where f.categoryId = ${Id} and f.isDeleted = 0 and (f.availableFor in ('Internal', 'both'))
  `

    
    FormById =  await db.query(query);
  } catch (e) {
    res.status(HTTP.StatusInternalServerError).json({
      status: Status.Failed,
      message: 'Failed to fetch form by id.',
      data: null,
    });
  }
  // if no form by Id return 404
  if (FormById === null) {
    res.status(HTTP.StatusNotFound).json({
      status: Status.Failed,
      message: 'Form Not found.',
      data: null,
    });
  }

  res.status(HTTP.StatusOk).json({
    status: Status.Success,
    message: 'Fetched form data.',
    data: {
      formdata: FormData,
      formid: FormById[0],
      catName: catName,
    },
  });
};

const searchField = async (req, res) => {
  const { categoryId } = req.params;
  const { query } = req.query;
  const search = await db.query(
    `select * from forms where name like '%${query}%' and availableFor in ('Internal', 'Both') and isDeleted = 0 and categoryId = ${categoryId}`
  );
  res.send(search[0]);
};

module.exports = {
  getForms,
  getFormsByCatId,
  getFormsById,
  searchField,
};
