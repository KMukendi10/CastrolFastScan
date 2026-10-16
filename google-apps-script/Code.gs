const IMPORT_TAB = "WhatsApp Import";
const HEADER_ROW = 1;
const FIRST_DATA_ROW = 2;
const SYNC_STATE_TAB = "_FastScan Sync State";

const IMPORT_HEADERS = [
  "WhatsApp Number", "First Name", "Last Name", "Full Name", "Mechanic ID",
  "Workshop Name", "Region", "Street Address", "Preferred Language", "Business Type",
  "FastScan Registered", "First Scan Completed", "Total Scans", "POPIA Consent", "Last Interaction",
];

/**
 * Castrol FastScan -> Quorum WhatsApp Import receiver.
 * Configure FASTSCAN_SPREADSHEET_ID and FASTSCAN_SYNC_SECRET in Script Properties.
 * Only eligible mechanic records are written to the WhatsApp Import tab.
 */
function doPost(e) {
  try {
    const request = JSON.parse((e.postData && e.postData.contents) || "{}");
    const expectedSecret = PropertiesService.getScriptProperties().getProperty("FASTSCAN_SYNC_SECRET");
    if (!expectedSecret || !constantTimeEqual_(request.secret || "", expectedSecret)) {
      return json_({ synced: false, error: "Sync authentication failed. Check the shared secret." });
    }
    if (request.kind !== "mechanic") {
      return json_({ synced: false, error: "This workbook is currently configured for mechanic records only." });
    }

    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      const spreadsheetId = PropertiesService.getScriptProperties().getProperty("FASTSCAN_SPREADSHEET_ID");
      if (!spreadsheetId) throw new Error("Set FASTSCAN_SPREADSHEET_ID in Apps Script properties.");
      const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
      const sheet = spreadsheet.getSheetByName(IMPORT_TAB);
      if (!sheet) throw new Error("Could not find the WhatsApp Import tab.");
      const columns = headerColumns_(sheet);
      const syncState = getSyncState_(spreadsheet, sheet, columns);
      if (request.action === "delete") {
        if (request.kind !== "mechanic") throw new Error("Only mechanic registrations can be removed from WhatsApp Import.");
        const email = String(request.mechanicEmail || "").trim().toLowerCase();
        if (!email) throw new Error("A mechanic email reference is required to remove the row.");
        const deleted = deleteMechanic_(sheet, columns, syncState, email);
        return json_({ deleted: true, removedCount: deleted });
      }
      const records = Array.isArray(request.records) ? request.records : [request];
      let syncedCount = 0;
      let skippedCount = 0;
      const skippedReasons = [];
      const errors = [];
      const writtenRows = [];

      records.forEach(function (record) {
        try {
          const result = syncMechanic_(sheet, columns, record, request.restoreMissing === true, syncState);
          if (result.skipped) {
            skippedCount++;
            if (skippedReasons.length < 5) skippedReasons.push(result.reason);
          } else {
            syncedCount++;
            writtenRows.push(result.rowNumber);
          }
        } catch (error) {
          if (errors.length < 5) errors.push(error && error.message ? error.message : "Could not write a row.");
        }
      });
      const failedCount = records.length - syncedCount - skippedCount;
      return json_({
        synced: failedCount === 0,
        syncedCount: syncedCount,
        skippedCount: skippedCount,
        skippedReasons: skippedReasons,
        failedCount: failedCount,
        errors: errors,
        spreadsheetName: spreadsheet.getName(),
        spreadsheetUrl: spreadsheet.getUrl(),
        tab: IMPORT_TAB,
        writtenRows: writtenRows,
      });
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    return json_({ synced: false, error: error && error.message ? error.message : "Could not write the rows." });
  }
}

function headerColumns_(sheet) {
  const headers = sheet.getRange(HEADER_ROW, 1, 1, sheet.getLastColumn()).getDisplayValues()[0]
    .map(function (header) { return String(header || "").trim().toLowerCase(); });
  const columns = {};
  IMPORT_HEADERS.forEach(function (header) {
    const index = headers.indexOf(header.toLowerCase());
    if (index < 0) throw new Error("The WhatsApp Import tab is missing the heading: " + header);
    columns[header] = index + 1;
  });
  return columns;
}

