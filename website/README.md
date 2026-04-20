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

Workflow already exists at [`.github/workflows/pages.yml`](../.github/workflows/pages.yml). One-time setup:

1. **Enable Pages**: Repo → **Settings → Pages → Source: GitHub Actions**
2. **Trigger**: automatic on any push to `master` that touches `website/**` or the workflow file itself. Also supports manual runs via **Actions → Deploy landing page → Run workflow**
3. **URL**: `https://heytalepazguato.github.io/event-horizon/` once the first deploy completes

The workflow triggers on `master` only (not `develop`), so the live site always reflects shipped state. To deploy sooner without waiting for a release merge, use the `workflow_dispatch` manual trigger from the Actions tab.

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
