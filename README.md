# 🎯 Bullseye Board

Tucson route health for technicians and salespeople: stops completed, cancel + void %, net setups, and sales against goal. Bullseye Bill adds a short note for the branch and for every tech.

It's a static website (HTML, CSS and JavaScript, no build step and no server code), so it runs on GitHub Pages or any web host.

## How it works

- **Viewers** open the site. It loads `data/board.json` and shows the board. Nothing can be changed.
- **You update it** by opening the site with `?admin` at the end of the address. Upload your reports, then click **Download board.json** and commit that file to `data/board.json`. GitHub Pages republishes in a minute or two, and everyone sees the new numbers next time they open the link. Open tabs refresh themselves when someone comes back to them after 10 minutes.

All report reading happens in your browser. The raw spreadsheets are never uploaded anywhere.

## Folder layout

```
index.html        page markup
css/styles.css    look and feel (Bullseye Bill theme)
js/app.js         everything else: report parsing, scoring, rankings, Bill's notes
assets/hero.jpg   header picture with the Bullseye Board sign
assets/bill.jpg   Bill's avatar
data/board.json   the numbers the site shows (replace this to update)
.nojekyll         tells GitHub Pages to serve the files as they are
```

## Put it on GitHub Pages

1. Create a new repository on GitHub, for example `bullseye-board`.
2. Upload everything in this folder (keep the folder structure). On github.com: **Add file → Upload files**, drag the folder contents in, then **Commit changes**.
3. Go to **Settings → Pages**. Under **Build and deployment**, choose **Deploy from a branch**, branch `main`, folder `/ (root)`, and save.
4. After a minute the site is live at `https://<your-user>.github.io/bullseye-board/`. Post that link in Teams.
5. Add your current numbers: replace `data/board.json` with the `board.json` file that came with this project (see "Updating the numbers").

On a phone, open the link and choose **Add to Home Screen** for an app icon.

## Updating the numbers

1. Open `https://<your-user>.github.io/bullseye-board/?admin`.
2. Click **Upload reports** and select your exports (several at once is fine). Each report is recognized automatically. Click **Save to board**.
3. Set sales goals or move people on or off the board if needed.
4. Click **Download board.json**.
5. On GitHub, open the `data` folder, choose **Add file → Upload files**, drop in the new `board.json` (it replaces the old one), and commit.

The admin page starts from whatever `data/board.json` is live, so you only upload what changed. **Open board.json** lets you start from a file on your computer instead.

### Reports

| Report | Source | Settings | When |
|---|---|---|---|
| Cancel Detail | Power BI | TUC, year to date | Before each update |
| Sales Details | Power BI | TUC, year to date | Before each update |
| Route Completion Details | Power BI | TUC, current month | Before each update, plus once after month end |
| Open Orders (Service Order List) | PestPac | TUC, work dates through month end | 1st of each month |
| Service Setup List (customer list) | PestPac | TUC, status Active or Both | Monthly |
| Employment List | HR | Any (only Tucson is used) | When people are hired, termed or change roles |

Re-uploading is safe: year-to-date files replace the months they cover, and duplicate invoices, orders and setups are removed every time.

## ⚠️ Privacy

**GitHub Pages sites are public.** Anyone with the link can see them, even if the repository is private (only GitHub Enterprise Cloud can restrict Pages to signed-in users). The `?admin` page is not password protected either; it can only change what's in that person's own browser, never the published data.

- `board.json` holds technician names, location numbers, cancel reasons and sales figures. Customer names are **left out** unless you tick **Include customer names** before downloading. Leave it unticked for a public site.
- `.gitignore` blocks spreadsheet files so raw exports never get committed by accident.
- Search engines are asked not to index the site (`noindex`).
- Check with your manager or IT before publishing company numbers. For a login-protected version, the same files can sit behind Cloudflare Access (free for up to 50 users) or any company-approved internal web host.

## Settings in the code

Near the top of `js/app.js`:

- `BRANCH` / `LOCATION`: which branch and employee location to include (`TUC` / `Tucson`).
- `START_MONTH`: first month in the month picker (year to date always uses the whole year).
- `TARGET`: monthly goals (98.5% of stops completed; cancel + void under 1.5%).
- `ALIASES`: PestPac name changes, old name to current name (for example Weisner to Voss).
- `FORCE_MAIN`: people whose numbers always go to the main branch total (for example Bill Harmon).

## Run it on your computer

Browsers block a page opened straight from a file from loading `data/board.json`, so serve the folder:

```
cd bullseye-board
python3 -m http.server 8000
```

Then open http://localhost:8000 (or http://localhost:8000/?admin).
