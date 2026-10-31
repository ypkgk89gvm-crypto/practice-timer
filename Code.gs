// Wagner Practice Log (v2) - receives practice sessions and lesson notes from the practice timer page.
// Paste into Extensions > Apps Script, then Deploy > Manage deployments > Edit (pencil) > Version: New version > Deploy
// (that keeps the same /exec address).
//
//  POST {rows:[...]} or one row        -> "Log" tab, one row per practice session (same as before, plus a Coaching column)
//  POST {type:'lesson', id, ...}        -> "Lessons" tab: Date, Kid, Instrument, Notes JSON, Transcript, Lesson ID
//                                          (same id again = update that row; deleted:true = remove it)
//  GET  ?kid=Abram                      -> that kid's recent lesson notes as JSON (no transcripts)
//  GET  (no parameters)                 -> {ok:true, app, version:2}
var LOG_HEADERS = ['Date', 'Start time', 'Kid', 'Instrument', 'Target minutes', 'Actual playing minutes', 'Completed', 'Session length (min)', 'Session ID', 'Coaching'];
var LESSON_HEADERS = ['Date', 'Kid', 'Instrument', 'Notes JSON', 'Transcript', 'Lesson ID'];
var MAX_CELL = 49000;

function doPost(e) {
  var data = JSON.parse(e.postData.contents);
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    if (data && (data.type === 'lesson' || data.lessons)) {
      (data.lessons || [data]).forEach(saveLesson_);
    } else {
      var rows = data.rows || [data];
      var sheet = SpreadsheetApp.getActive().getSheetByName('Log');
      if (!sheet) { sheet = SpreadsheetApp.getActive().insertSheet('Log'); sheet.appendRow(LOG_HEADERS); }
      if (sheet.getLastColumn() < 10 && sheet.getLastRow() >= 1 && sheet.getRange(1, 1).getValue() === 'Date') sheet.getRange(1, 10).setValue('Coaching');
      var last = sheet.getLastRow();
      var seen = last > 1 ? sheet.getRange(2, 9, last - 1, 1).getValues().map(function (r) { return String(r[0]); }) : [];
      rows.forEach(function (r) {
        if (r.id && seen.indexOf(String(r.id)) !== -1) return; // already logged (retry)
        sheet.appendRow([r.date, r.start, r.kid, r.instrument, r.target, r.actual, r.completed, r.length, r.id || '', safe_(r.coaching || '')]);
        if (r.id) seen.push(String(r.id));
      });
    }
  } finally { lock.releaseLock(); }
  return json_({ ok: true, version: 2 });
}

function lessonsSheet_() {
  var ss = SpreadsheetApp.getActive(), sh = ss.getSheetByName('Lessons');
  if (!sh) { sh = ss.insertSheet('Lessons'); sh.appendRow(LESSON_HEADERS); sh.setFrozenRows(1); }
  return sh;
}

function saveLesson_(L) {
  if (!L || !L.id) return;
  var sh = lessonsSheet_(), last = sh.getLastRow(), id = String(L.id), rowNum = -1;
  if (last > 1) {
    var ids = sh.getRange(2, 6, last - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === id) { rowNum = i + 2; break; }
  }
  if (L.deleted) { if (rowNum > 0) sh.deleteRow(rowNum); return; }
  var notes = JSON.stringify(L.notes || []);
  if (notes.length > MAX_CELL) notes = JSON.stringify((L.notes || []).slice(0, 40));
  var transcript = String(L.transcript || '');
  if (rowNum > 0 && !transcript) transcript = String(sh.getRange(rowNum, 5).getValue() || '');   // an edit without the transcript keeps the old one
  if (transcript.length > MAX_CELL) transcript = transcript.slice(0, MAX_CELL) + ' …[cut]';
  var row = [String(L.date || ''), safe_(L.kid), safe_(L.instrument), notes, safe_(transcript), id];
  if (rowNum > 0) sh.getRange(rowNum, 1, 1, 6).setValues([row]);
  else sh.appendRow(row);
  var r = rowNum > 0 ? rowNum : sh.getLastRow();
  sh.getRange(r, 1).setNumberFormat('@').setValue(String(L.date || ''));  // keep the date as text (yyyy-mm-dd)
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (!p.kid) return json_({ ok: true, app: 'Wagner Practice Log', version: 2 });
  var kid = String(p.kid).toLowerCase(), limit = Math.min(30, Math.max(1, parseInt(p.limit, 10) || 10));
  var sh = SpreadsheetApp.getActive().getSheetByName('Lessons'), out = [];
  if (sh && sh.getLastRow() > 1) {
    var vals = sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues();
    vals.forEach(function (v) {
      if (String(v[1]).toLowerCase() !== kid) return;
      var notes = []; try { notes = JSON.parse(v[3] || '[]'); } catch (err) {}
      out.push({ id: String(v[5]), date: dateStr_(v[0]), kid: String(v[1]), instrument: String(v[2]), notes: notes });
    });
  }
  out.sort(function (a, b) { return (parseInt(b.id, 10) || 0) - (parseInt(a.id, 10) || 0); });
  return json_({ ok: true, version: 2, kid: p.kid, limit: limit, lessons: out.slice(0, limit) });
}

function dateStr_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return String(v || '');
}
function safe_(v) { v = String(v == null ? '' : v); return /^[=+\-@]/.test(v) ? "'" + v : v; }   // never let text become a formula
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
