import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import multer from 'multer';
import OpenAI from 'openai';
import { read, utils } from 'xlsx';
import { v4 as uuidv4 } from 'uuid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const port = process.env.PORT || 3100;
const openAiModel = process.env.OPENAI_MODEL || 'gpt-4.1';
const systemPromptPath = path.resolve(__dirname, '../prompts/forecast-finding-system.md');
const findingJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['item', 'monthYear', 'considerations', 'recommendations'],
  properties: {
    item: { type: 'string' },
    monthYear: { type: 'string' },
    considerations: {
      type: 'array',
      minItems: 1,
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['description', 'impact'],
        properties: {
          description: { type: 'string' },
          impact: { type: 'integer', minimum: -3, maximum: 3 }
        }
      }
    },
    recommendations: {
      type: 'array',
      minItems: 1,
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['description', 'impact'],
        properties: {
          description: { type: 'string' },
          impact: { type: 'integer', minimum: -3, maximum: 3 }
        }
      }
    }
  }
};

const workbooks = new Map();
const jobs = new Map();
let openAiClient;
let cachedSystemPrompt;

app.use(cors({ origin: 'http://localhost:4200' }));
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/workbooks', upload.single('file'), (req, res) => {
  if (!req.file) {
    res.status(400).json({ message: 'A workbook file is required.' });
    return;
  }

  try {
    const workbook = parseWorkbook(req.file.originalname, req.file.buffer);
    workbooks.set(workbook.id, workbook);
    res.status(201).json(toWorkbookResponse(workbook));
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

app.get('/api/workbooks/:id', (req, res) => {
  const workbook = workbooks.get(req.params.id);

  if (!workbook) {
    res.status(404).json({ message: 'Workbook not found.' });
    return;
  }

  res.json(toWorkbookResponse(workbook));
});

app.get('/api/workbooks/:id/items', (req, res) => {
  const workbook = workbooks.get(req.params.id);

  if (!workbook) {
    res.status(404).json({ message: 'Workbook not found.' });
    return;
  }

  res.json(workbook.items);
});

app.get('/api/workbooks/:id/items/:itemCode/metrics', (req, res) => {
  const workbook = workbooks.get(req.params.id);

  if (!workbook) {
    res.status(404).json({ message: 'Workbook not found.' });
    return;
  }

  const item = workbook.items.find((candidate) => candidate.itemCode === req.params.itemCode);

  if (!item) {
    res.status(404).json({ message: 'Item not found.' });
    return;
  }

  res.json(item.monthlyMetrics);
});

app.post('/api/workbooks/:id/ai-jobs', (req, res) => {
  const workbook = workbooks.get(req.params.id);

  if (!workbook) {
    res.status(404).json({ message: 'Workbook not found.' });
    return;
  }

  const scope = req.body?.scope ?? {};
  const selectedItemCodes = Array.isArray(scope.itemCodes) ? scope.itemCodes : [];
  const itemCodes = selectedItemCodes.length > 0
    ? selectedItemCodes
    : workbook.items.map((item) => item.itemCode);

  const job = {
    id: uuidv4(),
    workbookId: workbook.id,
    status: 'pending',
    progress: 0,
    totalTasks: 0,
    completedTasks: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    userContext: req.body?.userContext ?? {},
    itemCodes,
    findings: []
  };

  jobs.set(job.id, job);
  res.status(202).json(toJobResponse(job));

  setTimeout(() => runAiJob(job.id), 250);
});

app.get('/api/ai-jobs/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);

  if (!job) {
    res.status(404).json({ message: 'AI job not found.' });
    return;
  }

  res.json(toJobResponse(job));
});

app.get('/api/ai-jobs/:jobId/findings', (req, res) => {
  const job = jobs.get(req.params.jobId);

  if (!job) {
    res.status(404).json({ message: 'AI job not found.' });
    return;
  }

  res.json(job.findings);
});

app.listen(port, () => {
  console.log(`Forecast AI API listening on http://localhost:${port}`);
});

