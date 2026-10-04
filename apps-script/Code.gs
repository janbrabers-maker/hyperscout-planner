/**
 * Hyperscout Planner
 * Web app + Monday email on top of the "Hyperscout Topics (planner app)" Google Sheet.
 *
 * The sheet is the database:
 *   Topics   : one row per topic (ID, Workstream, Topic, Owner, Start, Due, Status,
 *              Priority, Depends on / blocks, Source, Notes, Drive folder, Updated)
 *   People   : Name, Email, Monday email (Yes/No), Note
 *   Settings : key / value pairs (private file ID, Drive parent folder, app URL, ...)
 *
 * The web app runs as the person who opens it, so everyone only sees what their
 * own Google account can open. Jan's private topics come from a second file that
 * only Jan can open; for anyone else that part is simply skipped.
 */

var TZ = 'Europe/Amsterdam';
var TOPICS = 'Topics';
var PEOPLE = 'People';
var SETTINGS = 'Settings';
var PRIVATE_TAB = 'Private topics';
var PRIVATE_HEADER_ROW = 3; // private file has a title and a note above its header
var STATUSES = ['Not started', 'In progress', 'Waiting', 'Blocked', 'Done'];
var PRIORITIES = ['High', 'Medium', 'Low'];
var WORKSTREAMS = {
  'Tradeshows & Pitti': 'T',
  'Brands': 'B',
  'Producers': 'P',
  'Tech & data': 'X',
  'Puglia grant & Italia': 'G',
  'HR': 'H',
  'Finance': 'F',
  'Legal & admin': 'L'
};
var COLS = ['id', 'workstream', 'topic', 'owner', 'start', 'due', 'status', 'priority',
  'depends', 'source', 'notes', 'folder', 'updated'];
var PARENT_FOLDER_NAME = 'Hyperscout Planning';
var REMOVED_FOLDER_NAME = '_Removed topics';

/* ------------------------------------------------------------------ */
/* Sheet menu                                                          */
/* ------------------------------------------------------------------ */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Hyperscout')
    .addItem('Open the planner app', 'menuOpenApp')
    .addSeparator()
    .addItem('Install: folders, sharing, Monday email', 'install')
    .addItem('Create missing Drive folders', 'menuCreateMissingFolders')
    .addItem('Send the Monday email now (test)', 'sendWeeklyEmail')
    .addToUi();
}

function menuOpenApp() {
  var url = getSetting_('App URL') || ScriptApp.getService().getUrl();
  var html = HtmlService.createHtmlOutput(
    '<p style="font-family:Arial">' +
    (url ? '<a href="' + url + '" target="_blank">Open the Hyperscout planner</a>'
         : 'Deploy the web app first (Deploy > New deployment), then paste its URL in Settings > App URL.') +
    '</p>').setWidth(360).setHeight(90);
  SpreadsheetApp.getUi().showModalDialog(html, 'Hyperscout planner');
}

function menuCreateMissingFolders() {
  var n = createMissingFolders_();
  SpreadsheetApp.getActive().toast(n + ' folder(s) created', 'Hyperscout', 5);
}

/**
 * One-time setup, run by Jan from the sheet menu:
 * 1. creates the "Hyperscout Planning" Drive folder (with one subfolder per workstream)
 * 2. creates a folder for every topic that has none
 * 3. shares the sheet and the folder with everyone on the People tab marked Monday email = Yes
 * 4. installs the weekly email trigger (Monday, 07:00-08:00 Amsterdam)
 */