function syncMechanic_(sheet, columns, record, restoreMissing, syncState) {
  if (!Number.isSafeInteger(Number(record.recordId)) || !record.row) throw new Error("Invalid Castrol FastScan row.");
  const row = record.row;
  const consent = yesNo_(row["POPIA consent"]);
  if (consent !== "Yes") return { skipped: true, reason: "POPIA consent is not recorded as Yes." };

  const phone = normalizePhone_(row["Whatsapp number"] || row["Contact number"]);
  if (!phone) return { skipped: true, reason: "A valid WhatsApp number is missing." };

  const firstName = String(row["First name"] || "").trim();
  const lastName = String(row.Surname || "").trim();
  const mechanicId = String(row["Mechanic ID (Email Address)"] || "").trim().toLowerCase();
  if (!firstName || !lastName || !mechanicId) throw new Error("The saved mechanic is missing a name or email reference.");

  const lastRow = Math.max(sheet.getLastRow(), FIRST_DATA_ROW - 1);
  const count = Math.max(0, lastRow - FIRST_DATA_ROW + 1);
  const ids = count ? sheet.getRange(FIRST_DATA_ROW, columns["Mechanic ID"], count, 1).getDisplayValues().flat() : [];
  const phones = count ? sheet.getRange(FIRST_DATA_ROW, columns["WhatsApp Number"], count, 1).getDisplayValues().flat() : [];
  const idMatches = [];
  const phoneMatches = [];
  ids.forEach(function (id, index) {
    if (String(id || "").trim().toLowerCase() === mechanicId) idMatches.push(index);
  });
  phones.forEach(function (number, index) {
    if (normalizePhone_(number) === phone) phoneMatches.push(index);
  });
  if (idMatches.length > 1) throw new Error("More than one existing row has this Mechanic ID. Review the workbook before syncing.");
  const targetIndex = idMatches.length ? idMatches[0] : -1;
  if (phoneMatches.some(function (index) { return index !== targetIndex; })) {
    return { skipped: true, reason: "This WhatsApp number already belongs to another Mechanic ID; review it before importing." };
  }

  const stateKey = "mechanic-email|" + mechanicId;
  if (syncState.deleted.has(stateKey)) {
    return { skipped: true, reason: "This registration was deleted and will not be restored by sync." };
  }
  if (targetIndex < 0 && syncState.ids.has(stateKey) && !restoreMissing) {
    return { skipped: true, reason: "This previously synced row was removed from the workbook." };
  }

  const valuesByHeader = {
    "WhatsApp Number": phone,
    "First Name": firstName,
    "Last Name": lastName,
    "Full Name": [firstName, lastName].filter(Boolean).join(" "),
    "Mechanic ID": mechanicId,
    "Workshop Name": row["Workshop name"],
    "Region": row.Region,
    "Street Address": row["Street address"],
    "Preferred Language": row["Preferred language"],
    "Business Type": row["Business type"],
    "FastScan Registered": yesNo_(row["FastScan registered"]),
    "First Scan Completed": yesNo_(row["First scan completed (agent)"], "No"),
    "Total Scans": row["Total scans"] == null ? 0 : row["Total scans"],
    "POPIA Consent": consent,
    "Last Interaction": dateOnly_(row["Last interaction"]),
  };
  const targetRow = targetIndex >= 0 ? FIRST_DATA_ROW + targetIndex : Math.max(FIRST_DATA_ROW, lastRow + 1);
  writeMappedRow_(sheet, targetRow, columns, valuesByHeader);
  rememberSynced_(syncState, stateKey);
  return { skipped: false, rowNumber: targetRow };
}

function dateOnly_(value) {
  if (value == null || value === "") return "";
  var date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) return "";
  return Utilities.formatDate(date, "Africa/Johannesburg", "yyyy-MM-dd");
}