function parseWorkbook(sourceFileName, buffer) {
  const forecastStartMonth = parseForecastStartMonth(sourceFileName);
  const workbook = read(buffer, { type: 'buffer', cellDates: false });
  const requiredSheets = ['Items', 'Shipments History', 'Forecasts', 'Forecast History'];

  for (const sheetName of requiredSheets) {
    if (!workbook.SheetNames.includes(sheetName)) {
      throw new Error(`Missing required sheet: ${sheetName}`);
    }
  }

  const itemsRows = readSheetRows(workbook, 'Items');
  const shipmentRows = readSheetRows(workbook, 'Shipments History');
  const forecastRows = readSheetRows(workbook, 'Forecasts');
  const forecastHistoryRows = readSheetRows(workbook, 'Forecast History');
  const itemSheetColumns = createItemSheetColumns(itemsRows);

  const shipmentByItem = rowsByItemCode(shipmentRows);
  const forecastByItem = rowsByItemCode(forecastRows);
  const historyByItem = rowsByItemCode(forecastHistoryRows);
  const forecastMonths = getMonthColumns(forecastRows, 'F');
  const shipmentColumns = getMonthColumns(shipmentRows, 'S');
  const historyColumns = getMonthColumns(forecastHistoryRows, 'H');

  const itemRowsByCode = rowsByItemCode(itemsRows);
  const allItemCodes = uniqueValues([
    ...itemRowsByCode.keys(),
    ...forecastByItem.keys()
  ]);

  const items = allItemCodes.map((itemCode) => {
      const row = itemRowsByCode.get(itemCode);
      const metadata = {};

      for (const [key, value] of Object.entries(row?.__metadata ?? {})) {
        metadata[key] = value ?? '';
      }

      const shipment = shipmentByItem.get(itemCode);
      const forecast = forecastByItem.get(itemCode);
      const history = historyByItem.get(itemCode);
      const monthlyMetrics = forecastMonths.map((forecastColumn, index) => ({
        month: forecastColumn.month,
        forecastUnits: numericCell(forecast?.record[forecastColumn.key]),
        shipmentHistoryUnits: numericCell(shipment?.record[shipmentColumns[index]?.key]),
        forecastHistoryUnits: numericCell(history?.record[historyColumns[index]?.key])
      }));
      const forecastSheetValues = Object.fromEntries(
        forecastMonths.map((column) => [column.key, numericCell(forecast?.record[column.key])])
      );

      const retailPrice = numericCell(findMetadataValue(metadata, ['Retail Price', 'Retail']));
      const itemSheetValues = Object.fromEntries(
        itemSheetColumns.map((column) => [column.field, row?.record?.[column.sourceHeader] ?? ''])
      );

      return {
        itemCode,
        brand: textCell(findMetadataValue(metadata, ['Brand'])),
        category: textCell(findMetadataValue(metadata, ['Category'])),
        gender: textCell(findMetadataValue(metadata, ['Gender'])),
        type: textCell(findMetadataValue(metadata, ['Type'])),
        size: textCell(findMetadataValue(metadata, ['Size'])),
        description: textCell(findMetadataValue(metadata, ['Description'])),
        retailPrice,
        personalities: textCell(findMetadataValue(metadata, ['Personalities'])),
        color: textCell(findMetadataValue(metadata, ['Color'])),
        scent: textCell(findMetadataValue(metadata, ['Scent'])),
        metadata,
        itemSheetValues,
        forecastSheetValues,
        hasForecastRecord: Boolean(forecast),
        forecastTotal: monthlyMetrics.reduce((sum, metric) => sum + metric.forecastUnits, 0),
        shipmentHistoryTotal: monthlyMetrics.reduce((sum, metric) => sum + metric.shipmentHistoryUnits, 0),
        forecastHistoryTotal: monthlyMetrics.reduce((sum, metric) => sum + metric.forecastHistoryUnits, 0),
        monthlyMetrics
      };
    }).sort((left, right) => {
      if (left.hasForecastRecord !== right.hasForecastRecord) {
        return left.hasForecastRecord ? -1 : 1;
      }

      return left.itemCode.localeCompare(right.itemCode);
    });

  if (items.length === 0) {
    throw new Error('No item rows were found in the workbook.');
  }

  const months = forecastMonths.map((column) => column.month);

  return {
    id: uuidv4(),
    sourceFileName,
    forecastStartMonth,
    uploadedAt: new Date().toISOString(),
    itemSheetColumns,
    items,
    summary: {
      itemCount: items.length,
      forecastMonthCount: months.length,
      forecastMonths: months,
      forecastColumns: forecastMonths.map((column) => column.key),
      sheetNames: requiredSheets
    }
  };
}

function parseForecastStartMonth(fileName) {
  const match = /^Forecasts(?<year>\d{4})(?<month>\d{2})\.xls$/i.exec(fileName);

  if (!match?.groups) {
    throw new Error('Workbook filename must match ForecastsYYYYMM.xls.');
  }

  const year = Number(match.groups.year);
  const month = Number(match.groups.month);

  if (month < 1 || month > 12) {
    throw new Error('Workbook filename contains an invalid month.');
  }

  return `${year}-${String(month).padStart(2, '0')}-01`;
}