function install() {
  var parent = getParentFolder_();
  var created = createMissingFolders_();

  var me = Session.getEffectiveUser().getEmail().toLowerCase();
  var ss = SpreadsheetApp.getActive();
  var shared = [];
  readPeople_().forEach(function (p) {
    if (!p.email || !p.monday || p.email.toLowerCase() === me || p.name.toLowerCase() === 'jan') return;
    try { ss.addEditor(p.email); parent.addEditor(p.email); shared.push(p.email); } catch (e) {
      Logger.log('Could not share with ' + p.email + ': ' + e);
    }
  });

  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendWeeklyEmail') ScriptApp.deleteTrigger(t);
  });
  var hour = Number(getSetting_('Email hour (Amsterdam)')) || 7;
  ScriptApp.newTrigger('sendWeeklyEmail').timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(hour).inTimezone(TZ).create();

  var msg = 'Drive folder: ' + parent.getUrl() + '\n' +
    created + ' topic folder(s) created.\n' +
    'Shared with: ' + (shared.join(', ') || 'nobody new') + '\n' +
    'Monday email scheduled between ' + hour + ':00 and ' + (hour + 1) + ':00.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert('Hyperscout planner installed', msg, SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) {}
  return msg;
}

/* ------------------------------------------------------------------ */
/* Web app                                                             */
/* ------------------------------------------------------------------ */

function doGet() {
  var t = HtmlService.createTemplateFromFile('Index');
  return t.evaluate()
    .setTitle('Hyperscout planner')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/** Everything the page needs in one call. */
function getData() {
  var topics = readTopics_();
  var priv = readPrivateTopics_();
  var people = readPeople_().map(function (p) { return { name: p.name, email: p.email }; });
  var me = '';
  try { me = Session.getActiveUser().getEmail(); } catch (e) {}
  return {
    me: me,
    meName: nameForEmail_(me, readPeople_()),
    today: iso_(new Date()),
    topics: topics.concat(priv),
    people: people,
    workstreams: Object.keys(WORKSTREAMS),
    statuses: STATUSES,
    priorities: PRIORITIES,
    parentFolderUrl: safeParentFolderUrl_(),
    sheetUrl: SpreadsheetApp.getActive().getUrl()
  };
}

/** Create or update a topic. Returns the saved topic. */
function saveTopic(t) {
  validate_(t);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = topicsSheet_();
    var now = new Date();
    var row;
    if (t.id) {
      row = findRow_(sh, t.id);
      if (!row) throw new Error('Topic ' + t.id + ' no longer exists. Reload the page.');
    } else {
      t.id = nextId_(sh, t.workstream);
      row = sh.getLastRow() + 1;
    }
    if (!t.folder) {
      try { t.folder = createTopicFolder_(t).getUrl(); } catch (e) { Logger.log('Folder: ' + e); }
    } else {
      renameTopicFolder_(t);
    }
    var values = [[
      t.id, t.workstream, t.topic, t.owner, toDate_(t.start), toDate_(t.due),
      t.status || 'Not started', t.priority || 'Medium', t.depends || '', t.source || '',
      t.notes || '', t.folder || '', now
    ]];
    sh.getRange(row, 1, 1, COLS.length).setValues(values);
    return rowToTopic_(values[0]);
  } finally {
    lock.releaseLock();
  }
}

/** Quick status change from the list. */
function setStatus(id, status) {
  if (STATUSES.indexOf(status) < 0) throw new Error('Unknown status: ' + status);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = topicsSheet_();
    var row = findRow_(sh, id);
    if (!row) throw new Error('Topic ' + id + ' not found. Reload the page.');
    sh.getRange(row, 7).setValue(status);
    sh.getRange(row, 13).setValue(new Date());
    return true;
  } finally {
    lock.releaseLock();
  }
}

/** Remove a topic. Its Drive folder is kept and moved to "_Removed topics". */
function deleteTopic(id) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = topicsSheet_();
    var row = findRow_(sh, id);
    if (!row) return true;
    var folderUrl = sh.getRange(row, 12).getValue();
    sh.deleteRow(row);
    if (folderUrl) {
      try {
        var f = DriveApp.getFolderById(folderIdFromUrl_(folderUrl));
        f.moveTo(getOrCreateChild_(getParentFolder_(), REMOVED_FOLDER_NAME));
      } catch (e) { Logger.log('Could not move folder for ' + id + ': ' + e); }
    }
    return true;
  } finally {
    lock.releaseLock();
  }
}

