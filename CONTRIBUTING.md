# Contributing

Use Node.js 22 or 24. There are no third-party runtime dependencies.

```sh
npm run check
npm test
npm run smoke
npm run package
```

All automated checks use offline fixtures or local HTTP mocks. Do not add paid provider calls or credentials to CI. Use `providers.local.json` and environment variables for your own explicitly requested live tests.

New skins belong in the canonical `SKINS` definitions; regenerate their JSON mirrors with `node skills/travel-illustrator/scripts/export-templates.mjs`. New providers need capability declarations, transport/error tests and honest live-validation notes. Keep all Skill resources inside its folder so the Skill ZIP remains independent of repository helpers.

Use fictional input and appropriately licensed assets in examples. Exclude private trips, local paths, keys and generated run folders. A PNG hash, an automated test, agent visual review and user acceptance prove different things; describe which evidence your change actually adds.

Open an issue for a reproducible bug or a clearly scoped proposal. Include the execution path, public/synthetic input and a sanitized error. Never paste credentials, personal photos or unredacted private run manifests.
