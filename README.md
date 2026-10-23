# 🎯 Bullseye Board

Route health for technicians and salespeople, one page per branch, plus a **DSW District** outlook for branch managers and above. Bullseye Bill adds a short note for each branch and tech.

Static website (HTML, CSS, JavaScript) on GitHub Pages. No build step, no server code.

## Pages

| Page | Link | Who it's for |
|---|---|---|
| Tucson (TUC) | `…/Bullseye-Board-TUC/tuc/` (the old root link redirects here) | Techs and salespeople |
| Phoenix (PHX) | `…/phx/` | Techs and salespeople |
| Phoenix West (PXW) | `…/pxw/` | Techs and salespeople |
| Palm Desert (PMD) | `…/pmd/` | Techs and salespeople |
| San Diego (SDG) | `…/sdg/` | Techs and salespeople |
| **DSW District** | `…/dsw/` | Branch managers and above |
| **Update page** | `…/tuc/?admin` | You (the only page that can upload and publish) |

## Daily update

Open a **fresh** `tuc/?admin` tab, upload, click **Save to board**, then **Publish all branches**. Close the tab when you're done.

**Every morning** (all branches in each export):
1. Route Completion Details: current month
2. Cancel Detail: year to date
3. Sales Details: year to date
4. Backlog (BL): current snapshot

**1st of each month, add:**
- Route Completion Details for the month that just ended (final pull)
- Business Valuation: current month only, one file per branch (or one file with BranchName on rows)
- Service Setup List (customer list): one per branch, detailed column layout
- Open Orders: optional; only used until the first route report of the month

**Only when needed:**
- Employment List: hires, terms, role changes
- DOR Sales Budget: PXW only, until it's in the budget plan
- Holidays: next year's dates (Holidays button)
- FY budget plan (Sales Trend Tracker CSV): once a year

**One-time history (already loaded; re-upload only to correct it):** 3-year Sales Details, 3-year Cancel Detail, branch BV for Oct and Dec of last year, revenue history (Branch × Period summary). History is stored in each branch's `board.json` and rolls forward with the daily uploads.

## How the numbers work

**Goals:** 98.5% of stops completed; cancel % up to 1.7%; void % up to 1.5%.

| Measure | Calculation |
|---|---|
| Stops / completion | Every order on the route completion report (current route assignments), excluding not-started sales and acquisition voids. Matches Power BI's Route Completion by Technician |
| Void % | Voided orders ÷ total orders (unit count), including orders voided because the customer cancelled |
| Cancel % | Annual $ cancelled ÷ active annual $ on the book at the start of the month (company Net Gain method). Falls back to cancels ÷ stops when a branch has no customer list |
| Net gain | Customers started − cancelled. Tech rows and the district tiles show customers; the branch tile shows dollars |
| Sales vs. budget | Sales Details + backlog pending this month, against the FY budget plan (DOR for PXW) |
| Pacing | Workdays done ÷ the company's working days for the month (from the budget plan; holidays excluded) |

**Backlog** (sold, not completed yet) is counted in sales totals but drawn **dashed**, because a customer can back out or the work can slip to next month.

**Tech ranking:** 160 points a month. Route completion 80 (completion rate 53 + workload 27; workload is never shown), cancel % 40, void % 29, net gain 11. Each piece ranks techs against their own branch.

## DSW District projections

- **Month end:** so far ÷ workdays complete × workdays in the month (company working-day counts). Sales can't project below completed + pending backlog. Route completion can't project above 100% minus projected voids.
- **Year end:** year to date ÷ workdays complete this year × workdays in the year, against the FY budget plan. A branch that joined mid-year (PXW) starts its pace at its first full month.
- **3-yr trend** figures on the tiles are a cross-check only: the preceding years' average for that month (scaled to this year), not part of the projection.
- **Growth (FY vs last FY):** three bars on a fixed, labeled scale — sales (same branches only), business valuation (projected Dec 31 vs last Dec 31), revenue (full year once last year is complete; until then the same closed months in both years).
- **Branches without a prior year (PXW):** growth compares this month's projected daily pace with its first full month (sales, revenue) and the book now vs the start of that month (BV), labeled "since …", until a full year has built up.

## Folder layout

```
index.html        redirects to tuc/
branches.json     branches + district: report code, Employment List location, name, theme, name fixes; theme colors; repo
js/app.js         shared engine for every page
css/styles.css    shared look
assets/           header picture and Bullseye Bill
tuc/ phx/ pxw/ pmd/ sdg/ dsw/
   index.html     the page
   board.json     that page's numbers and history (written by Publish all branches)
```

## Publishing and safety

- **Publish all branches** saves every changed branch to GitHub in one commit using a fine-grained token (Contents: Read and write, this repo only), stored only in your browser. **Download all (.zip)** is the backup.
- With a key saved, the update page loads numbers **straight from GitHub** (the banner shows when).
- Publishing is **blocked** if anything was published after the page loaded its numbers, so an old tab can't overwrite newer data. Reload and upload again if you see that message.
- The pages load the newest code on every visit; no cache clearing needed.

## Settings

`branches.json`: per branch `code`, `location`, `name`, `theme` (`r` green/gold, `p` navy/orange), `aliases` (PestPac name changes, old → new), `forceMain` (always counted in the branch total). `district` defines the DSW page. `admin` is the branch whose page has update mode.

`js/app.js` (top of file): `TARGET` goals, `SCORE_MAX` / `SCORE_WEIGHTS`, `COMPANY_HOLIDAYS`, `START_MONTH`.

## ⚠️ Privacy

GitHub Pages sites are public. Customer names are left out unless **Include customer names** is ticked before publishing; leave it unticked. Raw spreadsheets are blocked by `.gitignore`. Never share the publishing key; if it leaks, delete it in GitHub and make a new one.

## Run locally

```
python3 -m http.server 8000
```
Open http://localhost:8000/tuc/ (or /dsw/, or /tuc/?admin).
