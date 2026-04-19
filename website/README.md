# Event Horizon — Landing Page

Static HTML/CSS landing page for [eventhorizon.dev](#) (or wherever you host it).

## Local preview

Any static server works. Easy options:

```bash
# Python
python -m http.server --directory website 8000

# Node
npx --yes serve website
```

Then open <http://localhost:8000>.

## Deploying to GitHub Pages

The folder is ready to serve as-is. Pick one:

**Option A — Pages from `master` branch, `/website` folder (simplest):**

GitHub Pages only serves from the repo root or `/docs`. To serve from `/website`, add a tiny GitHub Actions workflow that publishes the folder to the `gh-pages` branch on each push to `master`:

```yaml
# .github/workflows/pages.yml
name: Deploy landing page
on:
  push:
    branches: [master]
    paths: ['website/**']
permissions:
  contents: read
  pages: write
  id-token: write
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: ./website
      - id: deployment
        uses: actions/deploy-pages@v4
```

Then in **Settings → Pages**, set the source to **GitHub Actions**.

**Option B — Manual copy to `/docs`:** If you don't want Actions, rename the folder to `/docs` and set Pages source to "Deploy from a branch → master → /docs". But `/docs` is already used for engineering documentation, so Option A is cleaner.

## Custom domain (later)

Register `eventhorizon.dev` or similar → set up `CNAME` file in this folder with the domain → add DNS records per [GitHub's docs](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site).

## What's in here

- `index.html` — single-page, semantic HTML, dark cosmic theme
- `style.css` — hand-written CSS (no Tailwind, no build step)
- No JavaScript — the page is fully functional with JS disabled

## TODO once Phase B' assets exist

- Drop the hero GIF/still (`demo2.gif` or the Universe hero still) under `.hero-inner` after the badge row
- Add the Kanban screenshot to the features section
- Embed the lightning GIF next to the "A universe you can read" feature card
