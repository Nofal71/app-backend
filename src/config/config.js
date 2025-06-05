require('dotenv').config();

module.exports = {
  clientId: process.env.CLIENT_ID,
  clientSecret: process.env.CLIENT_SECRET,
  authorityHost: process.env.AUTHORITY_HOST
};