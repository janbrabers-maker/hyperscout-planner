# Hyperscout planner

A small web app on top of the Google Sheet **Hyperscout Topics (planner app)**.

- **This week**: what is overdue, due or running this week, per person or for the whole team
- **People**: one card per person with status mix, overdue count and open topics
- **All topics**: search and filter, add, edit or remove topics, change status in one click
- **Drive**: every topic gets its own folder under *Hyperscout Planning / <workstream> / <ID · topic>*, linked from the app and the email. The *Open Drive folder* button in the app header opens *Hyperscout Planning* itself
- **Daily email**: every work day (Monday to Friday) in the early morning (Amsterdam), one email per person marked *Yes* in the email column of the People tab: overdue, today, rest of this week, next week, and a one-line view of the rest of the team

Built with Google Apps Script, bound to the sheet. No server, no hosting cost.

## Where things live

| What | Where | Who can open it |
|---|---|---|
| Topics, People, Settings | Google Sheet *Hyperscout Topics (planner app)* | Jan, Richard |
| Topic folders | Drive folder *Hyperscout Planning* | Jan, Richard |
| Private topics, Finance, HR, Tax, Decisions & flags | Google Sheet *Hyperscout Private Planning (Jan only)* | Jan only |
| Code | this repo, `apps-script/` | Jan (and Richard if invited) |

The app runs as **the person who opens it**. Richard only sees what his Google account can open, so Jan's private topics never reach him. Jan sees them in the app (read-only, marked *private*) and in his daily email.

## Install (once, about 5 minutes)

1. Open the sheet *Hyperscout Topics (planner app)*.
2. **Extensions > Apps Script**. Delete the sample `Code.gs` content.
3. Copy `apps-script/Code.gs` into `Code.gs`. Add an HTML file named `Index` and copy `apps-script/Index.html` into it.
4. **Project Settings** (gear icon) > tick *Show "appsscript.json" manifest file* > open it and replace it with `apps-script/appsscript.json`.
5. Save. Reload the sheet. A **Hyperscout** menu appears.
6. **Hyperscout > Install: folders, sharing, daily email**. Approve the permissions (Google warns the app is unverified because it is your own; click *Advanced > Go to Hyperscout planner*). This creates the Drive folders, shares the sheet and folder with Richard and schedules the daily email (it runs every day and skips Saturday and Sunday).
7. In Apps Script: **Deploy > New deployment > Web app**. Execute as: *User accessing the web app*. Who has access: *Anyone with a Google account*. Deploy and copy the URL.
8. Paste that URL in the sheet, tab **Settings**, row *App URL*. The daily email links to it.
9. Test: **Hyperscout > Send the daily email now (test)**.

The first time Richard opens the app, Google asks him to approve it once.

## Day to day

- Add, edit or remove topics in the app, or straight in the sheet. Both stay in sync because the sheet is the database.
- Removing a topic keeps its Drive folder; it moves to *Hyperscout Planning / _Removed topics*.
- New person in the email: add a row on the People tab with *Yes* in the email column, then run *Install* again to share the files with them.
- Different email time: change *Email hour (Amsterdam)* on the Settings tab and run *Install* again.
- Topics you added straight in the sheet get their folder via *Hyperscout > Create missing Drive folders* (or the folder button in the app).

## Rules the email and the "This week" view use

- **Overdue**: due before today and not Done.
- **Today**: due today (email only; the app shows these under This week).
- **This week**: due by Sunday, or *In progress*, or starting this week.
- **Next week**: starts or is due next week.
- Owners like `Jan + Richard` or `Abdul / Tezeract` count for each name.

## Deploy from GitHub (optional)

`.github/workflows/deploy.yml` pushes `apps-script/` to Apps Script on every push to `main`, using clasp:

1. On your computer: `npm i -g @google/clasp`, `clasp login`, then copy the content of `~/.clasprc.json`.
2. Repo **Settings > Secrets and variables > Actions**: add `CLASPRC_JSON` (that content) and `SCRIPT_ID` (Apps Script > Project Settings > Script ID).
3. Enable the Apps Script API at https://script.google.com/home/usersettings.

After a push, the code is updated. Re-deploying the web app version is one click in Apps Script (**Deploy > Manage deployments > Edit > New version**), or add `clasp deploy -i <deploymentId>` to the workflow.

## Claude page (no install needed)

`claude-page/hyperscout-planner.html` is the same planner published as a Claude page. It reads and writes the topics sheet through the viewer's own Google Sheets and Google Drive connectors in Claude, so it needs no Apps Script install and no Google sign-in in a browser. The email runs as a Claude scheduled task ("Hyperscout daily planning email", Monday to Friday 07:27 Amsterdam) instead of the Apps Script trigger. Use one or the other, not both, or everyone gets the email twice.
