const axios = require('axios');
const { HTTP, Status } = require('../constants/response');
const user = require('../models/user');
const redis = require('../config/redis');
const cryptoRandomString = require('crypto-random-string');
const ChannelManagerUrl = process.env.CHANNEL_MANAGER_URL;
const { promisify } = require('util');
const branchesUrl = process.env.BRANCH_URL;
const { status: RequestStatus, actions } = require('../constants/request');
const { Encrypt, HmacSHAEncryptURL } = require('../controllers/encryption');
const { log } = require('console');

const authToken = async (usrname, pwd, req) => {
  const channelMgrEncryptURL = await HmacSHAEncryptURL(usrname, pwd, process.env.CHANNEL_MANAGER_URL);
  const string = `${JSON.stringify({ Username: usrname, Password: pwd })}`;
  const encyptRes = await Encrypt(string);
  // const username = `username=${usrname ? usrname : 'kisko'}&`;
  // const password = `password=${pwd ? pwd : 'kisko'}`;
  try {
    const response = await axios.post(
      'http://192.168.214.74:60064/api/JwtToken/GetToken',
      {
        PAYLOAD: `${encyptRes}`,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          AuthKey: `${channelMgrEncryptURL}`,
        },
      }
    );
    let token = `${response.data}`;
    return token;
    return res.json({ msg: 'success', token: token });
  } catch (e) {
    console.log(e);
  }
};

const redisToken = async (accNo) => {
  const redisGet = promisify(redis.get).bind(redis);
  let value = await redisGet(`CuInfo${accNo}`);

  if (!value) {
    return false;
  } else {
    return value;
  }
};

const customerAuthCBS = async (accountNumber, mobileNumber) => {
  const CbsUrl = `http://192.168.214.74:60064/api/CustomerInquiry/CustomerInquiryRequest`;
  // const CbsUrl = `http://192.168.214.74:60064/api/CustomerMobileBankingValidation/MobileBankingValidationRequest`
  const channelMgrEncryptURL = await HmacSHAEncryptURL('kiosk', 'kiosk', CbsUrl);
  const toEncrypt = `{"opracc":"${accountNumber}"}`;
  str = toEncrypt.replace(/\\/g, '');
  const encyptRes = await Encrypt(str);

  const authtoken = await authToken('kiosk', 'kiosk');
  try {
    const response = await axios.post(
      CbsUrl,
      {
        PAYLOAD: `${encyptRes}`,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          AuthKey: `${channelMgrEncryptURL}`,
          Authorization: `Bearer ${authtoken}`,
        },
      }
    );
    const finalRes = response.data.data;
    const parseResponse = JSON.parse(finalRes);

    if (parseResponse) {
      const obj = {
        accountNumber: parseResponse.data.accountNo ? parseResponse.data.accountNo : null,
        fullName: parseResponse.data.fullName ? parseResponse.data.fullName : null,
        firstName: parseResponse.data.firstName ? parseResponse.data.firstName : null,
        middleName: parseResponse.data.middleName ? parseResponse.data.middleName : null,
        lastName: parseResponse.data.lastName ? parseResponse.data.lastName : null,
        gender: parseResponse.data.gender ? parseResponse.data.gender : null,
        salutation: parseResponse.data.salutation ? parseResponse.data.salutation : null,
        city: parseResponse.data.city ? parseResponse.data.city : null,
        country: parseResponse.data.country ? parseResponse.data.country : null,
        countryCode: parseResponse.data.countryCode ? parseResponse.data.countryCode : null,
        dob: parseResponse.data.dob ? parseResponse.data.dob : null,
        mobileNumber: parseResponse.data.mobileNo ? parseResponse.data.mobileNo : null,
        email: parseResponse.data.email ? parseResponse.data.email : null,
        address: parseResponse.data.address ? parseResponse.data.address : null,
        citizenshipNo: parseResponse.data.citizenshipNo ? parseResponse.data.citizenshipNo : null,
        chargeProfile: parseResponse.data.chargeProfile ? parseResponse.data.chargeProfile : null,
        branchSol: parseResponse.data.primarySolId ? parseResponse.data.primarySolId : null,
        productType: 'R2',
      };
      const response = await verifyMobileBanking(obj, mobileNumber);
      // const accNo = obj.accountNumber;
      // const customerInfo = JSON.stringify(obj);
      // const key = `CuInfo${accNo}`;
      // await redis.set(key, customerInfo);
      // return {
      //   status: true,
      //   data: parseResponse.data,
      // };
      return response;
    }
  } catch (error) {
    return {
      status: false,
      error,
    };
  }
};

