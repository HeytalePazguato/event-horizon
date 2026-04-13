# Marketplace Coverage

Event Horizon is distributed via two marketplaces: the **VS Code Marketplace** for Microsoft's Visual Studio Code, and the **Open VSX Registry** for every other compatible editor (Cursor, VSCodium, Windsurf, Gitpod, Eclipse Theia, Coder / code-server, and other VS Code forks). Both listings are driven by the same VSIX artifact and CI automation — there is a single source of truth in this repo.

## Editor → marketplace matrix

| Editor | Marketplace | Repo secret |
|--------|-------------|-------------|
| VS Code | VS Code Marketplace | `VSCE_PAT` |
| Cursor | Open VSX | `OVSX_PAT` |
| VSCodium | Open VSX | `OVSX_PAT` |
| Windsurf | Open VSX | `OVSX_PAT` |
| Gitpod | Open VSX | `OVSX_PAT` |
| Eclipse Theia | Open VSX | `OVSX_PAT` |
| Coder / code-server | Open VSX | `OVSX_PAT` |
| Visual Studio (full IDE) | NOT SUPPORTED | — |

Every Open VSX row is published by the `ovsx publish` step in `.github/workflows/ci.yml` using the `OVSX_PAT` secret.

## Why not Visual Studio IDE?

Microsoft's full **Visual Studio IDE** (`devenv.exe`, the .NET-heavy product) uses a different extension model from VS Code. Visual Studio extensions are `.vsix` packages built against the Visual Studio SDK with a `source.extension.vsixmanifest`, and are written against .NET APIs (MEF components, VSPackages, IVsWindowFrame, etc.). VS Code extensions run in a Node extension host with a JSON `package.json` manifest, webview panels rendered in Chromium, and a TypeScript/JavaScript API surface. Porting Event Horizon to Visual Studio IDE would be a full rewrite of the extension host and webview — not a republish. It is out of scope.

The name collision between "Visual Studio Marketplace" (`marketplace.visualstudio.com`) and "Visual Studio IDE" is unfortunate: the marketplace hosts listings for **both** products under one domain, but Event Horizon's listing there is the VS Code one. There is no Visual Studio IDE version.

## Why two marketplaces?

Microsoft's VS Code Marketplace Terms of Use restrict consumption of its gallery API to **"Microsoft products"**. Forks like Cursor, VSCodium, Windsurf, and Gitpod cannot legally query the VS Code Marketplace — so they query Open VSX instead. Publishing to both marketplaces is the only way to reach every compatible editor.

- The **VS Code Marketplace** covers VS Code users (Microsoft's product, Microsoft's registry).
- **Open VSX** is an Eclipse Foundation-operated, vendor-neutral registry that every fork is free to use. A single Open VSX publish reaches all of them with no per-editor work.

## CI flow

- Push to `master` → the `release` job in `ci.yml` tags the release, publishes the VSIX to the VS Code Marketplace via `vsce`, then publishes to Open VSX via `ovsx publish` (`continue-on-error: true`).
- Push to `release/*` → the `package-prerelease` job builds a pre-release VSIX and creates a GitHub pre-release. Pre-releases are **not** pushed to the VS Code Marketplace or to Open VSX — since both marketplaces reject duplicate version numbers and we use the same `X.Y.Z` across a release branch's alphas/betas/rcs and its stable tag, publishing a pre-release would block the stable publish. Test pre-releases by downloading the VSIX from the GitHub pre-release page and installing it manually.

See [`docs/PUBLISHING.md`](PUBLISHING.md) for the end-to-end publisher setup, token generation, namespace claim, and manual-publish fallback.
