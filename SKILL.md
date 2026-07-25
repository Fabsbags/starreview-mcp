---
name: starreview-mcp
description: Use when connecting to or calling the StarReview MCP server (mcp.starreview.ch) to manage a business's Google and TripAdvisor review replies - covers OAuth connection, the multi-business picker, the double-parsed result envelope, error handling, rate limits, and the approval workflow.
---

# StarReview MCP

StarReview drafts and submits review replies for local businesses. You (the agent) draft and submit; the owner's decision governs publishing. Where a provider has a supported posting API, StarReview's infrastructure performs the post; otherwise the owner posts manually. You can never post a reply yourself - there is no tool for it.

## Connect

Endpoint: `POST https://mcp.starreview.ch/` (streamable HTTP, stateless; `GET`/`DELETE` return 405). Always send `Accept: application/json, text/event-stream`.

**OAuth 2.1 is the default.** Discovery is standard RFC 9728: fetch `https://mcp.starreview.ch/.well-known/oauth-protected-resource`, register via dynamic client registration, run the authorization code flow with PKCE (S256). The business owner signs in and approves on a StarReview consent screen. A credential-less request answers 401 with a `WWW-Authenticate` header naming that metadata URL and the scopes to request. Request `offline_access` in addition to the challenged scopes if you want a refresh token.

This is plain OAuth 2.1 with opaque access tokens - deliberately NOT OpenID Connect. Do not request `openid`, do not expect an `id_token`, `userinfo`, or JWKS.

**API-key path (self-serve):** the owner can create an account-wide agent key in their StarReview settings and give it to you (commonly as the `STARREVIEW_API_KEY` environment variable). Send it as `Authorization: Bearer sragt_...`. It identifies the OWNER, so the multi-business picker below applies exactly as in OAuth mode.

Legacy path: an admin-issued per-business bearer token (also `sragt_...`). If you hold one of these, the token pins the business and none of the multi-business handling below applies.

## The toolset depends on your credential

The seven business tools live at the main endpoint and require a credential: call it without one and you get a 401 challenge, not a tool list. The three free discovery tools (`get_service_info`, `search_business`, `check_response_rate`) live at `POST https://mcp.starreview.ch/public`, which needs no credential at all. The two sets are disjoint. The free `check_response_rate` result is cached ~30 days - never repeat it for the same place.

## Result envelope: parse twice

Every result, success or error, is JSON serialized inside a text content block:

```json
{ "content": [{ "type": "text", "text": "{\"...\":\"...\"}" }] }
```

Parse the outer MCP result, then `JSON.parse` the text block. Errors carry `"isError": true` and the inner JSON is `{ "code": "..." }`.

## The multi-business picker (owner-wide credentials)

An OAuth session or self-service account-wide `sragt_` key identifies an OWNER, who may manage several businesses. Call `list_locations` or `list_unanswered_reviews` without `businessId` and, if the owner has more than one business, you get a SUCCESS result (not an error) whose payload is:

```json
{ "businesses": [{ "businessId": "...", "name": "..." }], "hint": "You manage multiple businesses. Call again with businessId set to one of these." }
```

Check for this shape (`businesses` + `hint`) before treating any response as the answer. Re-call with `businessId` set. Tools keyed on a `reviewId` (`get_review_context`, `draft_reply`, `submit_reply_for_approval`, `submit_own_reply`) never return a picker - the review determines the business.

## Platforms are open-ended

Every review carries a `provider` field (`google`, `tripadvisor`, ...). The value set GROWS as StarReview activates more platforms - never hardcode it, never reject an unknown value. What differs per platform is the publishing lane: a live posting API may return `autoScheduled`, while a provider without a posting API remains in the approval queue until a human approves it and the owner receives the manual-post link. Trust the response fields, never infer an outcome from the platform name. `list_unanswered_reviews` accepts an optional `provider` filter; an unknown slug returns an empty list.

## Workflow