/** Create the Drive folder for one existing topic (button in the app). */
function createFolderFor(id) {
  var sh = topicsSheet_();
  var row = findRow_(sh, id);
  if (!row) throw new Error('Topic ' + id + ' not found.');
  var t = rowToTopic_(sh.getRange(row, 1, 1, COLS.length).getValues()[0]);
  if (t.folder) return t.folder;
  var url = createTopicFolder_(t).getUrl();
  sh.getRange(row, 12).setValue(url);
  return url;
}

/* ------------------------------------------------------------------ */
/* Monday email                                                        */
/* ------------------------------------------------------------------ */

/**
 * Runs every Monday (trigger, as Jan). One email per person marked Monday email = Yes:
 *  - overdue topics
 *  - topics due this week, or running this week (started and not done)
 *  - next week, so nothing comes as a surprise
 *  - a short line per teammate for the team picture
 * Jan's email also includes his private topics.
 */
function sendWeeklyEmail() {
  var people = readPeople_();
  var shared = readTopics_();
  var priv = readPrivateTopics_();
  var owner = Session.getEffectiveUser().getEmail().toLowerCase();
  var appUrl = getSetting_('App URL') || '';
  var today = startOfDay_(new Date());
  var weekStart = mondayOf_(today);
  var weekEnd = addDays_(weekStart, 6);
  var nextEnd = addDays_(weekStart, 13);
  var sent = [];

  people.forEach(function (p) {
    if (!p.monday || !p.email) return;
    var isJan = p.name.toLowerCase() === 'jan' || p.email.toLowerCase() === owner;
    var pool = isJan ? shared.concat(priv) : shared;
    var mine = pool.filter(function (t) { return t.status !== 'Done' && ownsTopic_(t, p.name); });

    var b = bucket_(mine, weekStart, weekEnd, nextEnd);
    var overdue = b.overdue, thisWeek = b.thisWeek, nextWeek = b.nextWeek;
    [overdue, thisWeek, nextWeek].forEach(sortByDue_);

    var team = teamLines_(shared, people, p.name, weekStart, weekEnd);
    var subject = 'Hyperscout · week ' + weekNumber_(weekStart) + ' · ' +
      (overdue.length + thisWeek.length) + ' topic(s) for you';
    var html = emailHtml_(p.name, weekStart, weekEnd, overdue, thisWeek, nextWeek, team, appUrl);
    MailApp.sendEmail({ to: p.email, subject: subject, htmlBody: html, name: 'Hyperscout planner' });
    sent.push(p.email);
  });
  Logger.log('Monday email sent to: ' + sent.join(', '));
  return sent;
}

/**
 * Overdue  : due before this Monday.
 * This week: due by Sunday, or in progress, or starting this week.
 * Next week: starts or is due next week.
 */
function bucket_(list, weekStart, weekEnd, nextEnd) {
  var out = { overdue: [], thisWeek: [], nextWeek: [] };
  list.forEach(function (t) {
    var due = t.due ? parseIso_(t.due) : null;
    var start = t.start ? parseIso_(t.start) : null;
    if (due && due < weekStart) out.overdue.push(t);
    else if ((due && due <= weekEnd) || t.status === 'In progress' ||
             (start && start >= weekStart && start <= weekEnd)) out.thisWeek.push(t);
    else if ((start && start > weekEnd && start <= nextEnd) || (due && due > weekEnd && due <= nextEnd)) out.nextWeek.push(t);
  });
  return out;
}

function teamLines_(topics, people, exceptName, weekStart, weekEnd) {
  var lines = [];
  people.forEach(function (p) {
    if (p.name === exceptName) return;
    var open = topics.filter(function (t) { return t.status !== 'Done' && ownsTopic_(t, p.name); });
    if (!open.length) return;
    var due = open.filter(function (t) { return t.due && parseIso_(t.due) <= weekEnd; });
    var late = open.filter(function (t) { return t.due && parseIso_(t.due) < weekStart; });
    lines.push({ name: p.name, open: open.length, due: due.length, late: late.length });
  });
  return lines;
}