function readSheetRows(workbook, sheetName) {
  const sheet = workbook.Sheets[sheetName];
  const rows = utils.sheet_to_json(sheet, { header: 1, defval: '' });
  const headers = rows[1] ?? [];

  if (headers.length === 0) {
    throw new Error(`Sheet ${sheetName} does not have headers on row 2.`);
  }

  return rows.slice(2).map((row) => {
    const record = {};
    const metadata = {};

    headers.forEach((header, index) => {
      const key = textCell(header) || `Column${index + 1}`;
      record[key] = row[index] ?? '';

      if (index > 0) {
        metadata[key] = row[index] ?? '';
      }
    });

    const result = [...row];
    result.record = record;
    result.__metadata = metadata;
    result.__headers = headers.map((header, index) => textCell(header) || `Column${index + 1}`);
    return result;
  });
}

function createItemSheetColumns(itemsRows) {
  const headers = itemsRows[0]?.__headers ?? [];

  return headers.slice(1).map((header, index) => ({
    header: toPascalCaseHeader(header),
    sourceHeader: header,
    field: `itemColumn${index}`,
    dataType: hasNumericValue(itemsRows, header) ? 'number' : 'string'
  }));
}

function toPascalCaseHeader(value) {
  const words = textCell(value)
    .trim()
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean);

  if (words.length === 0) {
    return textCell(value);
  }

  return words
    .map((word) => {
      const normalized = word.toLowerCase();
      return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`;
    })
    .join('');
}

function hasNumericValue(rows, header) {
  return rows.some((row) => {
    const value = row.record?.[header];
    return value !== '' && value !== null && value !== undefined && Number.isFinite(Number(value));
  });
}

function rowsByItemCode(rows) {
  const result = new Map();

  for (const row of rows) {
    const itemCode = normalizeItemCode(row[0]);

    if (itemCode) {
      result.set(itemCode, row);
    }
  }

  return result;
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

function getMonthColumns(rows, prefix) {
  const firstRow = rows[0];

  if (!firstRow) {
    return [];
  }

  return Object.keys(firstRow.record)
    .filter((key) => key.toUpperCase().startsWith(prefix))
    .map((key) => ({
      key,
      month: compactMonthToIso(key)
    }))
    .filter((column) => column.month);
}

function compactMonthToIso(value) {
  const match = /^[SFH](?<year>\d{2})(?<month>\d{2})$/i.exec(value);

  if (!match?.groups) {
    return null;
  }

  const year = 2000 + Number(match.groups.year);
  const month = Number(match.groups.month);

  if (month < 1 || month > 12) {
    return null;
  }

  return `${year}-${String(month).padStart(2, '0')}-01`;
}

function normalizeItemCode(value) {
  return textCell(value).trim();
}

function textCell(value) {
  return value === null || value === undefined ? '' : String(value);
}

function numericCell(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function findMetadataValue(metadata, aliases) {
  const normalizedEntries = Object.entries(metadata).map(([key, value]) => [
    normalizeHeaderName(key),
    value
  ]);

  for (const alias of aliases) {
    const normalizedAlias = normalizeHeaderName(alias);
    const match = normalizedEntries.find(([key]) => key === normalizedAlias);

    if (match) {
      return match[1];
    }
  }

  return '';
}

function normalizeHeaderName(value) {
  return textCell(value).trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function toWorkbookResponse(workbook) {
  return {
    id: workbook.id,
    sourceFileName: workbook.sourceFileName,
    forecastStartMonth: workbook.forecastStartMonth,
    uploadedAt: workbook.uploadedAt,
    itemSheetColumns: workbook.itemSheetColumns,
    summary: workbook.summary,
    items: workbook.items
  };
}

function toJobResponse(job) {
  return {
    id: job.id,
    workbookId: job.workbookId,
    status: job.status,
    progress: job.progress,
    totalTasks: job.totalTasks,
    completedTasks: job.completedTasks,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    errorMessage: job.errorMessage
  };
}

async function runAiJob(jobId) {
  const job = jobs.get(jobId);

  if (!job) {
    return;
  }

  const workbook = workbooks.get(job.workbookId);

  if (!workbook) {
    job.status = 'failed';
    job.updatedAt = new Date().toISOString();
    return;
  }

  const items = workbook.items.filter((item) => job.itemCodes.includes(item.itemCode));
  const tasks = items.flatMap((item) => item.monthlyMetrics.map((metric) => ({ item, metric })));
  job.status = 'running';
  job.totalTasks = tasks.length;
  job.updatedAt = new Date().toISOString();

  for (const [index, task] of tasks.entries()) {
    try {
      job.findings.push(await createOpenAiFinding(task.item, task.metric, job.userContext, workbook));
      job.completedTasks = index + 1;
      job.progress = Math.round((job.completedTasks / job.totalTasks) * 100);
      job.updatedAt = new Date().toISOString();
    } catch (error) {
      job.status = 'failed';
      job.errorMessage = error.message;
      job.updatedAt = new Date().toISOString();
      return;
    }
  }

  job.status = 'complete';
  job.progress = 100;
  job.updatedAt = new Date().toISOString();
  console.log({job})
}

async function createOpenAiFinding(item, metric, userContext, workbook) {
  const response = await getOpenAiClient().responses.create({
    model: openAiModel,
    input: [
      {
        role: 'system',
        content: await getSystemPrompt()
      },
      {
        role: 'user',
        content: JSON.stringify(createForecastFindingInput(item, metric, userContext, workbook), null, 2)
      }
    ],
    tools: [
      {
        type: 'web_search',
        user_location: {
          type: 'approximate',
          country: 'US',
          timezone: 'America/New_York'
        }
      }
    ],
    tool_choice: 'auto',
    text: {
      format: {
        type: 'json_schema',
        name: 'forecast_finding',
        strict: true,
        schema: findingJsonSchema
      }
    }
  });

  const finding = parseOpenAiJsonResponse(response);
  return normalizeFinding(finding, item.itemCode, metric.month);
}

function createForecastFindingInput(item, metric, userContext, workbook) {
  return {
    task: 'Create one normalized forecast finding for this item and month. Return JSON only.',
    workbook: {
      sourceFileName: workbook.sourceFileName,
      forecastStartMonth: workbook.forecastStartMonth,
      forecastMonths: workbook.summary.forecastMonths
    },
    item: {
      itemCode: item.itemCode,
      itemAttributes: item.metadata,
      normalizedAttributes: {
        brand: item.brand,
        category: item.category,
        gender: item.gender,
        type: item.type,
        size: item.size,
        description: item.description,
        retailPrice: item.retailPrice,
        personalities: item.personalities,
        color: item.color,
        scent: item.scent
      }
    },
    monthMetric: {
      monthYear: metric.month,
      forecastUnits: metric.forecastUnits,
      shipmentHistoryUnits: metric.shipmentHistoryUnits,
      forecastHistoryUnits: metric.forecastHistoryUnits,
      deltaVsShipmentHistoryUnits: metric.forecastUnits - metric.shipmentHistoryUnits,
      deltaVsForecastHistoryUnits: metric.forecastUnits - metric.forecastHistoryUnits
    },
    userContext: {
      forecastingMethod: textCell(userContext.forecastingMethod),
      knownAssumptions: textCell(userContext.knownAssumptions),
      knownPromotionsOrConstraints: textCell(userContext.knownPromotionsOrConstraints),
      blindSpots: textCell(userContext.blindSpots),
      regionMarketNotes: textCell(userContext.regionMarketNotes)
    }
  };
}

function getOpenAiClient() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured.');
  }

  if (!openAiClient) {
    openAiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  return openAiClient;
}

async function getSystemPrompt() {
  if (!cachedSystemPrompt) {
    cachedSystemPrompt = await readFile(systemPromptPath, 'utf8');
  }

  return cachedSystemPrompt;
}

function parseOpenAiJsonResponse(response) {
  const outputText = response.output_text || collectResponseText(response);

  if (!outputText) {
    throw new Error('OpenAI returned an empty forecast finding response.');
  }

  try {
    return JSON.parse(outputText);
  } catch (error) {
    throw new Error(`OpenAI returned invalid JSON: ${error.message}`);
  }
}

function collectResponseText(response) {
  return (response.output ?? [])
    .flatMap((outputItem) => outputItem.content ?? [])
    .filter((contentItem) => contentItem.type === 'output_text' && contentItem.text)
    .map((contentItem) => contentItem.text)
    .join('');
}

function normalizeFinding(finding, itemCode, monthYear) {
  return {
    item: textCell(finding.item) || itemCode,
    monthYear: textCell(finding.monthYear) || monthYear,
    considerations: normalizeFindingEntries(finding.considerations),
    recommendations: normalizeFindingEntries(finding.recommendations)
  };
}

function normalizeFindingEntries(entries) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry) => ({
      description: textCell(entry?.description).trim(),
      impact: clampImpact(Number(entry?.impact))
    }))
    .filter((entry) => entry.description);
}

function clampImpact(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(-3, Math.min(3, Math.round(value)));
}
