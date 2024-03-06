const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const { Request, RequestValue, LC } = require('../models');
const uploadUrlToDMS = process.env.UPLOAD_URL_TO_DMS;

const uploadToDMS = async (requestKey, files) => {
  const url = uploadUrlToDMS;
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

module.exports.createRequest = async (formId, formName, request, requestValues, fileList, requestFiles) => {
  const createdRequest = await Request.create(request);
  const requestValuesLength = requestValues.length;
  //Updating Branch in case of BIBINI
  let requestIdentificationBranch = requestValues.filter((value) => {
    if (value.name.includes('requestedBranchSol_')) {
      return value;
    }
  });
  if (requestIdentificationBranch.length > 0 && requestIdentificationBranch[0].value) {
    Request.update({ requestedBranch: requestIdentificationBranch[0].value }, { where: { id: createdRequest.id } });
  }
  //Updating Reference number in case of BIBINI
  let requestIdentificationNumber = requestValues.filter((value) => {
    if (value.name.includes('requestIdentifier_')) {
      return value;
    }
  });
  if (requestIdentificationNumber.length > 0 && requestIdentificationNumber[0].value) {
    Request.update({ identifier: requestIdentificationNumber[0].value }, { where: { id: createdRequest.id } });
  }

  // restructure files for request
  let result = {};
  requestFiles.map((file) => {
    if (file.fieldname)
      result = { ...result, [file.fieldname]: file.fieldname in result ? [...result?.[file.fieldname], file] : [file] };
  });

  for (let i = 0; i < requestValuesLength; i++) {
    const insertRequestValue = {
      formId,
      requestId: createdRequest.id,
      // name: requestValues[i].name,
      value: JSON.stringify(requestValues[i].value),
    };

    if (requestValues[i].name.includes('fileupload')) {
      const fileField = fileList.find((x) => x.fieldName === requestValues[i].name);
      if (fileField) {
        Promise.all(
          Object.entries(result).map(async ([key, files]) => {
            // requestFiles.map(async (file, index) => {
            files.map(async (file, index) => {
              const fileInfo = files.find((x) => x.fieldname === requestValues[i].name);

              if (fileInfo) {
                // Create multiple request files.
                insertRequestValue.type = 'file';
                insertRequestValue.name = requestValues[i].name;
                insertRequestValue.label = fileField.label ? fileField.label : requestValues[i].name;
                // const uploadedFileInfo = await uploadToDMS(createdRequest.requestKey, [fileInfo]);
                // fileInfo.url = uploadedFileInfo.data[0].url;
                insertRequestValue.value = JSON.stringify(files[index]);

                return await RequestValue.create(insertRequestValue);
              }
            });
          })
          // })
        );
      }
    } else {
      insertRequestValue.type = 'text';
      insertRequestValue.name = requestValues[i].name;
      insertRequestValue.label = requestValues[i].label ? requestValues[i].label : requestValues[i].name;
      insertRequestValue.labelOrder = requestValues[i].labelOrder ? requestValues[i].labelOrder : null;
      await RequestValue.create(insertRequestValue);
    }
  }
  return createdRequest;
};
