const axios = require('axios');
const { sap } = require('../config/env');

let cookie;
async function ensureLogin() {
  if (cookie) return;
  const { headers } = await axios.post(`${sap.baseUrl}/Login`, {
    CompanyDB: sap.companyDb, UserName: sap.user, Password: sap.password
  }, { timeout: sap.timeout, withCredentials: true });
  cookie = headers['set-cookie']?.join('; ');
}
async function post(path, body) {
  await ensureLogin();
  const { data } = await axios.post(`${sap.baseUrl}${path}`, body, { headers: { Cookie: cookie }, timeout: sap.timeout });
  return data;
}

module.exports = { ensureLogin, post };
