# @starreview/mcp

> StarReview Model Context Protocol (MCP) endpoint for AI agents.

StarReview lets AI agents manage a business's Google and TripAdvisor review replies through a hosted MCP endpoint, under the business owner's approval and provider-specific automatic-publishing policy.

The server is **hosted** — there is nothing to run. This package carries the connection knowledge: this README plus [`SKILL.md`](./SKILL.md), a drop-in skill that teaches an agent the parts of the protocol no tool schema can express.

## Endpoint

```
https://mcp.starreview.ch/
```

(`https://api.starreview.ch/api/agent/mcp` is the same endpoint at its API path.)

Streamable HTTP MCP, stateless (`GET`/`DELETE` return 405). Every request must send:

```
Accept: application/json, text/event-stream
```

## Tools

Three free discovery tools, no credential needed (`POST https://mcp.starreview.ch/public`):

- `get_service_info`: what StarReview does, pricing, and how to connect
- `search_business`: find a business on Google Maps by name, returns up to 5 candidates
- `check_response_rate`: what share of a business's recent Google reviews got an owner reply, benchmarked against two nearby competitors

Seven business tools, authenticated via OAuth or an owner-issued agent key (main endpoint):

- `list_locations`: the locations of the business you act for, across its connected platforms
- `list_unanswered_reviews`: reviews still waiting for a reply, each tagged with its platform; optional `provider` filter
- `get_review_stats`: read-only KPIs — totals, average rating, response rate, pending, backlog, speed on negatives, per-platform breakdown
- `get_review_context`: the full review (including its platform) plus any existing drafts
- `draft_reply`: generate a reply in the business's voice
- `submit_reply_for_approval`: submit a StarReview draft so StarReview can apply the owner's publishing policy, with optional edits and an optional preferred post time
- `submit_own_reply`: put the agent's own reply text into the owner's approval queue

There is no publish tool: an agent can never post a reply itself. How publishing is governed is described under "What an agent cannot do" below.

## Connect with OAuth (default, self-serve)

StarReview is an OAuth 2.1 authorization server with dynamic client registration and PKCE. From Claude or any MCP client that supports OAuth: add the endpoint as a connector and sign in with the StarReview account that owns the business. The owner approves once on a consent screen; there is no token to copy or manage.

Claude tip: if the tool list still looks empty right after you approve, reload the Claude tab — the connectors panel does not always re-fetch tools after the sign-in window closes.

For clients that wire the flow themselves, discovery is standard RFC 9728:

```
https://mcp.starreview.ch/.well-known/oauth-protected-resource
```

A credential-less request answers `401` with a `WWW-Authenticate` header pointing at that same document, including the scopes to request. Add `offline_access` to your scope request if you want a refresh token. Note: this is plain OAuth 2.1 with opaque access tokens, deliberately not OpenID Connect — there is no `id_token`, no `userinfo`, no JWKS.

## Connect with an agent key (CLI, n8n, headless agents)

Owners can create an account-wide agent key in their StarReview settings and hand it to their agent — commonly as the `STARREVIEW_API_KEY` environment variable, sent as `Authorization: Bearer sragt_...`. The key identifies the owner (all their businesses; the multi-business picker applies) and can be revoked in settings at any time. Creating a key shows the same consent summary as the OAuth screen: the agent drafts and submits, and can never publish.

Admin-issued per-business bearer tokens (also `sragt_...`) still authenticate as a legacy path for existing integrations.

## No credential? Start here

The three free discovery tools live on their own endpoint, `POST https://mcp.starreview.ch/public`, and need no credential at all:

- `get_service_info`: what StarReview does, pricing, and how to connect
- `search_business`: find a business on Google Maps by name, returns up to 5 candidates
- `check_response_rate`: what share of a business's recent Google reviews got an owner reply, benchmarked against two nearby competitors. Takes a `placeId` from a recent `search_business` call.

