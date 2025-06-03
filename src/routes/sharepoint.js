const express = require('express');
const { ClientSecretCredential } = require('@azure/identity');
const { Client } = require('@microsoft/microsoft-graph-client');
require('isomorphic-fetch');
const config = require('../config/config');
const { authMiddleware } = require('../middleware/auth');

const axios = require('axios');
const mammoth = require('mammoth');
const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');

const API_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "google/gemini-2.0-flash-001";
const API_KEY = process.env.OPENROUTER_API_KEY;
const SYSTEM_PROMPT = require('./../services/open-route');


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
    const { siteName, listNames } = req.query;
    if (!siteName) {
      return res.status(400).json({ error: 'Missing Params' });
    }

    const graphClient = await initGraphClient();
    const siteSearch = await graphClient.api(`/sites?search=${siteName}`).get();
    const site = siteSearch.value?.[0];
    if (!site?.id) {
      return res.status(404).json({ error: `Site '${siteName}' not found` });
    }
    let listsData = []

    if (listNames) {
      const parsedLists = JSON.parse(listNames)
      const lists = await graphClient.api(`/sites/${site.id}/lists`).get();
      parsedLists.map(async (e) => {
        const list = lists.value.find(l => l.name.toLowerCase() === e.toLowerCase());
        if (list) listsData.push(list)
      })
    }

    res.status(200).json({ siteData: site, listsData: JSON.stringify(listsData) });
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


router.get('/get-cvs', async (req, res) => {
  try {
    const { siteId, listId, top = 10, skipToken, tags, debug = 'false' } = req.query;

    if (!siteId || !listId) {
      return res.status(400).json({ error: 'Missing required parameters: siteId and listId' });
    }

    const topValue = Math.min(Number(top), 100);
    const graphClient = await initGraphClient();

    let tagArray = [];
    if (tags) {
      try {
        tagArray = Array.isArray(tags) ? tags : JSON.parse(tags || '[]');
      } catch (e) {
        return res.status(400).json({ error: 'Invalid tags format' });
      }
    }

    let apiPath = `/sites/${siteId}/lists/${listId}/items?$expand=fields,driveItem&$top=${topValue}`;

    if (tagArray.length > 0 && debug !== 'true') {
      const tagFilters = tagArray.map(tag => `contains(fields/Tags, '${encodeURIComponent(tag)}')`);
      apiPath += `&$filter=${tagFilters.join(' or ')}`;
    }

    if (skipToken) {
      apiPath += `&$skiptoken=${encodeURIComponent(skipToken)}`;
    }

    let itemsResult = await graphClient.api(apiPath).get();


    if (!itemsResult.value?.length) {
      return res.status(404).json({ error: 'No items found' });
    }

    let nextSkipToken = null;
    if (itemsResult['@odata.nextLink']) {
      const url = new URL(itemsResult['@odata.nextLink']);
      nextSkipToken = url.searchParams.get('$skiptoken');
    }

    res.status(200).json({
      items: itemsResult.value,
      nextSkipToken,
    });
  } catch (error) {
    res.status(500).json({ error: 'Graph API failed', detail: error.message });
  }
});

// router.get('/get-cvs-by-tags', async (req, res) => {
//   try {
//     const { siteId, tagsListId, cvLibraryListId, tags, debug = 'false' } = req.query;
//     if (!siteId || !tagsListId || !cvLibraryListId) {
//       return res.status(400).json({ error: 'Missing required parameters: siteId, tagsListId, cvLibraryListId' });
//     }
//     let tagArray = [];
//     if (tags) {
//       try {
//         tagArray = Array.isArray(tags) ? tags : JSON.parse(tags || '[]');
//       } catch (e) {
//         return res.status(400).json({ error: 'Invalid tags format' });
//       }
//     }
//     const graphClient = await initGraphClient();

//     let filterString = '';
//     if (tagArray.length > 0 && debug !== 'true') {
//       const tagFilters = tagArray.map(tag => `fields/Tag eq '${tag}'`);
//       filterString = `&$filter=${tagFilters.join(' or ')}`;
//     }

