const express = require('express');
const { OnBehalfOfUserCredential } = require('@microsoft/teamsfx');
const { TokenCredentialAuthenticationProvider } = require('@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials');
const { Client } = require('@microsoft/microsoft-graph-client');
const config = require('../config/config');
const jwt = require('jsonwebtoken');

const router = express.Router();

router.get('/user-profile', async (req, res) => {
  const accessToken = req.headers.authorization?.replace('Bearer ', '').trim();
  if (!accessToken) {
    return res.status(400).json({ error: 'No access token found in request header' });
  }
  const decoded = jwt.decode(accessToken);
  
  if (!decoded || !decoded.tid) {
    return res.status(400).json({ error: 'Tenant ID not found in token' });
  }

  const tenantId = decoded.tid;

  const oboAuthConfig = {
    authorityHost: config.authorityHost,
    clientId: config.clientId,
    tenantId: tenantId,
    clientSecret: config.clientSecret
  };

  try {
    const oboCredential = new OnBehalfOfUserCredential(accessToken, oboAuthConfig);
    const userInfo = await oboCredential.getUserInfo();
    
    const authProvider = new TokenCredentialAuthenticationProvider(oboCredential, {
      scopes: ['https://graph.microsoft.com/.default']
    });

    const graphClient = Client.initWithMiddleware({ authProvider });
    const profile = await graphClient.api('/me').get();

    res.status(200).json({
      userInfoMessage: userInfo.displayName ? `User display name is ${userInfo.displayName}` : 'No user information found',
      graphClientMessage: profile
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve user profile', detail: error.message });
  }
});

module.exports = router;