require('dotenv').config();

module.exports = {
  tenantId: process.env.TENANT_ID,
  clientId: process.env.CLIENT_ID,
  clientSecret: process.env.CLIENT_SECRET,
  authorityHost: process.env.AUTHORITY_HOST
};