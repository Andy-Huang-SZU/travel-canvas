# Execute and collect, alpha

The portable core compiles immutable requests. The runtime operates on those requests, uses a trusted provider configuration and stores a separate run manifest.

## API path

Copy assets/config/providers.example.json to a private local configuration. Choose a driver and fill a real image model identifier. Set the configured credential environment variable in your own environment. The library never defaults to another user's key or another vendor.

Run scripts/cli.mjs render with the plan, --config, --provider and a dedicated --out directory. --max-requests includes attempted HTTP generation submissions, not a billing estimate. Default retries are zero. --rate-limit-retries can enable up to three retries for a known rate-limit response within that total cap.

Missing credentials and invalid reference files fail before HTTP submission. Quota, authentication and local errors stop the run. A timeout, interrupted network or server failure can mean a remote image still exists; the manifest keeps unknown-outcome and refuses automatic resubmission. Check the original provider request or collect its result before continuing. A stale run.lock requires inspection of the original process, not an assumption that the job died.

OpenAI Images uses JSON generations or multipart edits for references. Gemini uses its native generateContent shape with text and inline images. Its image response configuration is explicit: response-format is the current default, legacy-image-config is available for a specifically configured endpoint, and none omits ratio settings. Exact dimensions always depend on the observed image; presets are not treated as exact pixel promises.

OpenAI-compatible services must implement those specific endpoints and payloads. A service returning image URLs needs allowOutputUrls and an explicit outputHosts list where required. Redirects are not followed and auth headers are not sent to output hosts. A failed download does not authorize another generation.

## Agent-native and manual path

Read the request, invoke the tool actually available in the current host and preserve its real output. Collect using jobId, contentDigest and the returned local image. If the host added formatting instructions, record the actual prompt with --executed-prompt so the delivered prompt matches the real execution.

The CLI does not contain a hardcoded native tool namespace. In an environment without helper execution, use the request materials directly and keep unverified file, digest and packaging claims explicit.

## Review evidence

A minimal evidence object has:

    {
      "method": "agent-visual",
      "reviewer": "current agent",
      "artifactSha256": "actual image SHA-256 from run.json",
      "matchedIds": ["entry-1", "entry-2"],
      "checkedSemantics": true,
      "checkedNoInventedCopy": true,
      "notes": "What was actually inspected"
    }

Use the real values; do not copy the example as proof. Read the generated image and compare the actual title, dates, time meanings, text and coverage. Agent inspection is distinct from human acceptance and from OCR. Human or OCR plus human checks use their respective method.

The runtime checks evidence binding and completeness, not the truth of the reviewer's observations. PNG CRC and file hashes prove container or byte integrity, not readability or factual correctness. The selected result is still not recorded as accepted by the user.

## Packaging and recovery

Original images are retained per attempt. A review chooses the attempt to package. Packaging verifies that its file and prompt have not changed, then writes selected images, actual prompts and a manifest. It does not overwrite an existing archive.

Draft export is explicit. An art asset cannot be packaged as a final page until the separate layout step exists. A changed content revision or service uses another run directory; the old records stay available. Native/manual re-collection of an unchanged intact file is idempotent.

Asset paths are resolved against the original project directory recorded locally by plan, or an explicit --asset-root. Remote host attachments must first be resolved to accessible image files. Private local context and credentials are excluded from delivered manifests.