const verifyMobileBanking = async (user, mobileNumber) => {
  const account = user.accountNumber;
  const mobile = mobileNumber;
  const name = user.fullName;

  const MbUrl = `http://192.168.214.74:60064/api/CustomerMobileBankingValidation/MobileBankingValidationRequest`;
  const channelMgrEncryptURL = await HmacSHAEncryptURL('kiosk', 'kiosk', MbUrl);
  const randomText = cryptoRandomString(8);
  const toEncrypt = `{"AccountNumber":"${account}", "MobileNumber":"${mobile}", "AccountName":"${name}", "TransactionId":"${randomText}"}`;
  str = toEncrypt.replace(/\\/g, '');
  const encyptRes = await Encrypt(str);

  const authtoken = await authToken('kiosk', 'kiosk');
  const response = await axios.post(
    MbUrl,
    {
      PAYLOAD: `${encyptRes}`,
    },
    {
      headers: {
        'Content-Type': 'application/json',
        AuthKey: `${channelMgrEncryptURL}`,
        Authorization: `Bearer ${authtoken}`,
      },
    }
  );
  if (response.data.CBSNameMatch == 100 && response.data.CBSMobileMatch == 100) {
    const customerInfo = JSON.stringify(user);
    const key = `CuInfo${account}`;
    await redis.set(key, customerInfo);
    return {
      status: true,
      data: user,
    };
  } else {
    console.log('Mobile banking validation failed');
    return {
      status: false,
    };
  }
};

const branches = async (req, res) => {
  const authtoken = await authToken('kiosk', 'kiosk');
  const channelMgrEncryptURL = await HmacSHAEncryptURL('kiosk', 'kiosk', branchesUrl);
  // console.log(authtoken);
  // console.log(channelMgrEncryptURL);
  // const toEncrypt = `{"opracc":"${accountNumber}"}`;
  // str = toEncrypt.replace(/\\/g, '');
  // const encyptRes=await Encrypt(str);
  try {
    const response = await axios.post(
      branchesUrl,
      {},
      {
        headers: {
          'Content-Type': 'application/json',
          AuthKey: `${channelMgrEncryptURL}`,
          Authorization: `Bearer ${authtoken}`,
        },
      }
    );

    const branchJson = response.data.data;
    const obje = JSON.parse(branchJson);

    const items = [];
    for (let i = 0; i < obje.data.length; i++) {
      const item = {
        text: obje.data[i].name,
        value: obje.data[i].code,
      };
      items.push(item);
    }
    return res.send(items);
  } catch (e) {
    // console.log(e);
    return res.send([]);
  }
};

