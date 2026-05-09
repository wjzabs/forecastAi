import cors from 'cors';
import express from 'express';
import multer from 'multer';
import { read, utils } from 'xlsx';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const port = process.env.PORT || 3100;

const workbooks = new Map();
const jobs = new Map();

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

  const shipmentByItem = rowsByItemCode(shipmentRows);
  const forecastByItem = rowsByItemCode(forecastRows);
  const historyByItem = rowsByItemCode(forecastHistoryRows);
  const forecastMonths = getMonthColumns(forecastRows, 'F');
  const shipmentColumns = getMonthColumns(shipmentRows, 'S');
  const historyColumns = getMonthColumns(forecastHistoryRows, 'H');

  const items = itemsRows
    .filter((row) => normalizeItemCode(row[0]))
    .map((row) => {
      const itemCode = normalizeItemCode(row[0]);
      const metadata = {};

      for (const [key, value] of Object.entries(row.__metadata ?? {})) {
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

      const retailPrice = numericCell(metadata['Retail Price']);

      return {
        itemCode,
        brand: textCell(metadata.Brand),
        category: textCell(metadata.Category),
        gender: textCell(metadata.Gender),
        type: textCell(metadata.Type),
        size: textCell(metadata.Size),
        description: textCell(metadata.Description),
        retailPrice,
        metadata,
        forecastTotal: monthlyMetrics.reduce((sum, metric) => sum + metric.forecastUnits, 0),
        shipmentHistoryTotal: monthlyMetrics.reduce((sum, metric) => sum + metric.shipmentHistoryUnits, 0),
        forecastHistoryTotal: monthlyMetrics.reduce((sum, metric) => sum + metric.forecastHistoryUnits, 0),
        monthlyMetrics
      };
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
    items,
    summary: {
      itemCount: items.length,
      forecastMonthCount: months.length,
      forecastMonths: months,
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
    return result;
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

function toWorkbookResponse(workbook) {
  return {
    id: workbook.id,
    sourceFileName: workbook.sourceFileName,
    forecastStartMonth: workbook.forecastStartMonth,
    uploadedAt: workbook.uploadedAt,
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
    updatedAt: job.updatedAt
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
    await delay(35);
    job.findings.push(createPocFinding(task.item, task.metric, job.userContext));
    job.completedTasks = index + 1;
    job.progress = Math.round((job.completedTasks / job.totalTasks) * 100);
    job.updatedAt = new Date().toISOString();
  }

  job.status = 'complete';
  job.progress = 100;
  job.updatedAt = new Date().toISOString();
}

function createPocFinding(item, metric, userContext) {
  const deltaVsShipments = metric.forecastUnits - metric.shipmentHistoryUnits;
  const deltaVsHistory = metric.forecastUnits - metric.forecastHistoryUnits;
  const netDirection = Math.sign(deltaVsShipments + deltaVsHistory);
  const priceContext = item.retailPrice <= 0
    ? 'This appears to be a sample or tester item, so demand may be tied to counter support and promotional strategy rather than direct retail sales.'
    : `Retail price is ${item.retailPrice}, so recommendations should consider price sensitivity and giftability.`;
  const blindSpot = textCell(userContext.blindSpots).trim();

  return {
    item: item.itemCode,
    monthYear: metric.month,
    considerations: [
      {
        description: `${item.brand || 'This brand'} ${item.category || 'fragrance'} forecast is ${formatDelta(deltaVsShipments)} versus shipment history and ${formatDelta(deltaVsHistory)} versus prior forecast history.`,
        impact: clampImpact(netDirection)
      },
      {
        description: priceContext,
        impact: item.retailPrice <= 0 ? 1 : 0
      },
      {
        description: blindSpot
          ? `User-requested blind spot to evaluate: ${blindSpot}`
          : 'Review seasonal retail events, brand activity, celebrity affiliations, regional disruption, and department store traffic for this month before finalizing demand.',
        impact: 0
      }
    ],
    recommendations: [
      {
        description: item.retailPrice <= 0
          ? 'Coordinate tester and sample quantities with the sellable fragrance forecast so promotional support arrives before the retail demand window.'
          : 'Compare this item against adjacent brand/category items and flag unusually high or low forecast movement before committing purchase orders.',
        impact: item.retailPrice <= 0 ? 2 : 1
      },
      {
        description: 'Use product metadata such as brand, gender, type, size, color, ingredient, and description to search for external trend signals before making a manual forecast adjustment.',
        impact: 1
      }
    ]
  };
}

function formatDelta(delta) {
  if (delta === 0) {
    return 'flat';
  }

  return delta > 0 ? `${delta} units higher` : `${Math.abs(delta)} units lower`;
}

function clampImpact(value) {
  return Math.max(-3, Math.min(3, value));
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
