# Travel Canvas

[![CI](https://github.com/Andy-Huang-SZU/travel-canvas/actions/workflows/ci.yml/badge.svg)](https://github.com/Andy-Huang-SZU/travel-canvas/actions/workflows/ci.yml)
[中文](README.md) · [Releases](https://github.com/Andy-Huang-SZU/travel-canvas/releases)

Turn supplied travel facts into illustrated itinerary pages and reusable generation materials. Keep facts, output scope, visual templates and providers separate. Includes a self-contained Agent Skill, CLI and Codex plugin wrapper.

**0.1.2-alpha.** Planning, native/manual collection, configurable API transports, evidence binding and ZIP packaging are implemented. Paid providers, other host execution and the final precise-layout renderer remain unverified or unfinished. The presentation document uses a separate version.

## Try it

Node.js 22/24 recommended. No runtime dependencies, package installation or API key required:

```sh
git clone https://github.com/Andy-Huang-SZU/travel-canvas.git
cd travel-canvas
npm run demo
npm run check
npm test
npm run smoke
```

The demo replays the bundled fictional example through planning, collection and draft ZIP packaging. It does not generate a new image or call a provider. The generated ZIP remains a draft-package, not new visual review or user acceptance. Files appear under the directory printed by the command.

Inspect the [real twelve-entry fictional Kyoto image](skills/travel-illustrator/assets/demos/native-demo.png), [execution prompt](skills/travel-illustrator/assets/demos/native-demo.prompt.txt) and [provenance receipt](skills/travel-illustrator/assets/demos/native-demo.receipt.json).

## Install the Skill

Copy the entire skills/travel-illustrator folder into a host-supported location. For Codex user-local discovery:

```sh
node scripts/install-skill.mjs --to "$HOME/.agents/skills/travel-illustrator"
```

Pass an appropriate complete path on Windows or another host. Existing directories are never overwritten. Alternatively ask your agent to read skills/travel-illustrator/SKILL.md directly. File installation is distinct from host discovery and activation. See [Codex skills](https://developers.openai.com/codex/skills).

Example request: “Use $travel-illustrator to turn my three-day travel plan into illustrated journals. Keep unknown times unknown and show one sample first.” The host must actually provide an image tool or configured API.

## Plan and execute

Copy a fictional example and replace its content with your own confirmed input:

```sh
cp skills/travel-illustrator/assets/examples/weekend.json trip.json
node cli.mjs validate trip.json
node cli.mjs plan trip.json --execution manual --out ./runs/my-trip
```

This exports exact prompts and requests as planned-not-generated. Use your host's real image tool or a separate image product.

For API execution, copy providers.example.json to providers.local.json. Replace MODEL_ID, configure the endpoint and put credentials in the named environment variable. The project does not automatically load .env files.

```sh
node cli.mjs render ./runs/my-trip/plan.json --config providers.local.json --provider openai --out ./runs/my-trip/execution --max-requests 1
```

Drivers: OpenAI Images, Gemini image generation, protocol-specific OpenAI-compatible services, agent-native and manual. API transports have local HTTP mock tests, not live paid-provider validation. Native/manual drivers wait for the actual host result; the CLI cannot invoke a host image tool.

## Collect, review and package

Use the actual job ID and digest from plan.json:

```sh
node cli.mjs collect ./runs/my-trip/plan.json --job JOB_ID --digest CONTENT_DIGEST --image returned.png --out ./runs/my-trip/execution
node cli.mjs review ./runs/my-trip/plan.json --job JOB_ID --evidence review.json --out ./runs/my-trip/execution
node cli.mjs pack ./runs/my-trip/plan.json --out ./runs/my-trip/execution --archive ./outputs/trip.zip
node cli.mjs status ./runs/my-trip/execution
```

Review evidence binds the image hash and coverage targets. Use collect --executed-prompt actual-prompt.txt if the host changed the prompt. See the [runtime guide](skills/travel-illustrator/references/execution.md). Explicit --allow-drafts is required to package unchecked results. Agent visual checks, human checks and user acceptance remain distinct.

## Scope

- Daily timelines, trip-overview requests; indigo-journal and clean-guide skins.
- Preserve trip-day numbering, selected entries and start/end/range/approximate/unknown time meanings. Never silently drop entries.
- PNG/JPEG collection, immutable attempts, real dimensions, digest binding and ZIP output.
- Photo-memory/precise-layout stop at planning/supporting art; no final compositor is implemented.
- One current Codex native-tool example; other host execution has no end-to-end proof.
- Unknown or timed-out submissions never trigger automatic regeneration. Rate-limit retries obey explicit request limits.

## Codex plugin source

Portable/compatibility manifests and a repo marketplace catalog are included:

```sh
codex plugin marketplace add Andy-Huang-SZU/travel-canvas --ref main
codex plugin marketplace list
```

Follow [official plugin documentation](https://developers.openai.com/plugins/build/plugins) to install from that source in the desktop plugin directory. Desktop installation/activation is not validated by repository CI. This project has not been admitted to the universal public plugin directory. Standalone Skill/CLI use is independent of that directory.

## Releases and contribution

[Releases](https://github.com/Andy-Huang-SZU/travel-canvas/releases) provide project/Skill ZIP files and SHA256SUMS. npm run package builds them. CI checks Node.js 22/24; see [CONTRIBUTING.md](CONTRIBUTING.md).

Original code, instructions and synthetic input text use MIT. Generated example assets have separate provenance; provider conditions and third-party rights are not relicensed. Real private trip content, credentials and the private presentation bundle are excluded. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
