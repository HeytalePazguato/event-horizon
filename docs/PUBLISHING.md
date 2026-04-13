# Publishing Event Horizon

Event Horizon ships to two extension marketplaces. CI owns both publish flows — contributors do not run publish commands. This document explains the token setup, namespace ownership, manual fallback, and verification for each.

## 1. VS Code Marketplace

Microsoft's marketplace (`marketplace.visualstudio.com`) is the primary surface for VS Code and covers Visual Studio Code installs exclusively.

- **Publisher**: `HeytalePazguato`
- **Personal Access Token**: generated at https://dev.azure.com/ under a member of the publisher's organization. Scope: **Marketplace > Manage** (All accessible organizations).
- **Repo secret**: `VSCE_PAT` (GitHub → Settings → Secrets and variables → Actions).
- **CI step**: the `release` job in `.github/workflows/ci.yml` runs `npx @vscode/vsce publish --no-dependencies --packagePath *.vsix` when a push to `master` produces a new tag.
- **Pre-releases**: the `package-prerelease` job packages the VSIX with `--pre-release` for every push to `release/*` branches, but does not publish pre-releases to the VS Code Marketplace (only GitHub Releases and Open VSX).

## 2. Open VSX Registry

Open VSX (`open-vsx.org`) is the vendor-neutral marketplace that powers Cursor, VSCodium, Windsurf, Gitpod, Eclipse Theia, Coder / code-server, and every other VS Code fork. A single Open VSX publish reaches all of them.

Step-by-step setup for the `HeytalePazguato` namespace:

1. **Sign in** at https://open-vsx.org with the `HeytalePazguato` GitHub account.
2. **Claim the namespace** — open a namespace-claim issue at https://github.com/EclipseFdn/open-vsx.org/issues/new/choose and select the **"Claim Namespace Ownership"** template. Fill in `HeytalePazguato` as the namespace. An Eclipse Foundation maintainer will approve the claim once the publisher agreement is signed.
3. **Sign the Eclipse Publisher Agreement** at https://open-vsx.org/user-settings/namespaces. The namespace becomes writable after signing.
4. **Generate an access token** at https://open-vsx.org/user-settings/tokens. Copy the token value once — it is not shown again.
5. **Store the token** as the repo secret `OVSX_PAT` (GitHub → Settings → Secrets and variables → Actions → New repository secret).
6. **CI step** — the `release` job in `.github/workflows/ci.yml` runs `Publish to Open VSX` after the VS Code Marketplace publish on pushes to `master`. It uses `continue-on-error: true`, so an expired or missing `OVSX_PAT` never blocks the primary GitHub Release or the VS Code Marketplace publish. Open VSX gets stable releases only — pre-release testing happens by installing the VSIX from the GitHub pre-release page (see "Manual publish fallback" below), because Open VSX rejects duplicate version numbers and we use the same `X.Y.Z` for a release branch's alphas/betas/rcs and its eventual stable tag.

## 3. Manual publish fallback

If CI is unavailable or `OVSX_PAT` needs to be rotated, publish by hand from a local checkout:

```bash
cd apps/vscode
pnpm run package:vsix
npx ovsx publish *.vsix -p "$OVSX_PAT"
```

For a pre-release VSIX, append `--pre-release`:

```bash
npx ovsx publish *.vsix --pre-release -p "$OVSX_PAT"
```

The VS Code Marketplace equivalent uses `vsce` and `$VSCE_PAT`:

```bash
npx @vscode/vsce publish --no-dependencies --packagePath *.vsix
```

## 4. Verifying the publish

After CI (or a manual publish) completes:

- **Open VSX**: visit https://open-vsx.org/extension/HeytalePazguato/event-horizon-vscode and confirm the listed version matches `apps/vscode/package.json`. Pre-releases are labelled with their `-alpha.N` / `-beta.N` / `-rc.N` suffix.
- **VS Code Marketplace**: visit https://marketplace.visualstudio.com/items?itemName=HeytalePazguato.event-horizon-vscode and confirm the version number and the **Last updated** timestamp.
- **Install smoke test**: install the extension in the target editor (VS Code, Cursor, VSCodium, etc.), open the Event Horizon panel, and confirm the Universe renders without activation errors.
