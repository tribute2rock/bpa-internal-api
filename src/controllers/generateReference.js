const httpStatus = require('http-status');
const { respond } = require('../utils/response');
const { ReferenceNumberBibini } = require('../models');
const db = require('../config/database');
const { ref } = require('joi');
// import NepaliDate from 'nepali-date-converter';

// Scheduler to reset reference number generation from 00001
const resetReferenceNumberBibini = async () => {
  await db.query(`
  INSERT INTO referenceNumberbibini 
	        (isDeleted, unique_number, reference_Key, reference_Number, createdAt, updatedAt)
   VALUES 
          (0, 0, 'KA',  'KA-2080/81-000000', getdate(), getdate()),
          (0, 0, 'KHA', 'KHA-2080/81-000000', getdate(), getdate()),
          (0, 0, 'GA',  'GA-2080/81-000000', getdate(), getdate()),
          (0, 0, 'GHA', 'GHA-2080/81-000000',   getdate(), getdate()),
          (0, 0, '4',   'CHAR-2080/81-000000', getdate(), getdate());`);
};

const oldReference = async (gt) => {
  const refNumber = await ReferenceNumberBibini.findOne({ where: { reference_Key: gt }, order: [['id', 'DESC']] });
  //todo match the
  //let today = new Date();
  // let yyyy = today.getFullYear().toString().substr(-2);
  let yyyy = '2080/81';
  if (refNumber && gt) {
    var newRef = '';
    if (gt == '4') {
      newRef = yyyy + '-' + String(parseInt(refNumber.unique_number) + 1).padStart(6, '0');
    } else {
      newRef = gt + '-' + yyyy + '-' + String(parseInt(refNumber.unique_number) + 1).padStart(6, '0');
    }
    await ReferenceNumberBibini.create({
      unique_number: parseInt(refNumber.unique_number) + 1,
      reference_Key: refNumber.reference_Key,
      reference_Number: newRef,
      // requestId: resData.requestId,
    })
      .then((res) => {
        console.log('generateReference.js ==> successful', newRef);
      })
      .catch((err) => {
        console.log('unsuccessful', err);
      });
    return newRef;
  } else {
    return gt + yyyy + '00001';
  }
};

const generateRefNumberBibini = async (req, res) => {
  const resData = req.body;
  const result = await referenceNumber(resData);
  return res.json(result);
};

// const registerRefNumber = async (data) => {
//   // const data = req.body.value;
//   const resData = JSON.parse(data);

//   const result = await referenceNumber(resData, 'create');
//   return result;
// }

const referenceNumber = async (resData) => {
  let reference_Number = '';

  switch (resData.form) {
    case 'BIBINI 4 KA':
      reference_Number = await oldReference('KA');
      break;
    case 'BIBINI 4 KHA':
      reference_Number = await oldReference('KHA');
      break;
    case 'BIBINI 4 GA':
      reference_Number = await oldReference('GA');
      break;
    case 'BIBINI 4 GHA':
      reference_Number = await oldReference('GHA');
      break;
    case 'BIBINI 4':
      reference_Number = await oldReference('');
      break;
    default:
      break;
  }
  if (!reference_Number) {
    return { msg: 'Please generate the reference number.', data: reference_Number };
  }
  return { msg: 'Reference Number generated sucessfully', data: reference_Number };
};

const referenceNumberBackend = async (resData) => {
  let reference_Number = '';

  switch (resData) {
    case 'BIBINI 4 KA':
      reference_Number = await oldReference('KA');
      break;
    case 'BIBINI 4 KHA':
      reference_Number = await oldReference('KHA');
      break;
    case 'BIBINI 4 GA':
      reference_Number = await oldReference('GA');
      break;
    case 'BIBINI 4 GHA':
      reference_Number = await oldReference('GHA');
      break;
    case 'BIBINI 4':
      reference_Number = await oldReference('4');
      break;
    default:
      break;
  }
  if (!reference_Number) {
    return { msg: 'Please generate the reference number.', data: reference_Number };
  }
  return { msg: 'Reference Number generated sucessfully', data: reference_Number };
};

module.exports = {
  generateRefNumberBibini,
  resetReferenceNumberBibini,
  referenceNumberBackend,
};
