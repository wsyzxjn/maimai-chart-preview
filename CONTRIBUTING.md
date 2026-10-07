# Development

Use Node.js 22.14 or later and Yarn 4.13.0 via Corepack. All build dependencies are installed by this repository:

```bash
yarn install --immutable
yarn test
yarn typecheck
yarn build
```

## Engine dependency

`@lxns-network/maimai-chart-engine` is sourced from the `packages/maimai-chart-engine` workspace in [maimai-prober-frontend](https://github.com/Lxns-Network/maimai-prober-frontend), pinned to a commit in `package.json` and `yarn.lock`.

The patch under `.yarn/patches/` contains only:

- An optional `soundBaseUrl` for loading Webview-local sound assets.
- Shared Simai section discovery, custom positive integer section IDs, associated metadata, and explicit declaration errors.

Do not change the upstream Touch Hold single-voice scheduling or the original Hi-Speed range of 3.0–9.0. Playback caret feedback and SE mute recovery are handled by the extension.

To update upstream, choose a reviewed commit and replace the `commit=` portion of the engine dependency. Use `yarn patch @lxns-network/maimai-chart-engine` to extract the new base, port only the changes still needed, then run `yarn patch-commit -s` and `yarn install`. If upstream includes a patch change, remove it from the new patch. Keep the patch resolution and lockfile consistent and run all checks above before committing the update.

## Runtime assets

Chart audio and sensor artwork are included in `media/assets/chart/`. Downloaded example charts and built VSIX files remain excluded. Synthetic parser fixtures in `tests/fixtures/` are sufficient for automated checks.

To package the extension:

```bash
yarn package
```

See `scripts/chart-assets.mjs` for the required filenames; packaging checks that all are present. `yarn assets:import /absolute/path/to/chart-assets` can replace them for local playback testing. The MIT source license does not relicense third-party assets; retain applicable notices when replacing or redistributing them.

## VS Code development

After `yarn build`, run the extension from VS Code's Extension Development Host or use:

```bash
code --extensionDevelopmentPath=.
```

Changes to language contributions or commands require reloading the development window. Do not edit generated files in `dist/`.
