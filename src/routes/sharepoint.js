const express = require('express');
const { ClientSecretCredential } = require('@azure/identity');
const { Client } = require('@microsoft/microsoft-graph-client');
require('isomorphic-fetch');
const config = require('../config/config');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

const initGraphClient = async () => {
  const credential = new ClientSecretCredential(config.tenantId, config.clientId, config.clientSecret);
  const token = await credential.getToken('https://graph.microsoft.com/.default');
  return Client.init({
    authProvider: (done) => done(null, token?.token || '')
  });
};

router.post('/create-item', authMiddleware, async (req, res) => {
  try {
    const { payload, siteName, listName } = req.body;
    if (!siteName || !listName) {
      return res.status(400).json({ error: 'Missing siteName or listName' });
    }

    const graphClient = await initGraphClient();
    const siteSearch = await graphClient.api(`/sites?search=${siteName}`).get();
    const site = siteSearch.value?.[0];
    if (!site?.id) {
      return res.status(404).json({ error: `Site '${siteName}' not found` });
    }

    const lists = await graphClient.api(`/sites/${site.id}/lists`).get();
    const list = lists.value.find(l => l.name.toLowerCase() === listName.toLowerCase());
    if (!list?.id) {
      return res.status(404).json({ error: `List '${listName}' not found` });
    }

    await graphClient.api(`/sites/${site.id}/lists/${list.id}/items`).post(payload);
    res.status(200).json({ message: 'Item created successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Graph API failed', detail: error.message });
  }
});

router.post('/get-item', async (req, res) => {
  try {
    const { formattedDate, userMail, siteName, listName } = req.body;
    if (!formattedDate || !userMail || !siteName || !listName) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const graphClient = await initGraphClient();
    const siteResult = await graphClient.api(`/sites?search=${siteName}`).get();
    const site = siteResult.value?.[0];
    if (!site?.id) {
      return res.status(404).json({ error: `Site '${siteName}' not found` });
    }

    const listsResult = await graphClient.api(`/sites/${site.id}/lists`).get();
    const list = listsResult.value.find(l => l.name === listName);
    if (!list?.id) {
      return res.status(404).json({ error: `List '${listName}' not found` });
    }

    const filterQuery = `fields/Email eq '${userMail}' and fields/Date eq '${formattedDate}'`;
    const itemsResult = await graphClient
      .api(`/sites/${site.id}/lists/${list.id}/items`)
      .filter(filterQuery)
      .expand('fields')
      .header('Prefer', 'HonorNonIndexedQueriesWarningMayFailRandomly')
      .get();

    if (!itemsResult.value?.length) {
      return res.status(404).json({ error: 'No matching item found' });
    }

    res.status(200).json({ id: itemsResult.value[0].id, fields: itemsResult.value });
  } catch (error) {
    res.status(500).json({ error: 'Graph API failed', detail: error.message });
  }
});

router.get('/user-roles', async (req, res) => {
  try {
    const graphClient = await initGraphClient();
    const result = await graphClient.api('/sites?search=HROperations').get();
    const site = result.value?.[0];
    if (!site?.id) {
      return res.status(404).json({ error: 'Site HROperations not found' });
    }

    const listsResult = await graphClient.api(`/sites/${site.id}/lists`).get();
    const userRolesList = listsResult.value.find(list => list.name === 'UserRoles');
    if (!userRolesList?.id) {
      return res.status(404).json({ error: 'List UserRoles not found' });
    }

    const itemsResult = await graphClient
      .api(`/sites/${site.id}/lists/${userRolesList.id}/items?expand=fields($select=Email)`)
      .get();

    const emails = itemsResult.value
      .map(item => item.fields?.Email)
      .filter(email => !!email);

    res.status(200).json({ emails });
  } catch (error) {
    res.status(500).json({ error: 'Graph API failed', detail: error.message });
  }
});

router.patch('/update-item', authMiddleware, async (req, res) => {
  try {
    const { payload, siteName, listName, itemId } = req.body;
    if (!siteName || !listName || !itemId) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const graphClient = await initGraphClient();
    const siteSearch = await graphClient.api(`/sites?search=${siteName}`).get();
    const site = siteSearch.value?.[0];
    if (!site?.id) {
      return res.status(404).json({ error: `Site '${siteName}' not found` });
    }

    const lists = await graphClient.api(`/sites/${site.id}/lists`).get();
    const list = lists.value.find(l => l.name.toLowerCase() === listName.toLowerCase());
    if (!list?.id) {
      return res.status(404).json({ error: `List '${listName}' not found` });
    }

    await graphClient.api(`/sites/${site.id}/lists/${list.id}/items/${itemId}`).patch(payload);
    res.status(200).json({ message: 'Item updated successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Graph API failed', detail: error.message });
  }
});

module.exports = router;