//     const tagItems = await graphClient
//       .api(`/sites/${siteId}/lists/${tagsListId}/items?$expand=fields${filterString}`)
//       .header('Prefer', 'HonorNonIndexedQueriesWarningMayFailRandomly')
//       .get();


//     const cvIds = tagItems.value.map(item => item.fields?.CVLookupId).filter(Boolean);

//     if (cvIds.length === 0) {
//       return res.status(200).json({ items: [] });
//     }
//     // Build filter using the field name for lookup (usually fields/Id or fields/ID)
//     // Assuming the lookup field in the CV Library list is 'Id' (the SharePoint item ID)
//     // If your lookup field is different, adjust 'fields/Id' accordingly

//     const cvFilters = cvIds.map(id => `fields/Id eq ${parseInt(id, 10)}`).join(' or ');

//     const cvItems = await graphClient
//       .api(`/sites/${siteId}/lists/${cvLibraryListId}/items?$expand=fields,driveItem`)
//       .filter(cvFilters)
//       .expand('fields')
//       .get();



//     res.status(200).json({
//       items: cvItems.value,
//     });

//   } catch (error) {
//     console.error(error);
//     res.status(500).json({ error: 'Graph API failed', detail: error.message });
//   }
// });


router.get('/get-tags', async (req, res) => {
  try {
    const { siteId, listId } = req.query;
    if (!siteId || !listId) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const graphClient = await initGraphClient();
    const itemsResult = await graphClient
      .api(`/sites/${siteId}/lists/${listId}/items?expand=fields`)
      .get();

    if (!itemsResult.value?.length) {
      return res.status(404).json({ error: 'No tags found' });
    }

    const rawTags = [];

    for (const item of itemsResult.value) {
      const tagsField = item.fields?.Tags;

      if (typeof tagsField === 'string') {
        try {
          const parsed = JSON.parse(tagsField);
          if (Array.isArray(parsed)) {
            rawTags.push(...parsed.map(tag => tag.trim()));
          }
        } catch (err) {
        }
      }
    }

    const uniqueTags = Array.from(new Set(rawTags));

    res.status(200).json({ tags: uniqueTags });
  } catch (error) {
    res.status(500).json({ error: 'Graph API failed', detail: error.message });
  }
});





router.get('/generate-tags', authMiddleware, async (req, res) => {
  try {
    const { downloadURL, itemId } = req.query;
    if (!downloadURL) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const response = await axios.get(downloadURL, {
      responseType: 'arraybuffer',
    });

    const isPDF = downloadURL.toLowerCase().includes('.pdf') || response.headers['content-type'] === 'application/pdf';

    const tempPath = path.join(__dirname, isPDF ? 'temp.pdf' : 'temp.docx');
    fs.writeFileSync(tempPath, response.data);

    let extractedText = '';
    if (isPDF) {
      const dataBuffer = fs.readFileSync(tempPath);
      const pdfData = await pdfParse(dataBuffer);
      extractedText = pdfData.text;
    } else {
      const result = await mammoth.extractRawText({ path: tempPath });
      extractedText = result.value;
    }

    fs.unlinkSync(tempPath);

    const openRouterResponse = await axios.post(
      API_URL,
      {
        model: MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: extractedText }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
        }
      }
    );

    const generatedText = openRouterResponse.data.choices?.[0]?.message?.content || '';
    const cleanedJson = generatedText.replace(/```json|```/g, "").trim();

    return res.status(200).json({ data: JSON.parse(cleanedJson), itemId });

  } catch (error) {
    return res.status(500).json({ detail: error.message || 'Internal server error' });
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
    console.log(JSON.stringify(payload) , 'palyload')
    await graphClient.api(`/sites/${siteId}/lists/${listId}/items/${itemId}`).patch(JSON.stringify(payload));
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
    res.status(500).json({ error: 'Graph API failed', detail: error.message });
  }
});


module.exports = router;