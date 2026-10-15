# Portable contract, proposal 1.0

Facts live in a project. A brief selects which facts to show. A template supplies a page grammar and visual skin. A provider profile describes the available execution capability. These objects do not depend on a Codex tool name.

The project fields are demonstrated in [the local sample](../assets/examples/weekend.json). The canonical [JSON Schema](../assets/schemas/project.schema.json) is Draft 2020-12. The helper applies practical semantic checks to its supported fields; use a full JSON Schema validator for external conformance checks. The initial capacity limits are heuristics, not tested typography guarantees.

## Input and output

- Project: supplied facts, source IDs, intent, local assets, privacy flags, chosen output structure and style. Unknown times are empty; no times are inferred by the helper.
- Request: job ID, content revision digest, exact selected copy, reference list, requested size, rendering mode, coverage targets and a model-agnostic prompt. A request is not an image.
- Artifact result: task ID, content digest, actual local file, observed size, provider information when known, usage when known, and separate review evidence. See [the request schema](../assets/schemas/render-request.schema.json) and [the proposed result schema](../assets/schemas/artifact-result.schema.json).

The CLI computes SHA-256 digests after compilation. A future API runner or the host agent must attach the same digest when collecting a result. The digest prevents accidental revision confusion; it is not proof that the model drew every item.

## Host bridge

The host bridge consumes a request, checks current tool availability and reference support, invokes the available image tool, and saves the returned asset. It returns the portable result. Tools in one agent cannot be invoked from a separate generic Node process merely by naming them. Other agents can load this folder, follow the same request protocol and use their own image tools or a separate API adapter.

## API adapter interface

An adapter implements capability discovery, generate, edit where supported, status for asynchronous jobs, result collection and cancellation where supported. It owns authentication, payload conversion, provider model names, error normalization and observed-size reporting. OpenAI-compatible endpoints are one adapter family, not proof that every provider shares those fields. Keep native-provider and local-generation adapters separate.

The runtime implements synchronous OpenAI Images, Gemini image and OpenAI-compatible submission and collection, plus native/manual handoff. See assets/config/providers.example.json and execution.md. Async provider polling and cancellation need provider-specific extensions; do not claim those are implemented. Configuration contains environment-variable names, never key values.

## Rendering and review

Whole-image generation draws lettering and artwork together. Precise-layout generation draws supporting artwork and uses a separate renderer for exact text, dates and original photos. Every final result needs content and visual review. Generating an art asset does not finish the page.

Coverage is scoped by format: day-timeline and photo-memory target selected entry IDs; trip-overview targets selected day IDs. Private entries deliberately excluded from a public brief are listed as omitted. Exact-size requests fail planning when the profile has not demonstrated that size. Unknown provider capabilities remain unknown.

State progression is planned → awaiting-result or generating → generated → needs-review → reviewed → packaged. Rejections create bounded repair attempts without overwriting originals. The planner stops at planned; the runtime can submit or await a host result, collect real files, bind review evidence and package selected pages. Its review function checks evidence consistency, not pixels, and does not run OCR. Agent inspection and user acceptance remain distinct.

## Standalone distribution

The Skill directory contains its instructions, schemas, examples, template and offline scripts. Copy the complete directory into a supported agent's skill location. The repository wrappers and plugin manifests are optional distribution conveniences. Installation, native tool execution and API rendering must be tested per host before declaring end-to-end compatibility.