const postToCCMS = async (req, res) => {
  let finalData;
  const acNo = req.user.accountNumber;
  const customerinfo = await redisToken(acNo);
  const ccmsUrl = req.body.ccmsUrl;
  const authtoken = await authToken('kiosk', 'kiosk');
  const formName = req.body.formName;
  const channelMgrEncryptURL = await HmacSHAEncryptURL('kiosk', 'kiosk', ccmsUrl);

  const customerRequestToCcms = JSON.parse(customerinfo);
  const formValue = JSON.parse(req.body.requestValues);
  const newArray = formValue.map((item, index) => {
    return { [`${item.name}`]: item.value };
  });
  let reqValues = newArray.reduce((r, c) => Object.assign(r, c), {});
  // const address= customerRequestToCcms.address.replace(/,/g, ' ');
  const chargeProfile = parseInt(customerRequestToCcms.chargeProfile);
  const pinopt = reqValues.pinOption;

  if (customerinfo && reqValues) {
    switch (ccmsUrl) {
      case 'http://192.168.214.74:60064/api/NewDebitCardRequest/DebitCardRequest':
        console.log('I own a New Debit card');
        obj = {
          accountNumber: customerRequestToCcms.accountNumber || '',
          firstName: customerRequestToCcms.firstName || '',
          city: customerRequestToCcms.city || '',
          lastName: customerRequestToCcms.lastName || '',
          middleName: customerRequestToCcms.middleName || '',
          mobileNumber: customerRequestToCcms.countryCode + customerRequestToCcms.mobileNumber || '',
          gender: customerRequestToCcms.gender || '',
          salutation: customerRequestToCcms.salutation || '',
          country: customerRequestToCcms.country || '',
          dob: customerRequestToCcms.dob || '',
          email: customerRequestToCcms.email || '',
          address: customerRequestToCcms.city || '',
          citizenshipNo: customerRequestToCcms.citizenshipNo || '',
          chargeProfile: chargeProfile || '',
          productType: customerRequestToCcms.productType || '',
          collectFromBranch: reqValues.collectFromBranch || '',
          cardType: reqValues.cardType || '',
          pinOption: pinopt[0] || '',
          phoneNo: customerRequestToCcms.mobileNumber || '',
        };
        finalData = obj;
        break;
      case 'http://192.168.214.74:60064/api/DebitCardRepin/DebitCardRepinRequest':
        console.log('I own a Repin Entry');
        obj = {
          identifier: customerRequestToCcms.accountNumber || '',
          collectFromBranch: reqValues.collectFromBranch || '',
          pinOptions: pinopt[0] || '',
          mobileNo: customerRequestToCcms.countryCode + customerRequestToCcms.mobileNumber || '',
          chargeProfile: chargeProfile || '',
        };
        finalData = obj;
        break;
      case 'http://192.168.214.74:60064/api/DebitCardReplace/DebitCardReplaceRequest':
        console.log('I own a Debit Card Re-issue');
        obj = {
          identifier: customerRequestToCcms.accountNumber || '',
          mobileNo: customerRequestToCcms?.countryCode + customerRequestToCcms?.mobileNumber || '',
          collectFromBranch: reqValues.collectFromBranch || '',
          cardType: reqValues.cardType || '',
          pinOptions: pinopt[0] || '',
          replaceRemarks: reqValues.replaceRemarks || '',
          chargeProfile: chargeProfile || '',
        };
        finalData = obj;
        break;
      case 'http://192.168.214.74:60064/api/DebitCardBlock/DebitCardBlockRequest':
        console.log('I own a Block Debit Card');
        obj = {
          identifier: customerRequestToCcms.accountNumber || '',
          blockType: reqValues.blockType || '',
          blockReason: reqValues.blockReason || '',
        };
        finalData = obj;
        break;
      case 'http://192.168.214.74:60064/api/DebitCardUnblock/DebitCardUnblockRequest':
        console.log('I own a Unblock Debit Card');
        obj = {
          identifier: customerRequestToCcms.accountNumber || '',
          unblockReason: reqValues.unblockReason || '',
        };
        finalData = obj;
        break;
      default:
        console.log("I don't own a any Reqest");
        break;
    }
  }

  const encryptData = finalData;
  var myJSON = JSON.stringify(finalData);
  // const heraferi=`"${myJSON}"`;
  console.log(myJSON);
  // const asdf=JSON.parse(heraferi)
  // const toEncrypt = `{"opracc":"${accountNumber}"}`;
  str = myJSON.replace(/\\/g, '');
  // console.log(str,"strs");
  // const encyptRes = await Encrypt(str);

  const encryptedDataToCCMS = await Encrypt(str);
  // console.log(encryptedDataToCCMS,"PAYLOAD");
  try {
    // if(finalData){
    const response = await axios.post(
      ccmsUrl,
      {
        PAYLOAD: `${encryptedDataToCCMS}`,
      },
      {
        headers: {
          // AccessToken: `Bearer ${authtoken}`,
          'Content-Type': 'application/json',
          AuthKey: `${channelMgrEncryptURL}`,
          Authorization: `Bearer ${authtoken}`,
        },
      }
    );
    // }
    const resdata = response.data.data;
    console.log(response);
    const resposeData = JSON.parse(resdata);
    if (resposeData.code == 0) {
      res.json({
        status: Status.Success,
        message: resposeData.message,
        data: resposeData.data,
      });
    } else if (resposeData.code == -1) {
      res.json({
        status: Status.Failed,
        message: resposeData.message,
        data: resposeData.data,
      });
    } else {
      return {
        status: true,
        data: resposeData,
      };
    }
  } catch (error) {
    res.json({
      status: Status.Failed,
      message: 'Failed to submit request.',
      error,
    });
  }
};
// const statusFromCCMS = async (req, res) => {
//   // const statusId = req.query.status ? req.query.status : RequestStatus.completed;
//   const status = req?.query?.status;
//   let result;
//   switch (status) {
//     case '1':
//       result = 'Requested';
//       break;
//     case '2':
//       result = 'Card Delivery';
//       break;
//     case '3':
//       result = 'Activated';
//       break;
//     default:
//       result = 'Card Delivery';
//       break;
//   }
//   const acNo = req.user.accountNumber;
//   try {
//     const ccmsUrl = 'http://192.168.214.74:60064/api/CustomerCardStatus/CustomerCardStatusRequest';
//     const authtoken = await authToken('kiosk', 'kiosk');
//     const channelMgrEncryptURL = await HmacSHAEncryptURL('kiosk', 'kiosk', ccmsUrl);