function emailHtml_(name, weekStart, weekEnd, overdue, thisWeek, nextWeek, team, appUrl) {
  var navy = '#132744', beige = '#ebebe1', orange = '#994214';
  var fmt = function (d) { return Utilities.formatDate(d, TZ, 'd MMM'); };
  var h = [];
  h.push('<div style="font-family:Arial,Helvetica,sans-serif;color:#1b1b1b;max-width:680px">');
  h.push('<div style="background:' + navy + ';color:#fff;padding:18px 22px">' +
    '<div style="font-size:12px;letter-spacing:1px;opacity:.8">HYPERSCOUT · WEEK ' + weekNumber_(weekStart) + '</div>' +
    '<div style="font-size:20px;font-weight:bold;margin-top:4px">Good morning ' + esc_(name) + '</div>' +
    '<div style="font-size:13px;opacity:.85;margin-top:4px">' + fmt(weekStart) + ' to ' + fmt(weekEnd) + '</div></div>');
  h.push('<div style="padding:4px 22px 18px;background:#fff">');
  h.push(section_('Overdue', overdue, '#b3261e', 'Nothing overdue.'));
  h.push(section_('This week', thisWeek, navy, 'Nothing due this week.'));
  h.push(section_('Coming up next week', nextWeek, '#5a6270', 'Nothing starting next week.'));
  if (team.length) {
    h.push('<h3 style="font-size:14px;color:' + navy + ';margin:22px 0 6px">The team</h3>');
    h.push('<table style="border-collapse:collapse;font-size:13px">');
    team.forEach(function (l) {
      h.push('<tr><td style="padding:3px 14px 3px 0;font-weight:bold">' + esc_(l.name) + '</td>' +
        '<td style="padding:3px 14px 3px 0">' + l.open + ' open</td>' +
        '<td style="padding:3px 14px 3px 0">' + l.due + ' due by Sunday</td>' +
        '<td style="padding:3px 0;color:' + (l.late ? '#b3261e' : '#5a6270') + '">' + l.late + ' overdue</td></tr>');
    });
    h.push('</table>');
  }
  if (appUrl) {
    h.push('<p style="margin:24px 0 0"><a href="' + appUrl + '" style="background:' + orange +
      ';color:#fff;text-decoration:none;padding:10px 16px;font-weight:bold;font-size:13px">Open the planner</a></p>');
  }
  h.push('</div><div style="background:' + beige + ';padding:10px 22px;font-size:11px;color:#5a6270">' +
    'Sent every Monday by the Hyperscout planner. Update a status in the app and it shows up here next week.</div></div>');
  return h.join('');
}

function section_(title, list, color, empty) {
  var h = ['<h3 style="font-size:14px;color:' + color + ';margin:22px 0 6px">' + title +
    ' <span style="font-weight:normal;color:#5a6270">(' + list.length + ')</span></h3>'];
  if (!list.length) { h.push('<p style="font-size:13px;color:#5a6270;margin:0">' + empty + '</p>'); return h.join(''); }
  h.push('<table style="border-collapse:collapse;width:100%;font-size:13px">');
  list.forEach(function (t) {
    var due = t.due ? Utilities.formatDate(parseIso_(t.due), TZ, 'EEE d MMM') : '';
    var folder = t.folder ? ' <a href="' + t.folder + '" style="color:#994214;font-size:12px">folder</a>' : '';
    h.push('<tr style="border-bottom:1px solid #eee">' +
      '<td style="padding:6px 8px 6px 0;color:#5a6270;white-space:nowrap;vertical-align:top">' + esc_(t.id) + '</td>' +
      '<td style="padding:6px 8px 6px 0;vertical-align:top">' + esc_(t.topic) +
      (t.private ? ' <span style="font-size:11px;color:#994214">private</span>' : '') + folder +
      '<div style="font-size:11px;color:#5a6270">' + esc_(t.workstream) + ' · ' + esc_(t.owner) + ' · ' + esc_(t.status) +
      (t.priority === 'High' ? ' · <b>High</b>' : '') + '</div></td>' +
      '<td style="padding:6px 0;white-space:nowrap;vertical-align:top;text-align:right">' + due + '</td></tr>');
  });
  h.push('</table>');
  return h.join('');
}

