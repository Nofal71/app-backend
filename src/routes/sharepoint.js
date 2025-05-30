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

router.get('/get-sites-data', async (req, res) => {
  try {
    const { siteName, userRoles, AttendanceTimeLine } = req.query;
    if (!siteName || !userRoles || !AttendanceTimeLine) {
      return res.status(400).json({ error: 'Missing Params' });
    }

    const graphClient = await initGraphClient();
    const siteSearch = await graphClient.api(`/sites?search=${siteName}`).get();
    const site = siteSearch.value?.[0];
    if (!site?.id) {
      return res.status(404).json({ error: `Site '${siteName}' not found` });
    }

    const lists = await graphClient.api(`/sites/${site.id}/lists`).get();
    const userROLES = lists.value.find(l => l.name.toLowerCase() === userRoles.toLowerCase());
    if (!userROLES?.id) {
      return res.status(404).json({ error: `List '${userRoles}' not found` });
    }

    const AttendanceTimeline = lists.value.find(l => l.name.toLowerCase() === AttendanceTimeLine.toLowerCase());
    if (!AttendanceTimeline?.id) {
      return res.status(404).json({ error: `List '${AttendanceTimeLine}' not found` });
    }

    res.status(200).json({ HR_Operations: site, userROLES, AttendanceTimeline });
  } catch (error) {
    res.status(500).json({ error: 'Graph API failed', detail: error.message });
  }
});

router.post('/create-item', authMiddleware, async (req, res) => {
  try {
    const { payload, siteId, listId } = req.body;
    if (!siteId || !listId) {
      return res.status(400).json({ error: 'Missing siteName or listName' });
    }
    const graphClient = await initGraphClient();
    await graphClient.api(`/sites/${siteId}/lists/${listId}/items`).post(payload);
    res.status(200).json({ message: 'Item created successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Graph API failed', detail: error.message });
  }
});

router.get('/get-item', async (req, res) => {
  try {
    const { siteId, listId, filter } = req.query;
    if (!siteId || !listId) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }
    const graphClient = await initGraphClient();
    let filterQuery = '', itemsResult;

    if (filter) {
      let parsedData = JSON.parse(filter)
      parsedData.map((e, i) => {
        filterQuery = filterQuery + `fields/${e.field} eq '${e.item}'`
        if (i !== parsedData.length - 1) filterQuery = filterQuery + ` and `
      })
      itemsResult = await graphClient
        .api(`/sites/${siteId}/lists/${listId}/items`)
        .filter(filterQuery)
        .expand('fields')
        .header('Prefer', 'HonorNonIndexedQueriesWarningMayFailRandomly')
        .get();
    } else {
      itemsResult = await graphClient.api(`/sites/${siteId}/lists/${listId}/items`).get();
    }


    if (!itemsResult.value?.length) {
      return res.status(404).json({ error: 'No matching item found' });
    }
    res.status(200).json({ fields: itemsResult.value });
  } catch (error) {
    res.status(500).json({ error: 'Graph API failed', detail: error.message });
  }
});


router.get('/paginateData/:siteName/:listName', async (req, res) => {
  try {
    const { siteName, listName } = req.params;
    const { pageSize = 10, pageToken = null, email, date } = req.query;

    const graphClient = await initGraphClient();

    const siteResult = await graphClient.api(`/sites?search=${siteName}`).get();
    const site = siteResult.value?.[0];
    if (!site?.id) return res.status(404).json({ error: `Site '${siteName}' not found` });

    const listsResult = await graphClient.api(`/sites/${site.id}/lists`).get();
    const list = listsResult.value.find(l => l.name.toLowerCase() === listName.toLowerCase());
    if (!list?.id) return res.status(404).json({ error: `List '${listName}' not found` });

    let request = graphClient
      .api(`/sites/${site.id}/lists/${list.id}/items`)
      .expand('fields')
      .top(Number(pageSize));

    if (pageToken) request = request.header('skiptoken', pageToken);

    const result = await request.get();
    let items = result.value;

    items = items.filter(item => {
      const fields = item.fields || {};
      const matchEmail = email ? fields.Email?.toLowerCase() === email.toLowerCase() : true;
      const matchDate = date ? fields.Date?.split('T')[0] === date : true;
      return matchEmail && matchDate;
    });



    const uniqueEmails = [...new Set(items.map(i => i.fields?.Email).filter(Boolean))];

    res.status(200).json({
      items,
      nextLink: result['@odata.nextLink'] || null,
      uniqueEmails,
    });
  } catch (error) {
    res.status(500).json({ error: 'Pagination failed', detail: error.message });
  }
});

router.patch('/update-item', authMiddleware, async (req, res) => {
  try {
    const { payload, siteId, listId, itemId } = req.body;
    if (!siteId || !listId || !itemId) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const graphClient = await initGraphClient();
    await graphClient.api(`/sites/${siteId}/lists/${listId}/items/${itemId}`).patch(payload);
    res.status(200).json({ message: 'Item updated successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Graph API failed', detail: error.message });
  }
});


router.get('/user-reports', authMiddleware, async (req, res) => {
  try {
    const { userMail, siteName, listName, filter } = req.query;

    if (!siteName || !listName || !userMail || !filter) {
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

    const parsedFilters = JSON.parse(filter);

    const hasMonth = !!parsedFilters.month;
    const hasDateRange = parsedFilters.startDate && parsedFilters.endDate;

    if (hasMonth && hasDateRange) {
      return res.status(400).json({ error: "Cannot use both 'month' and 'startDate/endDate' filters simultaneously." });
    }

    const items = await graphClient
      .api(`/sites/${site.id}/lists/${list.id}/items`)
      .filter(`fields/Email eq '${userMail}' and fields/Date ge '${parsedFilters.startDate}' and fields/Date lt '${parsedFilters.endDate}'`).expand('fields')
      .header('Prefer', 'HonorNonIndexedQueriesWarningMayFailRandomly')
      .get();


    return res.status(200).json({ success: true, data: items });

  } catch (error) {
    console.error('Graph API Error:', error);
    res.status(500).json({ error: 'Graph API failed', detail: error.message });
  }
});


module.exports = router;