//     const identifier = { identifier: acNo };
//     const json=JSON.stringify(identifier);
//     str = identifier.replace(/\\/g, '');
//     // console.log(str,"str");
//     // const encyptRes = await Encrypt(str);
//     const encryptedDataToCCMS = await Encrypt(encyptRes);
//     const response = await axios.post(
//       ccmsUrl,
//       {
//         PAYLOAD: `${encryptedDataToCCMS}`,
//       },
//       {
//         headers: {
//           // AccessToken: `Bearer ${authtoken}`,
//           'Content-Type': 'application/json',
//           AuthKey: `${channelMgrEncryptURL}`,
//           Authorization: `Bearer ${authtoken}`,
//         },
//       }
//     );
//     if (response.data.code == 0) {
//       if (result) {
//         let datatoreact;
//         const filteredData = response.data.data.debit.requestedCards.filter(
//           (value) => (datatoreact = value.status == result)
//         );
//         // console.log(filteredData,"data", result,response.data.data.debit.requestedCards);

//         if (filteredData) {
//           res.json({
//             status: Status.Success,
//             message: response.data.message,
//             data: filteredData,
//           });
//         }
//       }
//     }
//   } catch (error) {
//     res.json({
//       status: Status.Failed,
//       message: 'Failed to get CCMS data.',
//       error,
//     });
//   }
// };

const statusCountFromCCMS = async (req, res) => {
  const acNo = req;
  try {
    const ccmsUrl = 'http://192.168.214.74:60064/api/CustomerCardStatus/CustomerCardStatusRequest';
    const authtoken = await authToken('kiosk', 'kiosk');
    const channelMgrEncryptURL = await HmacSHAEncryptURL('kiosk', 'kiosk', ccmsUrl);

    const identifier = { identifier: acNo };
    const json = JSON.stringify(identifier);
    str = json.replace(/\\/g, '');
    // console.log(identifier,"identifier");
    // const xyz={"identifier": "0107010005037"};
    const encryptedDataToCCMS = await Encrypt(str);

    var data = JSON.stringify({
      payload: `${encryptedDataToCCMS}`,
    });

    var config = {
      method: 'get',
      url: ccmsUrl,
      headers: {
        AuthKey: `${channelMgrEncryptURL}`,
        Authorization: `Bearer ${authtoken}`,
        'Content-Type': 'application/json',
      },
      data: data,
    };

    const response = await axios(config)
      .then(function (response) {
        // console.log(JSON.stringify(response.data));
        return response;
      })
      .catch(function (error) {
        console.log(error);
      });

    // const options = {
    //   method: 'GET',
    //   headers: { 'content-type': 'application/x-www-form-urlencoded', 'AuthKey': `${channelMgrEncryptURL}`,
    //   'Authorization': `Bearer ${authtoken}`, },
    //   data:  {
    //     PAYLOAD: `${encryptedDataToCCMS}`,
    //   },
    //   url:ccmsUrl,
    // };
    // const response = await  axios(options);

    // const response = await axios.get(
    //   ccmsUrl,
    //   {
    //     PAYLOAD: `${encryptedDataToCCMS}`,
    //   },
    //   {
    //     headers: {
    //       'Content-Type': 'application/json',
    //       AuthKey: `${channelMgrEncryptURL}`,
    //       Authorization: `Bearer ${authtoken}`,
    //     },
    //   }
    //   );
    // const parseResponse=JSON.parse(response);
    // const getParse =JSON.parse(parseResponse);

    if (response.data.code == 0) {
      // console.log("dssd",response.data.data.debit.requestedCards);
      return response;
      //  return res.json({
      //   status: Status.Success,
      //   message: parseResponse.data.message,
      //   data: response.data.data.debit.requestedCards,
      // });
    }
  } catch (error) {
    // return error
    // console.log("===",error.message,error.config,"kjkj");
    // res.json({
    //   status: Status.Failed,
    //   message: 'Failed to get CCMS data.',
    //   error,
    // });
  }
};

module.exports = {
  authToken,
  redisToken,
  customerAuthCBS,
  branches,
  postToCCMS,
  // statusFromCCMS,
  statusCountFromCCMS,
};