/* ------------------------------------------------------------------ */
/* Drive folders                                                       */
/* ------------------------------------------------------------------ */

function getParentFolder_() {
  var id = getSetting_('Drive parent folder ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) {
      throw new Error('You have no access to the Hyperscout Planning Drive folder. Ask Jan to share it.');
    }
  }
  var f = DriveApp.createFolder(PARENT_FOLDER_NAME);
  setSetting_('Drive parent folder ID', f.getId());
  return f;
}

function safeParentFolderUrl_() {
  var id = getSetting_('Drive parent folder ID');
  return id ? 'https://drive.google.com/drive/folders/' + id : '';
}

function createTopicFolder_(t) {
  var ws = getOrCreateChild_(getParentFolder_(), t.workstream || 'Other');
  return ws.createFolder(folderName_(t));
}

function renameTopicFolder_(t) {
  try {
    var f = DriveApp.getFolderById(folderIdFromUrl_(t.folder));
    var want = folderName_(t);
    if (f.getName() !== want) f.setName(want);
  } catch (e) { /* folder may be a link the user pasted to somewhere else; leave it */ }
}

function folderName_(t) {
  var name = (t.id + ' · ' + t.topic).replace(/[\/\\]/g, '-');
  return name.length > 90 ? name.slice(0, 87) + '...' : name;
}

function createMissingFolders_() {
  var sh = topicsSheet_();
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var rows = sh.getRange(2, 1, last - 1, COLS.length).getValues();
  var n = 0;
  rows.forEach(function (r, i) {
    if (!r[0] || r[11]) return;
    var t = rowToTopic_(r);
    sh.getRange(i + 2, 12).setValue(createTopicFolder_(t).getUrl());
    n++;
  });
  return n;
}

function getOrCreateChild_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function folderIdFromUrl_(url) {
  var m = String(url).match(/[-\w]{25,}/);
  if (!m) throw new Error('No folder ID in ' + url);
  return m[0];
}

/* ------------------------------------------------------------------ */
/* Sheet helpers                                                       */
/* ------------------------------------------------------------------ */

function topicsSheet_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(TOPICS);
  if (!sh) throw new Error('Tab "' + TOPICS + '" not found.');
  return sh;
}

function readTopics_() {
  var sh = topicsSheet_();
  var last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, COLS.length).getValues()
    .filter(function (r) { return r[0] !== ''; })
    .map(rowToTopic_);
}

function readPrivateTopics_() {
  var id = getSetting_('Private planning file ID');
  if (!id) return [];
  try {
    var sh = SpreadsheetApp.openById(id).getSheetByName(PRIVATE_TAB);
    if (!sh || sh.getLastRow() <= PRIVATE_HEADER_ROW) return [];
    var n = sh.getLastRow() - PRIVATE_HEADER_ROW;
    return sh.getRange(PRIVATE_HEADER_ROW + 1, 1, n, 11).getValues()
      .filter(function (r) { return r[0] !== ''; })
      .map(function (r) {
        var t = rowToTopic_(r.concat(['', '']));
        t.private = true;
        return t;
      });
  } catch (e) {
    return []; // not Jan, or file unreachable: no private topics
  }
}

function rowToTopic_(r) {
  var t = {};
  COLS.forEach(function (c, i) { t[c] = r[i]; });
  t.start = iso_(t.start);
  t.due = iso_(t.due);
  t.updated = iso_(t.updated);
  ['id', 'workstream', 'topic', 'owner', 'status', 'priority', 'depends', 'source', 'notes', 'folder']
    .forEach(function (k) { t[k] = t[k] == null ? '' : String(t[k]); });
  t.private = false;
  return t;
}

