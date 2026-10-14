const SPREADSHEET_ID = "1dopguPdIfSEZV30jEzEAmgxRm6T_dhmNvF7MsBF4kYQ";
const FIRST_DATA_ROW = 5; // Rows 1-2 are the title; rows 3-4 are the template headers/help.
const SYNC_STATE_TAB = "_FastScan Sync State";

/**
 * FastScan -> Google Sheets receiver for the Castrol FastScan workbook layout.
 * Deploy as a Web app that executes as you. FastScan sends only rows already
 * saved in Supabase, plus a shared secret checked against Script Properties.
 */
function doPost(e) {
  try {
    const request = JSON.parse((e.postData && e.postData.contents) || "{}");
    const expectedSecret = PropertiesService.getScriptProperties().getProperty("FASTSCAN_SYNC_SECRET");
    if (!expectedSecret || !constantTimeEqual_(request.secret || "", expectedSecret)) {
      return json_({ synced: false, error: "Sync authentication failed. Check the shared secret." });
    }
    if (!["mechanic", "spares"].includes(request.kind)) {
      return json_({ synced: false, error: "Invalid record type." });
    }
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
      const syncState = getSyncState_(spreadsheet);
      const records = Array.isArray(request.records) ? request.records : [request];
      let syncedCount = 0;
      let skippedCount = 0;
      const errors = [];
      let lastTab = "";
      records.forEach(function (record) {
        try {
          const outcome = syncRecord_(spreadsheet, request.kind, record, request.restoreMissing === true, syncState);
          lastTab = outcome.tab;
          if (outcome.skipped) skippedCount++;
          else syncedCount++;
        } catch (error) {
          if (errors.length < 5) errors.push(error && error.message ? error.message : "Could not write a row.");
        }
      });
      const failedCount = records.length - syncedCount - skippedCount;
      return json_({ synced: failedCount === 0, syncedCount: syncedCount, skippedCount: skippedCount, failedCount: failedCount, errors: errors, tab: lastTab });
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    return json_({ synced: false, error: error && error.message ? error.message : "Could not write the rows." });
  }
}

function syncRecord_(spreadsheet, kind, record, restoreMissing, syncState) {
  if (!Number.isSafeInteger(Number(record.recordId)) || !record.row) throw new Error("Invalid FastScan row.");
  const databaseKind = String(record.row.database_kind || "");
  const tabPrefix = kind === "spares"
      ? "Spares"
      : databaseKind === "independent_mechanic" ? "Independent Mechanics" : "1. Mechanics Profile";
  const sheet = findSheet_(spreadsheet, tabPrefix);
  if (!sheet) throw new Error("Could not find the workbook tab: " + tabPrefix);

  const values = kind === "spares" ? sparesValues_(record.row) : mechanicValues_(record.row, databaseKind);
  const keyColumn = kind === "spares" ? 4 : 2; // Manager email or mechanic email.
  const syncIdColumn = values.length + 1; // Keep the workbook's visible template columns intact.
  ensureSyncIdColumn_(sheet, syncIdColumn);

  const recordId = String(record.recordId);
  const lastRow = Math.max(sheet.getLastRow(), FIRST_DATA_ROW - 1);
  const count = Math.max(0, lastRow - FIRST_DATA_ROW + 1);
  const ids = count ? sheet.getRange(FIRST_DATA_ROW, syncIdColumn, count, 1).getDisplayValues().flat() : [];
  const keys = count ? sheet.getRange(FIRST_DATA_ROW, keyColumn, count, 1).getDisplayValues().flat() : [];
  const sparesKeyPairs = count && kind === "spares"
    ? sheet.getRange(FIRST_DATA_ROW, 3, count, 2).getDisplayValues()
    : [];
  const matchKey = kind === "spares"
    ? [values[2], values[3]].map(normalize_).join("|")
    : normalize_(values[1]);
  const idMatches = [];
  const keyMatches = [];
  ids.forEach(function (id, index) {
    if (id === recordId) idMatches.push(index);
  });
  keys.forEach(function (key, index) {
    if (!key) return;
    const matches = kind === "spares"
      ? sparesKeyPairs[index].map(normalize_).join("|") === matchKey
      : normalize_(key) === matchKey;
    if (matches) keyMatches.push(index);
  });
  const duplicateIndexes = Array.from(new Set(idMatches.concat(keyMatches)));
  let targetRow = duplicateIndexes.length
    ? FIRST_DATA_ROW + (idMatches.length ? idMatches[0] : keyMatches[0])
    : -1;
  const stateKey = syncStateKey_(kind, recordId);
  if (targetRow < FIRST_DATA_ROW && syncState.ids.has(stateKey) && !restoreMissing) {
    return { tab: sheet.getName(), skipped: true };
  }
  if (targetRow < FIRST_DATA_ROW) {
    const emptyIndex = keys.findIndex(function (key) { return !key; });
    targetRow = emptyIndex >= 0 ? FIRST_DATA_ROW + emptyIndex : Math.max(FIRST_DATA_ROW, lastRow + 1);
  }

  sheet.getRange(targetRow, 1, 1, values.length).setValues([values.map(sheetValue_)]);
  sheet.getRange(targetRow, syncIdColumn).setValue(recordId);
  duplicateIndexes
    .map(function (index) { return FIRST_DATA_ROW + index; })
    .filter(function (row) { return row !== targetRow; })
    .sort(function (a, b) { return b - a; })
    .forEach(function (row) { sheet.deleteRow(row); });
  rememberSynced_(syncState, kind, recordId);
  return { tab: sheet.getName(), skipped: false };
}

