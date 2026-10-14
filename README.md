# 🎯 Bullseye Board — all branches

Route health for technicians and salespeople, one page per branch: stops completed, cancel %, void %, net gain, and sales against budget. Bullseye Bill adds a short note for the branch and every tech.

Static website (HTML, CSS, JavaScript). No build step, no server code. Runs on GitHub Pages.

## Pages

| Branch | Link |
|---|---|
| Tucson (TUC) | `…/Bullseye-Board-TUC/tuc/` (the old link `…/Bullseye-Board-TUC/` redirects here) |
| Phoenix (PHX) | `…/Bullseye-Board-TUC/phx/` |
| Phoenix West (PXW) | `…/Bullseye-Board-TUC/pxw/` |
| Palm Desert (PMD) | `…/Bullseye-Board-TUC/pmd/` |
| San Diego (SDG) | `…/Bullseye-Board-TUC/sdg/` |
| **DSW District** (month-end outlook for managers) | `…/Bullseye-Board-TUC/dsw/` |

**Updating every branch:** open `…/tuc/?admin`. That is the only page with update mode.

## Folder layout

```
index.html        redirects to tuc/ (keeps the original link working)
branches.json     every branch: report code, Employment List location, name, theme, name fixes; plus theme colors and repo
js/app.js         shared engine for every branch
css/styles.css    shared look; each branch's colors come from branches.json
assets/           header picture and Bullseye Bill (shared)
tuc/ phx/ pxw/ pmd/ sdg/
   index.html     the branch page
   board.json     that branch's numbers (written by Publish all branches)
```

## DSW District board

`dsw/` shows every branch's month-end projections in tiles: sales to budget, route completion, cancel %, void %, net gain and business valuation, plus a district total. Projections carry each running total forward at the current pace (workdays done ÷ workdays in the month, holidays excluded). It reads the same branch files the branch boards use, so it updates with **Publish all branches**. Multi-branch DOR and BV exports land on the district board automatically.

## Projections

The district board's month-end numbers blend the current pace with each branch's last 3 years for that month (scaled to how this year is running); early in a month history carries more weight, by the last week it's almost all actual. Year-end tiles add the closed months, this month's projection and each remaining month on the same trend, against the FY budget plan. Working days come from the FY budget plan. History is stored in each branch's board.json, so it never needs uploading again; the daily year-to-date uploads keep the current year current and roll into history as the year turns.

## One-time setup

1. Upload this folder's contents to the repo (keep the folders). Delete the old `data` folder.
2. Settings → Pages stays: Deploy from a branch, `main`, `/ (root)`.
3. Create a publishing key: GitHub → your picture → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token. Repository access: only this repository. Permissions: **Contents: Read and write**. Nothing else.
4. Open `…/tuc/?admin`, click **Publish all branches** (or **GitHub key**) and paste the key. It is stored only in that browser.

## Updating

1. Export reports **with all branches included** (remove the TUC filter). Every report has a Branch column; the Employment List has Location.
2. On `…/tuc/?admin`: **Upload reports**, select the files, **Save to board**. Each file is split by branch automatically and the summary shows what landed where.
3. Use the **Branch** menu to look at any branch, set its salesperson budgets, or move people on or off its board. Holidays apply to every branch.
4. Click **Publish all branches**. Every changed branch is saved to GitHub in one commit; pages update in a minute or two.

**Download all (.zip)** is the backup if publishing isn't available: unzip and drag the branch folders into the repo.

### Reports

| Report | Source | Settings | When |
|---|---|---|---|
| Cancel Detail | Power BI | All branches, year to date | Each update |
| Sales Details | Power BI | All branches, year to date | Each update |
| Route Completion Details | Power BI | All branches, current month | Each update + once after month end |
| Open Orders | PestPac | All branches, work dates through month end | 1st of each month |
| Service Setup List (customer list) | PestPac | One export per branch (files are large) | Monthly |
| Employment List | HR | All locations | When people are hired, termed or change roles |
| DOR Sales Budget | Power BI (DOR) | One branch per export for branch boards; an all-branch export feeds the district total | When budgets change |
| Business Valuation | Power BI | **Current month only** (all branches → district, or one branch per export) | Start of each month |
| FY budget plan (Sales Trend Tracker) | Finance | The year's CSV | Once a year, when the new budget is out |
| History (one time) | Power BI | 3-year Sales Details and 3-year Cancel Detail exports (same formats as the daily ones) | Once; after that the daily uploads keep it rolling |

Re-uploading is safe: year-to-date files replace the months they cover, and duplicates are removed every time.

## Settings

`branches.json`:
- `branches[]`: `code` (as in the reports), `location` (as on the Employment List), `name`, `theme` (`r` or `p`), `aliases` (PestPac name changes, old → new, lowercase `last|first`), `forceMain` (people whose numbers always go to the branch total).
- `themes`: colors for each theme (`brand`, `brand-soft`, `brand-ink`, `gold`).
- `admin`: the branch whose page has update mode. `repo` / `gitBranch`: where Publish saves.

`js/app.js` (shared by every branch):
- `TARGET`: monthly goals (98.5% of stops completed; cancel % up to 1.7% of the book in annual dollars; void % up to 1.5% of total stops).
- `SCORE_MAX` / `SCORE_WEIGHTS`: tech ranking, 160 points: route completion 80 (completion rate 53 + workload 27, workload never shown), cancel % 40, void % 29, net gain 11.
- `COMPANY_HOLIDAYS`: holidays left out of workday pacing (2026 built in; add more under **Holidays** in update mode).
- `START_MONTH`: first month in the month picker.

## ⚠️ Privacy

GitHub Pages sites are public. Customer names are left out of every board.json unless **Include customer names** is ticked before publishing; leave it unticked. Raw spreadsheets are blocked by `.gitignore`. Never share the publishing key; if it leaks, delete it in GitHub and make a new one.

## Run locally

```
python3 -m http.server 8000
```
Open http://localhost:8000/tuc/ (or /tuc/?admin).