function findRow_(sh, id) {
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
  return 0;
}

function nextId_(sh, workstream) {
  var prefix = WORKSTREAMS[workstream] || 'O';
  var max = 0;
  var last = sh.getLastRow();
  if (last >= 2) {
    sh.getRange(2, 1, last - 1, 1).getValues().forEach(function (r) {
      var m = String(r[0]).match(new RegExp('^' + prefix + '(\\d+)$'));
      if (m) max = Math.max(max, Number(m[1]));
    });
  }
  // private IDs share the numbering so they never collide
  readPrivateTopics_().forEach(function (t) {
    var m = String(t.id).match(new RegExp('^' + prefix + '(\\d+)$'));
    if (m) max = Math.max(max, Number(m[1]));
  });
  var n = max + 1;
  return prefix + (n < 10 ? '0' + n : n);
}

function readPeople_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(PEOPLE);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues()
    .filter(function (r) { return r[0]; })
    .map(function (r) {
      return { name: String(r[0]).trim(), email: String(r[1]).trim(), monday: /^y/i.test(String(r[2])) };
    });
}

function nameForEmail_(email, people) {
  if (!email) return '';
  var e = email.toLowerCase();
  for (var i = 0; i < people.length; i++) if (people[i].email.toLowerCase() === e) return people[i].name;
  if (e === 'janbrabers@gmail.com') return 'Jan';
  return '';
}

function getSetting_(key) {
  var sh = SpreadsheetApp.getActive().getSheetByName(SETTINGS);
  if (!sh) return '';
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) if (String(rows[i][0]).trim() === key) return String(rows[i][1]).trim();
  return '';
}

function setSetting_(key, value) {
  var sh = SpreadsheetApp.getActive().getSheetByName(SETTINGS);
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === key) { sh.getRange(i + 1, 2).setValue(value); return; }
  }
  sh.appendRow([key, value, '']);
}

/* ------------------------------------------------------------------ */
/* Small utilities                                                     */
/* ------------------------------------------------------------------ */

function ownsTopic_(t, name) {
  var n = String(name).toLowerCase();
  return String(t.owner).split(/[+\/,&]| and /i).some(function (o) { return o.trim().toLowerCase() === n; });
}

function validate_(t) {
  if (!t || !String(t.topic || '').trim()) throw new Error('A topic needs a description.');
  if (!t.workstream) throw new Error('Pick a workstream.');
  if (!String(t.owner || '').trim()) throw new Error('A topic needs an owner.');
  if (t.status && STATUSES.indexOf(t.status) < 0) throw new Error('Unknown status.');
  if (t.start && t.due && t.start > t.due) throw new Error('Due date is before the start date.');
}

function iso_(v) {
  if (!v) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return isNaN(v.getTime()) ? '' : Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  }
  return String(v);
}

function parseIso_(s) {
  var m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

function toDate_(s) { return s ? parseIso_(s) : ''; }

function startOfDay_(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

function mondayOf_(d) {
  var day = d.getDay(); // 0 = Sunday
  return addDays_(startOfDay_(d), day === 0 ? -6 : 1 - day);
}

function addDays_(d, n) { var x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; }

/** ISO 8601 week number (weeks start on Monday). */
function weekNumber_(d) {
  var x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  var day = x.getUTCDay() || 7;
  x.setUTCDate(x.getUTCDate() + 4 - day);
  var yearStart = new Date(Date.UTC(x.getUTCFullYear(), 0, 1));
  return Math.ceil(((x - yearStart) / 86400000 + 1) / 7);
}

function sortByDue_(list) {
  list.sort(function (a, b) { return String(a.due || '9999').localeCompare(String(b.due || '9999')); });
}

function esc_(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