0. Optional `get_review_stats` (optionally per `locationId`, `days` for a trailing window) for a read-only KPI summary: totals, average rating, response rate, pending count, backlog, response speed on negatives, and a per-provider breakdown. Use it to report "how are my reviews doing" - it never changes anything.
1. `list_unanswered_reviews` (optionally per `locationId`, `provider`, `limit` max 50). Each review carries its `provider`.
2. `get_review_context` for the full text, language, and any existing draft variants.
3. Either `draft_reply` (StarReview generates variants in the business's voice, saved as drafts) then `submit_reply_for_approval` with the chosen `variant` (optionally `finalText` to edit it), OR `submit_own_reply` with your own `finalText` (no StarReview draft; ALWAYS requires human approval, never auto-schedules).
4. Optional `preferredPostAt` (ISO 8601): StarReview will not post before that time.
5. Read the submit response:
   - `submit_reply_for_approval` returns `{ submitted, autoScheduled, gateOutcomes }` - `gateOutcomes` explains whether the reply scheduled on the owner's standing consent or waits in the approval queue.
   - `submit_own_reply` returns `{ submitted: true, autoScheduled: false }`; your own text always waits for a human.
   - A provider without a posting API does not auto-schedule from an agent submission. It remains pending until human approval; only then does the owner receive the manual-post outcome below.
   - `gateOutcomes.agentConsentCurrent` reports whether the owner accepted the current Agent Access policy. When false, submission still succeeds but remains pending with `pendingReason: "agent_consent_upgrade_required"`.

**TripAdvisor terminal state:** there is no TripAdvisor reply API. Agent submission stays pending until a human approves it. The approved reply then has `awaitingManualPost: true` plus a `platformListingUrl` deep link - the OWNER posts it through TripAdvisor's own portal. Treat that eventual state as distinct from an API post; do not claim it was posted.

## Error codes: refusals vs failures

Refusals (audited as denied; do NOT blind-retry - each needs a different response):

| code | meaning | what to do |
|---|---|---|
| `forbidden` | not your business, or access revoked | stop; re-check scope |
| `posting_paywall` | business has no active subscription | tell the owner to subscribe |
| `review_not_pending` | review already handled | refresh your list |
| `free_quota_exhausted` | free reply allowance used up | tell the owner to subscribe |
| `not_editable` | reply past its editable state | stop |
| `already_processed` | duplicate submission | treat as success |
| `business_not_connected` | owner has no connected business | send them to onboarding |

Failures and limits:

| code | meaning | what to do |
|---|---|---|
| `unknown_tool` | no such tool | fix the tool name |
| `invalid_arguments` | schema validation failed (never burns quota) | fix the arguments |
| `not_found` | referenced entity does not exist | re-fetch context |
| `unknown_place` | placeId not from a recent `search_business` | re-run `search_business` first |
| `search_unavailable` | `search_business` upstream budget spent | retry later |
| `check_unavailable` | `check_response_rate` upstream budget spent (cached places still answer) | retry later |
| `variant_not_found` | variant number does not exist for this review | re-run `draft_reply` |
| `rate_limited_per_minute` | per-minute cap hit | back off ≥60s |
| `daily_cap_exceeded` / `daily_draft_cap_exceeded` | daily cap hit | stop for the day |
| `db_error` / `audit_unavailable` / `internal_error` | transient server fault (audit fails closed) | retry with backoff |
| `photo_negative_manual_review` | photo reply on a negative review needs manual handling | leave for the owner |

## Rate limits

Authenticated: 20 tool calls/min per credential; `draft_reply` ~25/day. Public: the binding limit is **10 tool calls/min per IP**, plus `search_business` 12/day and `check_response_rate` 5/day (a separate 30 req/min HTTP burst shield sits outside these - do not pace against it). Invalid arguments are rejected before any quota is claimed.

## Boundaries (state them accurately)

- An agent cannot publish to any provider: structural - no publish tool exists.
- StarReview applies the owner's existing approval and provider-specific automatic-publishing settings. On a live posting API, an eligible, unedited StarReview draft may schedule without another click when current Agent Consent and safety checks allow it.
- Agent-written, edited, or safety-held replies remain pending. `submit_own_reply` never takes the automatic path.
- A provider without a posting API remains pending until human approval; the owner then posts manually through the returned link.

## Compatibility promise

Contract changes are additive-only: new tools, new optional arguments, new response fields, and new `provider` values may appear in any minor version; existing tools are never removed and existing fields never change meaning without a MAJOR version bump. An agent written against this document keeps working.