function getSyncState_(spreadsheet) {
  let stateSheet = spreadsheet.getSheetByName(SYNC_STATE_TAB);
  let seedRows = [];
  if (!stateSheet) {
    stateSheet = spreadsheet.insertSheet(SYNC_STATE_TAB);
    stateSheet.getRange(1, 1, 1, 3).setValues([["kind", "record_id", "synced_at"]]);
    seedRows = existingSyncIds_(spreadsheet);
  } else if (stateSheet.getLastRow() <= 1) {
    stateSheet.getRange(1, 1, 1, 3).setValues([["kind", "record_id", "synced_at"]]);
    seedRows = existingSyncIds_(spreadsheet);
  }
  if (seedRows.length) stateSheet.getRange(2, 1, seedRows.length, 3).setValues(seedRows);
  stateSheet.hideSheet();

  const lastRow = stateSheet.getLastRow();
  const rows = lastRow > 1 ? stateSheet.getRange(2, 1, lastRow - 1, 2).getDisplayValues() : [];
  return { sheet: stateSheet, ids: new Set(rows.map(function (row) { return syncStateKey_(row[0], row[1]); })) };
}

function existingSyncIds_(spreadsheet) {
  const rows = [];
  [
    { prefix: "1. Mechanics Profile", kind: "mechanic", idColumn: 31 },
    { prefix: "Independent Mechanics", kind: "mechanic", idColumn: 30 },
    { prefix: "Spares", kind: "spares", idColumn: 39 },
  ].forEach(function (entry) {
    const sheet = findSheet_(spreadsheet, entry.prefix);
    if (!sheet || sheet.getLastRow() < FIRST_DATA_ROW || sheet.getMaxColumns() < entry.idColumn) return;
    const count = sheet.getLastRow() - FIRST_DATA_ROW + 1;
    sheet.getRange(FIRST_DATA_ROW, entry.idColumn, count, 1).getDisplayValues().forEach(function (row) {
      const recordId = String(row[0] || "").trim();
      if (recordId) rows.push([entry.kind, recordId, new Date().toISOString()]);
    });
  });
  return rows;
}

