# Nourishly — Minimal Family Meal Planner

An English-language frontend MVP for family meal planning. The brand name is a temporary placeholder.

## Requirements
- Node.js LTS (20.19+ or 22+)
- VS Code
- Git and GitHub account

## Run locally
1. Open **this folder** in VS Code (the folder that contains `package.json`).
2. Open Terminal → New Terminal.
3. `npm install`
4. `npm run dev`
5. Open the address displayed by Vite (usually `http://localhost:5173`).
6. Check production compilation: `npm run build` (creates `dist/`).

## Upload to GitHub
1. Sign in to GitHub in a browser.
2. In VS Code choose Source Control → Initialize Repository.
3. Stage all files (`+`), type `Initial frontend`, click Commit.
4. Choose Publish Branch / Publish to GitHub, authorize VS Code, select Public or Private.
5. Check your GitHub repo contains `package.json` and `src/`.

If the Git author identity is requested, run:
```
git config --global user.name "Your Name"
git config --global user.email "your-github-email@example.com"
```

## Deploy to Netlify
1. Sign in at https://app.netlify.com
2. Add new project → Import an existing project → GitHub.
3. Authorize Netlify and select the repository.
4. Base directory: leave empty if `package.json` is at the repository root.
5. Build command: `npm run build`.
6. Publish directory: `dist`.
7. Deploy. After successful build, Netlify supplies a public URL.
8. To update, edit files in VS Code, Commit, then Sync Changes/Push. Netlify rebuilds automatically.

`netlify.toml` includes the build settings and a fallback route. Do not upload `node_modules/`, `.env` files, or `dist/` to GitHub.

## Pages
- Profile — household and monthly USD budget; editable members
- Weekly menu — seven days × five meals; per-person calories/macros and household estimated expenses
- Recipes — meal categories, recipe details, hand-entered custom recipes
- Meal prep — suggested quantities and general prep/storage tips
- Grocery list — ingredient aggregation, pantry quantities, approximate cost, manually entered receipt totals and download

## Honest MVP limitations
- No user accounts or live store pricing. AI features (Gemini free tier via Netlify Functions): budget week planning, recipe by dish name, screenshot/photo to recipe, video to recipe (YouTube link or a short uploaded video) and receipt scanning.
- Menu data and food prices are illustrative, not verified nutritional/medical advice or live prices.
- Allergy warnings rely on simple text matching and cannot ensure food safety.
- Local browser storage is used, so data is per browser/device and is lost when its site data is cleared.
- Receipt expenses are a separate log, not automatically reconciled with individual ingredient purchases.
- Photos are hosted on Unsplash and require internet connectivity.

## Rename the brand later
Search for `Nourishly` and `nourishly` in VS Code (Ctrl+Shift+F). Change visible text, page title and description, then run `npm run build`.

## Change meals (updated)
1. Open **Weekly menu**. Click an existing meal card or the + in an empty cell.
2. Choose a recipe from the matching meal category in the dialog; the choice replaces that cell immediately.
3. Alternatively open **Recipes**, select a recipe, click **Add to weekly plan**, select the day, and click the matching meal slot.
4. Calories, macros, planned meal cost and grocery ingredients recalculate and are saved in local browser storage.
5. For a site that is already deployed, replace `src/main.jsx` and `src/style.css` from this archive in your existing project, then Commit and Push.

## AI recipe generator (free Gemini API)
Recipes → **AI recipe ideas** / **AI recipe**: type a dish name, the AI drafts the recipe, you review it in the form and save.

## Budget planning
On **Weekly menu** the budget banner has two buttons:
- **Fit to budget** (instant, no AI): re-picks meals from the recipe library so the week fits the budget, skipping allergies/dislikes, preferring liked foods and keeping variety (`src/planner.js`). **Undo** restores the previous plan.
- **AI budget week**: AI creates 14 new budget recipes for the family (budget per serving = weekly budget ÷ people ÷ 35 meals, plus allergies, dislikes, likes, health notes and optional wishes), adds them to Recipes and fills all 35 meals within the budget (`netlify/functions/plan-week.mjs`).

Also powered by the same key:
- **Recipes → Screenshot**: upload a screenshot of a recipe (post, website, cookbook page) or a photo of a dish.
- **Recipes → Video / reel**: paste a public YouTube / Shorts link, or upload a short video file (max 4 MB ≈ 15–30 s). TikTok and Instagram links can't be read directly — save the video and upload the file.
- **Grocery list → Scan receipt with AI**: upload a receipt photo; AI reads the total and you confirm it before it is added to expenses.

Files are limited to 4 MB because Netlify Functions accept at most 6 MB per request; photos are resized in the browser automatically.

1. Get a free key at https://aistudio.google.com/apikey
2. **Locally:** create a `.env` file in the project root (it is git-ignored) with `GEMINI_API_KEY=your-key`, then `npm run dev`.
3. **Netlify:** Site configuration → Environment variables → add `GEMINI_API_KEY`, then redeploy.
4. Optional: `GEMINI_MODEL` to pick a model. By default the app uses `gemini-flash-lite-latest` (fast, current Flash-Lite) and falls back to `gemini-flash-latest` if it is busy, retired or times out.

The key stays on the server (`netlify/functions/`, shared code in `netlify/lib/gemini.mjs`), never in the browser. The free tier has per-minute/per-day limits; when reached, the app shows "Free AI limit reached". Nutrition and cost are AI estimates.
