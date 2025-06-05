const { ClientSecretCredential } = require('@azure/identity');
const { Client } = require('@microsoft/microsoft-graph-client');
const config = require('./../config/config');

const initGraphClient = async (tenantId) => {
    const credential = new ClientSecretCredential(tenantId, config.clientId, config.clientSecret);
    const token = await credential.getToken('https://graph.microsoft.com/.default');
    return Client.init({
        authProvider: (done) => done(null, token?.token || ''),
    });
};

module.exports = { initGraphClient };