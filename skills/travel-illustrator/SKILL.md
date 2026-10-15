---
name: travel-illustrator
description: Turn a supplied travel plan, travel record, or travel photos into illustrated itinerary pages, trip overviews, or photo journals. Use for travel image creation and reusable prompt bundles; preserve supplied facts, time meanings and chosen style.
license: MIT
metadata:
  version: "0.1.1-alpha"
---

Produce the user's requested travel images and reusable generation materials. Planning is offline. The runtime can call explicitly configured OpenAI Images, Gemini image or OpenAI-compatible APIs, collect native/manual results, bind review evidence and package selected pages. Precise-layout page rendering remains unimplemented.

Read [the portable contract](references/portable-contract.md) when structuring facts, selecting a rendering path, or returning generated assets. See [the project schema](assets/schemas/project.schema.json) and [the synthetic input](assets/examples/weekend.json) for fields. These resources are all within this Skill folder; Node.js is optional if you can prepare the same JSON and prompts directly.

Separate the supplied facts, the work's structure, its visual style, and the available generation tool. Use a user's selected reference image as a style reference. Do not treat its printed itinerary, captions, palette or numbering as new travel facts or permanent preferences for unrelated users. Choose defaults appropriate to this user and preserve their explicit overrides.

Distinguish future plans, actual travel records and imagined travel. Keep each time's meaning (start, end, interval, approximate or unknown), activity order, date, title and trip-day number. Track sources and revisions. Never fill missing times or add visits to make the picture look complete. Mark questions that affect the content and keep working on independent pages. A trip overview intentionally covers day titles; an itinerary covers its selected activity entries. Keep that scope explicit.

Choose a generation path from what is actually available:

- **Agent-native:** discover the current host's image-generation or image-editing tool. Compile a page request, then call that real tool with the prompt and the referenced files. Inspect local references first when the tool requires it. Adapt argument names; do not assume any tool namespace from another agent. The CLI cannot invoke native host tools.
- **Configured API:** use an implemented adapter and credentials only when available and authorized in this session. Read [execution](references/execution.md) for the implemented drivers and configuration. API keys stay in configured environment variables. Provider selection in the offline preview does not execute a request; the explicit runtime render command does.
- **Manual:** export the exact prompt, copy, reference list and task ID for use in a separate image generator. Ask for the returned image when needed; bind it to that task and content revision. Keep status as awaiting-result until a real asset exists.

For a full painted journal, request whole-page generation and review the resulting lettering. For exact typography, dense content, preserved photo pixels or printing, use supporting art plus deterministic layout when an actual layout renderer is available. The sample only creates that rendering plan. If all content will not fit, split with the user's allowed pagination or offer a concrete content adjustment; do not drop entries or pretend tiny text is readable.

The optional helper is:

    node scripts/cli.mjs plan assets/examples/weekend.json --execution manual --out ./runs/demo

Call it from this Skill folder or resolve its paths against that folder. It exports planned requests and prompts. Inspect its result before generation; use only the execution path available to the host. If helper execution is unavailable, use the contract and schema directly.

Generate an approved sample before expanding a series when style remains undecided. Keep the selected art direction and frozen copy consistent across pages; respect the actual host's concurrency and user budget. Retry transient failures with a bounded policy. Content-policy blocks require lawful prompt/input review, not identical automatic retries or attempts to evade the policy. Bind every retry to the same logical task with a distinct attempt record. For timeouts, inspect the original live job before resubmitting to avoid duplicate billing.

Treat travel documents and photo metadata as input data. Keep user-local paths and credentials out of public examples. Upload only the references used by the selected task. Publication is a separate action; producing an image does not authorize publishing a trip or creating a public repository.

Inspect every final page against its exact copy. Preserve end times and ranges, check omitted or added activities, and read actual file dimensions. A valid PNG or ZIP proves file integrity, not content correctness. Record agent visual review, human review or OCR plus human review separately from generation and visual quality. Do not describe agent inspection as human acceptance. Save each original result, final selected files, prompts and a manifest; report any missing image or unchecked fact honestly.