Example call:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "check_response_rate",
    "arguments": { "placeId": "<placeId from search_business>", "lang": "de" }
  }
}
```

Public tools are rate-limited per IP, results are cached for about 30 days (do not repeat a check for the same place), and the operator can disable public access at any time. The two toolsets are disjoint and live on separate endpoints: the main endpoint answers a credential-less caller with a 401 challenge rather than a tool list, which is what tells an MCP client to start the OAuth flow.

## What an authenticated agent can do

- `list_locations`: the locations of the business you act for, across its connected platforms
- `list_unanswered_reviews`: reviews still waiting for a reply, each tagged with its platform; optional `provider` filter
- `get_review_stats`: read-only KPIs — totals, average rating, response rate, pending, backlog, speed on negatives, per-platform breakdown (optionally windowed by `days`)
- `get_review_context`: the full review (including its platform) plus any existing drafts
- `draft_reply`: generate a reply in the business's voice
- `submit_reply_for_approval`: submit one of StarReview's drafted variants so StarReview can apply the owner's publishing policy, optionally editing its text and setting a preferred post time. A provider with no posting API stays pending until a human approves it; the owner then gets the manual-post link
- `submit_own_reply`: put your agent's OWN reply text into the owner's approval queue. Always requires human approval and never auto-schedules.

Platform values are open-ended: new platforms appear as StarReview activates them, tagged by the same `provider` field, with the post-submit outcome always signaled per response. Contract changes are additive-only (see `SKILL.md`, "Compatibility promise").

If the signed-in owner manages more than one business, calls without a `businessId` return a business picker instead of doing the work — see `SKILL.md` for the exact payload and how to answer it.

## What an agent cannot do

Post a reply itself. The agent drafts and submits; it never posts. StarReview applies the owner's existing approval and provider-specific automatic-publishing settings. On a provider with a live posting API, an eligible, unedited StarReview draft may be scheduled without another click when current Agent Consent and safety checks allow it. Agent-written, edited, or safety-held replies remain pending. A provider with no posting API always remains pending until a human approves it; StarReview then returns a link and the owner posts the approved reply in the provider's own portal.

## The flow

1. Your agent lists unanswered reviews and reads their context.
2. It submits a reply, StarReview's draft or its own text, with an optional preferred post time.
3. StarReview applies the owner's existing approval and provider-specific automatic-publishing settings. On a live posting API, an eligible, unedited StarReview draft may schedule when current Agent Consent and safety checks allow it; agent-written, edited, safety-held, and no-posting-API replies remain pending.
4. Once the owner's decision allows it, StarReview uses the provider's live posting API from its own infrastructure (at your preferred time if you set one). When no posting API is available, the reply remains pending until human approval and the owner then receives a manual-post link.

## Pricing

CHF 0.50 per published reply. Drafting is free. You pay only when a reply goes live, whether StarReview drafted it or your agent provided the text. The discovery tools are free.

## The skill

[`SKILL.md`](./SKILL.md) in this package is a ready-to-install skill for Claude Code and compatible agents. It carries the workflow knowledge the tool schemas cannot: the multi-business picker protocol, the double-parsed result envelope, the error-code tables with what to do about each code, rate limits, and the TripAdvisor manual-post terminal state.

Install for Claude Code:

```bash
mkdir -p ~/.claude/skills/starreview-mcp
cp node_modules/@starreview/mcp/SKILL.md ~/.claude/skills/starreview-mcp/SKILL.md
```

## Machine-readable contract

The full generated tool contract (schemas, rate limits, error codes) ships in this package as [`agent-contract.generated.json`](./agent-contract.generated.json), regenerated from the same source the server serves and guarded against drift.

The contract also publishes the current Agent Consent/privacy versions and a
structured `publishingPolicy`. Existing credentials with stale consent retain
read, draft, and submit access, but submissions remain pending until the owner
accepts the current policy.

## Learn more

https://www.starreview.ch/en/agents