function writeMappedRow_(sheet, row, columns, valuesByHeader) {
  const updates = Object.keys(valuesByHeader).map(function (header) {
    return { column: columns[header], value: sheetValue_(valuesByHeader[header]) };
  }).sort(function (a, b) { return a.column - b.column; });
  let group = [];
  updates.forEach(function (update) {
    if (group.length && update.column !== group[group.length - 1].column + 1) {
      writeColumnGroup_(sheet, row, group);
      group = [];
    }
    group.push(update);
  });
  if (group.length) writeColumnGroup_(sheet, row, group);
}

function writeColumnGroup_(sheet, row, group) {
  sheet.getRange(row, group[0].column, 1, group.length)
    .setValues([group.map(function (item) { return item.value; })]);
}

function getSyncState_(spreadsheet, importSheet, columns) {
  let sheet = spreadsheet.getSheetByName(SYNC_STATE_TAB);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(SYNC_STATE_TAB);
    sheet.getRange(1, 1, 1, 2).setValues([["sync_key", "synced_at"]]);
    const lastImportRow = importSheet.getLastRow();
    const count = Math.max(0, lastImportRow - FIRST_DATA_ROW + 1);
    const existingIds = count
      ? importSheet.getRange(FIRST_DATA_ROW, columns["Mechanic ID"], count, 1).getDisplayValues().flat()
      : [];
    const seedRows = existingIds.map(function (id) { return String(id || "").trim().toLowerCase(); })
      .filter(Boolean).map(function (id) { return ["mechanic-email|" + id, new Date().toISOString()]; });
    if (seedRows.length) sheet.getRange(2, 1, seedRows.length, 2).setValues(seedRows);
    sheet.hideSheet();
  }
  if (sheet.getLastRow() < 1) sheet.getRange(1, 1, 1, 2).setValues([["sync_key", "synced_at"]]);
  const lastRow = sheet.getLastRow();
  const keys = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues().flat() : [];
  const deletedKeys = keys.filter(function (key) { return String(key).indexOf("deleted|") === 0; })
    .map(function (key) { return String(key).slice("deleted|".length); });
  return { sheet: sheet, ids: new Set(keys), deleted: new Set(deletedKeys) };
}

function deleteMechanic_(sheet, columns, syncState, mechanicEmail) {
  const lastRow = Math.max(sheet.getLastRow(), FIRST_DATA_ROW - 1);
  const count = Math.max(0, lastRow - FIRST_DATA_ROW + 1);
  const ids = count ? sheet.getRange(FIRST_DATA_ROW, columns["Mechanic ID"], count, 1).getDisplayValues().flat() : [];
  const matches = [];
  ids.forEach(function (id, index) {
    if (String(id || "").trim().toLowerCase() === mechanicEmail) matches.push(FIRST_DATA_ROW + index);
  });
  if (matches.length > 1) throw new Error("More than one WhatsApp Import row has this Mechanic ID. Ask a manager to review the workbook.");
  if (matches.length === 1) sheet.deleteRow(matches[0]);

  const stateKey = "mechanic-email|" + mechanicEmail;
  const deletedKey = "deleted|" + stateKey;
  if (!syncState.ids.has(deletedKey)) {
    syncState.sheet.appendRow([deletedKey, new Date().toISOString()]);
    syncState.ids.add(deletedKey);
    syncState.deleted.add(stateKey);
  }
  return matches.length;
}

function rememberSynced_(state, key) {
  if (state.ids.has(key)) return;
  state.sheet.appendRow([key, new Date().toISOString()]);
  state.ids.add(key);
}

function normalizePhone_(value) {
  const phone = String(value || "").trim().replace(/[\s()-]/g, "");
  return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : "";
}

function yesNo_(value, emptyValue) {
  if (value === true || String(value).trim().toLowerCase() === "yes") return "Yes";
  if (value === false || String(value).trim().toLowerCase() === "no") return "No";
  return value == null || value === "" ? (emptyValue || "") : value;
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
