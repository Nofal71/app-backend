const express = require('express');
require('isomorphic-fetch');
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
const { generateResumeEvaluationPrompt } = require('./../services/screen-prompt');
// const { generatePrompt } = require('./../services/screen-prompt');
const { initGraphClient } = require('../utils/graphclient');


const router = express.Router();

router.get('/get-sites-data', authMiddleware, async (req, res) => {
  try {
    const { siteName, listNames } = req.query;
    const { tenantId } = req;

    if (!siteName) {
      return res.status(400).json({ error: 'Missing Params' });
    }

    const graphClient = await initGraphClient(tenantId);
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
    const { tenantId } = req;

    if (!siteId || !listId) {
      return res.status(400).json({ error: 'Missing siteName or listName' });
    }
    const graphClient = await initGraphClient(tenantId);
    await graphClient.api(`/sites/${siteId}/lists/${listId}/items`).post(payload);
    res.status(200).json({ message: 'Item created successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Graph API failed', detail: error.message });
  }
});

router.patch('/update-item', authMiddleware, async (req, res) => {
  try {
    const { payload, siteId, listId, itemId } = req.body;
    const { tenantId } = req;

    if (!siteId || !listId || !itemId) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const graphClient = await initGraphClient(tenantId);
    await graphClient.api(`/sites/${siteId}/lists/${listId}/items/${itemId}`).patch(payload);
    res.status(200).json({ message: 'Item updated successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Graph API failed', detail: error.message });
  }
});

router.get('/get-item', authMiddleware, async (req, res) => {
  try {
    const { siteId, listId, filter } = req.query;
    const { tenantId } = req;

    if (!siteId || !listId) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }
    const graphClient = await initGraphClient(tenantId);
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
      itemsResult = await graphClient.api(`/sites/${siteId}/lists/${listId}/items?$expand=fields`).get();
    }


    if (!itemsResult.value?.length) {
      return res.status(404).json({ error: 'No matching item found' });
    }
    res.status(200).json({ fields: itemsResult.value });
  } catch (error) {
    res.status(500).json({ error: 'Graph API failed', detail: error.message });
  }
});

router.get('/get-cvs', authMiddleware, async (req, res) => {
  try {
    const { siteId, listId, top = 10, skipToken, tags } = req.query;
    const { tenantId } = req;

    if (!siteId || !listId) {
      return res.status(400).json({ error: 'Missing required parameters: siteId and listId' });
    }

    const topValue = Math.min(Number(top), 100);
    const graphClient = await initGraphClient(tenantId);

    let apiPath = `/sites/${siteId}/lists/${listId}/items?$expand=fields,driveItem&$top=${topValue}`;

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


router.get('/parse-cv', authMiddleware, async (req, res) => {
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

router.get('/screen-cv', authMiddleware, async (req, res) => {
  try {
    const { applied_position, downloadURL, job_description, itemId, technicalSkillGroups } = req.query;

    if (!applied_position || !downloadURL || !job_description) {
      return res.status(400).json({ error: 'Missing required parameters: applied_position, cvString, or job_description' });
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

    if (!extractedText.length > 0) return res.status(500).json({ detail: 'failed to convert CV to text' });


    const system_prompt = generateResumeEvaluationPrompt(job_description, applied_position)
    const openRouterResponse = await axios.post(
      API_URL,
      {
        model: MODEL,
        messages: [
          { role: 'system', content: system_prompt },
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
    console.error('Screening CV Error:', error?.response?.data || error.message);
    return res.status(500).json({ detail: error.message || 'Internal server error' });
  }
});


router.get('/user-reports', authMiddleware, async (req, res) => {
  try {
    const { userMail, siteName, listName, filter } = req.query;
    const { tenantId } = req;

    if (!siteName || !listName || !userMail || !filter) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const graphClient = await initGraphClient(tenantId);

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