function syncStateKey_(kind, recordId) {
  return String(kind) + "|" + String(recordId);
}

function rememberSynced_(syncState, kind, recordId) {
  const key = syncStateKey_(kind, recordId);
  if (syncState.ids.has(key)) return;
  syncState.sheet.appendRow([kind, String(recordId), new Date().toISOString()]);
  syncState.ids.add(key);
}

function findSheet_(spreadsheet, prefix) {
  return spreadsheet.getSheets().find(function (sheet) {
    return sheet.getName() === prefix || sheet.getName().startsWith(prefix + " (");
  }) || null;
}

function ensureSyncIdColumn_(sheet, column) {
  if (sheet.getMaxColumns() < column) sheet.insertColumnAfter(sheet.getMaxColumns());
  sheet.getRange(3, column).setValue("_FastScan record ID");
  sheet.hideColumns(column);
}

function mechanicValues_(row, databaseKind) {
  const base = [
    row.Date, row["Mechanic ID (Email Address)"], row["First name"], row.Surname,
    row["Contact number"], row["Whatsapp number"], row["Workshop name"], row["Town/Suburb"],
    row["Street address"], gps_(row), row["Preferred language"], row["Vehicles per day"],
    row["Main oil brand used"], row["Reason for brand"], row["Stock bought"], row["Shop name"],
    yesNo_(row["FastScan registered"]), row["Registration date"], yesNo_(row["First scan completed (agent)"], "No"),
    row["Last interaction"], row.Specialisation, row["Years of experience"], row["Training background"],
    yesNo_(row["POPIA consent"]), row["Business type"], row["Total scans"],
  ];
  if (databaseKind === "independent_mechanic") {
    return base.concat([yesNo_(row["Pays rent?"]), row.Notes, row["FastScan notes"]]);
  }
  return base.concat([row.Notes, yesNo_(row["Service kit distributed"]), row["Items given"], row["FastScan notes"]]);
}

function sparesValues_(row) {
  const prices = row["Prices (ZAR)"] || {};
  const price = function (label) { return prices[label] ?? ""; };
  return [
    row["Date of latest visit"], row.Region, row["Spare shop trading name"], row["Manager email"],
    row.Area, row["Manager name"], row["Manager surname"], row["Whatsapp number"], row["Contact number"],
    row.Address, gps_(row), row["Business type"], row["Years in operation"], yesNo_(row["Stocks Castrol?"]),
    row["Castrol products stocked"], row["Castrol stock level"], row["Castrol branding visibility"],
    price("5L Castrol GTX"), price("5L Castrol Magnatec Petrol"), price("5L Castrol Magnatec Petrol & Diesel"),
    price("5L Castrol EDGE"), price("5L Castrol Actevo"), price("1L Castrol GTX"),
    price("1L Castrol Magnatec (Petrol)"), price("1L Castrol Magnatec (Petrol & Diesel)"),
    price("1L Castrol EDGE"), price("1L Castrol Actevo"), row["Competitor brands stocked"],
    row["Strongest sellers"], row["Most customer requests"], row["Most mechanic requests"],
    yesNo_(row["Serves mechanics?"]), row["Mechanics visiting weekly"], yesNo_(row["Can refer workshops?"]),
    row["Promo sales to date"], row["Competitor price comparison"], row.Notes, yesNo_(row["New stock"]),
  ];
}

function gps_(row) {
  if (row["GPS latitude"] == null || row["GPS longitude"] == null) return "";
  return String(row["GPS latitude"]) + ", " + String(row["GPS longitude"]);
}

function yesNo_(value, emptyValue) {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return value == null ? (emptyValue || "") : value;
}

function normalize_(value) {
  return String(value || "").trim().toLowerCase();
}

function sheetValue_(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  if (typeof value === "string" && /^[=+@\-]/.test(value)) return "'" + value;
  return value;
}

function constantTimeEqual_(left, right) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i++) mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return mismatch === 0;
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
