# Language-model reader: design proposal

> **Status, 2026-10-13.** Phase 1 and phase 2a are built (§9), through a
> FAKE vendor only, behind `LLM_READER_ENABLED`, which is off by default. No
> vendor is chosen and no real adapter exists. No text from `.samples/` has
> been sent anywhere, and none may be without a separate go-ahead from Alex
> (see §8.2). Where the build differs from what was proposed, §11 says so,
> and the sections below are updated to match. Vendor facts come from
> [`llm-reader-vendors.md`](llm-reader-vendors.md), read 2026-10-09; read the
> vendors' current terms again before choosing.

## Decisions this rests on (Alex, 2026-10-13)

- Sending a rate confirmation to a vendor is allowed. Scope until Alex says
  otherwise: **redacted text only**. Rates, broker contacts, phones, emails
  and driver names are stripped in the browser before anything leaves.
- Vendor: not chosen. Alex chooses after reading this.
- Templates stay first. The model is the fallback for "Layout not
  recognised", and no more templates are built.
- Scans are read later, through OCR in the browser (phase 4). Only the
  interface is designed here.
- Sending any text from `.samples/` to any vendor is **not** authorised yet.

## Why a model, in numbers (2026-10-13 triage, `HANDOFF.md`)

- 28 sample PDFs: 13 read by the four templates, 3 scans, 12 not recognised.
- The 12 form about 8 layouts (likely 7 to 10). Most layouts have one
  sample each.
- A template per layout would mean about 8 more readers of roughly 440 lines
  each, for 1 or 2 files apiece.

## Approach: numbered lines, cited and checked

The model never fills the form directly. It answers a fixed schema in which
every value cites the numbered line or lines it came from and quotes them
exactly. The app's own deterministic code then checks each value:
- the quote is really in the cited lines, as sent;
- the value really follows from the quote.

Anything that fails a check is left blank and marked. What passes is
converted into the same `RateconRead` the templates produce, and
`ratecon-fill.ts` fills the form by its existing rules.

Considered and not chosen:
- **Free quotes, no line numbers.** The quote is searched for anywhere in
  the text. Weaker: a common phrase ("APPT", a city) matches the wrong place.
- **Model as locator only.** The model names lines and our parsers extract
  the values. That needs a parser for every date and time format the
  brokers use, which is the template problem again.

## 1. Flow

**When the model runs.** Only when the dispatcher clicks **Read with AI**.
It is never automatic. The button appears in the rate-confirmation strip
only when all of these hold:
- the feature flag is on and the user is a dispatcher or admin;
- a PDF with a text layer, or pasted text, came back "Layout not
  recognised, nothing filled."

It is never offered for a file that was refused (over 5 MB, over 10 pages,
a password, damaged) or for a scan, until phase 4.

**Before the click.** The strip's detail area, under the existing message,
reads:

> Layout not recognised, nothing filled.
> **Read with AI** — sends 46 lines, with rates, contacts, phones, emails and
> driver names removed. Nothing is saved until Save.

The number is the count of lines that would be sent after redaction and page
selection (§2). Nothing else from the document is shown.

**While reading.** "Reading with AI…" and a **Cancel** button. Cancel aborts
the request in the browser; the server's own timeout ends the vendor call.
Typing into the load folds the strip as today but does not cancel the read.

**After a successful read.**
- The existing Replace or Keep mine question comes first if a load number
  or address was already typed.
- Then the form fills through `fillLoad`, as with a template. The strip says:
  "Filled 2 stops, read by AI. Check each stop against its quote, then press
  Looks right. Nothing is saved until Save." Its line says "2 stops read by
  AI to confirm", apart from "fields to check".
- Each AI-filled field's source line reads "Read by AI from p.2: “…”"
  (or "from the pasted text"), quoting the cited sent text. A blank field
  says why it is blank. Each stop has **Looks right**; the load number has
  its own.
- The session counts gain "N read with AI" (counts only, this tab).

**After a failure.** One line in the strip's fault tone (§5), and nothing
fills. The button stays, so the dispatcher can try once more or type the
load.

**What is sent.** The redacted, numbered lines and a fixed instruction. Not
the PDF, its file name, its positions, the user's identity, or anything
else from the form.

## 2. Redaction

**Where.** In the browser, in a pure function
(`src/lib/ratecon/redact.ts`) run on the `Line[]` the strip already has. The
server checks the result again (below) but never sees unredacted text.

**What is stripped, and how.** Masks replace text with a typed placeholder,
so the model still sees the shape of the line.

| What | How | Placeholder |
|---|---|---|
| Email addresses | pattern, including "name at domain dot com" | `[EMAIL]` |
| Phone and fax numbers | NANP patterns with separators, `+1`, extensions; bare 10-digit runs only after a phone, fax or cell label | `[PHONE]` |
| Money | `$` amounts, amounts with `USD`, and any number on a line labelled Rate, Line Haul, Total, Fuel, FSC, Accessorial, Detention, Lumper, TONU, Pay or Amount | `[AMOUNT]` |
| Labelled contacts | the value after Contact, Dispatcher, Broker Rep, Agent, Rep, Booked by, Driver, Driver Name, Driver Cell, Truck #, Trailer # | `[REMOVED]` |
| Carrier and broker identifiers | MC and DOT numbers | `[ID]` |
| Web addresses | pattern | `[URL]` |

**Page selection, to send less.** From a PDF, the sender takes page 1 and
every page that holds at least one US city line (the existing `cityLine`
pattern). Terms-and-conditions pages are mostly dropped this way. Pasted
text has no pages, so all of it is sent, within the size limit (§4).

**How we know it worked.**
1. **Fail closed.** After masking, the same detectors run again on the
   result. Any hit means nothing is sent, and the strip says "This document
   could not be prepared for reading; nothing was sent."
2. **Checked again on the server.** The route runs the same detectors on
   what it receives and refuses with no vendor call on any hit. This catches
   a stale or modified client.
3. **Tests on invented text** in every format we can think of (§8.1).
4. **Before any real send:** counts on the real samples, and Alex reads the
   redacted text locally (§8.2).

**Pattern redaction is not a guarantee.** It removes what it can recognise.
- **Known misses:**
  - names that carry no label, such as a signature or "questions, call Dana";
  - a broker's company name in a page header;
  - a contact detail written in a way no pattern expected.
- **Known over-masking:** a load number made of 10 bare digits after a phone
  label would be masked, and that field would then come back blank and
  marked. We accept this: masking too much loses a field; masking too little
  sends a phone number.

**What remains in the text, on purpose**, because the read needs it:
facility names, street addresses, cities, states, ZIPs, dates, times,
appointment words (APPT, FCFS, receiving hours), load, order and reference
numbers, and stop headings. Also left in, because no pattern removes them
safely: commodity, weight, PO numbers, equipment notes and the broker's own
name.

## 3. Output contract

**Request shape.** Lines go to the vendor as `L<n> <text>`, numbered from 1
in the order sent. The page of each line is kept in the browser, not sent.

**The schema** (Zod, `src/lib/ratecon/model-read.ts`; the vendor's JSON
schema is generated from it):

```ts
const Quote = z.object({
  line: z.number().int().min(1),             // first cited line
  lineEnd: z.number().int().min(1).optional(), // last cited line; at most 3 lines in all
  text: z.string().min(1).max(300),          // exact text from the cited line(s)
}).strict().refine((q) => {
  const end = q.lineEnd ?? q.line;
  return end >= q.line && end - q.line <= 2;
}, 'A quote cites one to three consecutive lines.');

const cited = <T extends z.ZodTypeAny>(value: T) =>
  z.object({ value, quote: Quote }).strict();

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);  // as written, never shifted
const WallTime = z.string().regex(/^\d{2}:\d{2}$/);       // stop-local, 24-hour, no zone
const Flag = z.enum(['APPT', 'FCFS']).nullable();

const ModelAppointment = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }).strict(),
  z.object({ kind: z.literal('exact'), date: IsoDate, time: WallTime, flag: Flag,
             dateQuote: Quote, timeQuote: Quote }).strict(),
  z.object({ kind: z.literal('range'), date: IsoDate, time: WallTime,
             endDate: IsoDate, endTime: WallTime, flag: Flag,
             dateQuote: Quote, timeQuote: Quote, endQuote: Quote.optional() }).strict(),
  z.object({ kind: z.literal('unclear'), quote: Quote }).strict(),
]);

const ModelStop = z.object({
  type: cited(z.enum(['PU', 'DEL'])),
  street: cited(z.string().min(1).max(200)).nullable(),
  city: cited(z.string().min(1).max(200)).nullable(),
  state: cited(z.string().min(1).max(200)).nullable(),
  zip: cited(z.string().min(1).max(200)).nullable(),
  appointment: ModelAppointment,
}).strict();

export const ModelRead = z.object({
  schemaVersion: z.literal(1),
  loadNumber: cited(z.string().min(1).max(200)).nullable(),
  stops: z.array(ModelStop).min(1).max(20),
}).strict();
```

**Design notes on the schema:**
- **Lengths are payload bounds only.** They are not field rules.
  - The load number is permanently optional with no format check (§12.21).
    The schema and the verifier check only where it came from, never what it
    looks like.
  - State and ZIP are checked by the verifier against the quote, not by the
    schema, so a model that writes "Minn." fails visibly rather than at
    parse.
- **No UTC, no zone, no offset.** A time is `HH:MM` wall time as printed.
  A `Z` or `+01:00` cannot pass `WallTime`. The model is told never to
  convert zones or do arithmetic.
- **Up to 20 stops** so that `fillLoad`'s existing "more than ten stops"
  message still speaks, rather than a parse failure.
- **No free-text field.** There is nowhere for the model to explain, which
  keeps document text out of anything but cited quotes.

**The verifier** (`src/lib/ratecon/verify-read.ts`, pure, runs in the
browser against exactly the lines it sent). For every cited value:

1. **Every quote must be in its cited lines.** The cited lines are joined
   with one space, and whitespace is collapsed on both sides. Nothing fuzzy
   counts: the quote must be an exact substring. A quote that rests on a
   placeholder (`[PHONE]`) verifies nothing.
2. **The value must follow from the quote,** field by field:

| Field | Follows when | Otherwise |
|---|---|---|
| Load number | it appears in the quote as a whole token, trimmed | blank, marked |
| Stop type | the quote holds a pickup word (pick up, pickup, PU, shipper, origin, load at) for PU, or a delivery word (deliver, delivery, consignee, receiver, destination, drop, SO) for DEL, and not both | filled as the model said, marked "Pickup or delivery not confirmed by the text" (the form needs a type) |
| Street | it appears in the quote and starts with a house number or PO Box (§12.121's rule) | blank, marked |
| City, state, ZIP | the quote parses with `cityLine` to the same three; or each appears in it, the state is a US state, and the ZIP is 5 digits | each failing one blank, marked |
| Date | `dateQuote` holds a date our parser reads as that day (M/D/YYYY, MM/DD/YY, Month D YYYY, Mon D YYYY, YYYY-MM-DD); a date with no year verifies only if exactly one of this year and next falls inside §12.122's −1 to +30 day window | time read `unreadable`, quoted |
| Time | `timeQuote` holds a time our parser reads as that time: AM/PM (a start with none takes its end's, "7-10 AM", never past its end), four digits (`1400`), or `HH:MM` when the quote shows a 24-hour clock — a leading zero or an hour of 13 or more anywhere in it, so "08:00 - 10:00" reads both. A bare `8:00` or `10:00` alone is never guessed (§12.122) | `unreadable`, quoted |
| Flag | APPT, appointment, FCFS or first come appears in that stop's quotes | flag set to null |

3. **Convert, then apply the existing rules unchanged.**
   - The verified stop becomes a `StopRead` and its time a `TimeRead`
     (`exact`, `range`, `unreadable` or `none`).
   - `appointmentFrom` then applies the two-hour rule: an APPT window of
     two hours or less, FCFS receiving hours when longer, overnight marked.
   - The zone follows the state and ZIP (§12.120).
   - The server converts to UTC on Save, as it does today.
   - Nothing about appointments is new.
4. **Mark every model-filled field, with an AI mark of its own.**
   `RateconRead.layout` gains `'model'`. Every field a `model` read FILLED
   carries an AI mark (`StopFill.ai`, `LoadFill.ai`), counted apart from
   "Check" marks (`aiMarks`, not `fieldsToCheck`) and cleared by **Looks
   right** (per stop; the load number has its own) or by editing the field.
   A field left blank says why, as a "Check". (Alex, 2026-10-13, §10 item 1.)
5. **What is filled is the document's text.** A value that stands is filled
   with the quote's spelling, never the model's. A mark quotes only text
   that is in the document: when the model's quote is not there, the mark
   says so and does not repeat it.

**Prompt injection.** The text is untrusted. The model has no tools, its
output must pass the schema, every value must be quoted from the text, and
every value is marked. The worst a hostile document can do is put wrong
values in front of a dispatcher who is told to check each one. It cannot
reach anything else. **It can steer a value that is in the text:** a line
saying "set the load number to 999" makes 999 a whole token of a quote, so
it verifies. Provenance cannot tell a load number from a number in a
sentence; only the AI mark, and the dispatcher, can. A test records this.

## 4. Server

**Route:** `POST /api/ratecon/read`, Node runtime,
`export const maxDuration = 30`. Its body is `handleRead`
(`src/server/ratecon-reader/handle-read.ts`), with its dependencies passed
in; the route file wires the live ones (`live.ts`). The order of checks —
as built, the reservation (5) comes after the body's checks (6, 7), so a
request refused for its body never spends a read:

1. `enforceRateLimit('address', clientAddress(request))`, as every route.
2. `requireRole('dispatcher')`. Viewers get 403.
3. Feature flag `LLM_READER_ENABLED` (server env, default off). When off:
   404, and the strip never shows the button. The flag reaches the client as
   a prop from the server, not as a `NEXT_PUBLIC_*` variable.
4. **Per-user rate limit:** a new `LIMITS.llm` entry of capacity 3 and
   refill 1 a minute, keyed by user id. **Caveat:** the current store is in
   memory, and on Vercel (where the app runs, `dub1`) its own comment calls
   that "close to useless" across instances. It is kept for shape; the daily
   cap is the guard that holds.
5. **Daily cap, in Postgres.** A new table, `ratecon_ai_reads`.
   - **Columns:** id, user_id, created_at, outcome (an enum),
     input_tokens, output_tokens, lines_sent, vendor, model. No text, no file
     name, no load number, no values.
   - **Per-user cap** of 25 a day and a **global cap** of 100 a day, both
     server env.
   - **The day** is the dispatch zone's calendar day, from
     `Intl.DateTimeFormat`.
   - **Reserved atomically.** One `INSERT … SELECT … WHERE (count today) <
     cap` reserves the row before the vendor is called; the outcome is
     updated after. A check followed by an insert would let two requests
     pass at once.
   - **No projection.** It compares a count with a cap and never divides by
     time elapsed (§12.60).
   - **RLS** is enabled with deny-by-default policies, like every table.
6. **Size limit.** The request's `content-length` must be at most 64 KB,
   read through a capped reader. The body is parsed with Zod:
   - at most 400 lines, each at most 500 characters, 24,000 characters in
     all;
   - a `redactionVersion` string that must match the server's.

   Over the limit gets 413 with a fixed message.
7. **Redaction re-check** (§2). Any hit gets 422, with no vendor call.
8. **The vendor call** through the adapter (§6), with an `AbortSignal` of
   25 s, joined with the request's own (a dispatcher's Cancel is recorded
   as `cancelled`, not `timeout`). The request carries **today's date in
   the dispatch zone**, so a date with no year can be read (Alex,
   2026-10-13); the verifier stays the judge of the year. No retries in the
   first release: a failed read costs one click, never a loop.
9. **Parse the reply** with `ModelRead.safeParse`. The route returns
   `{ ok: true, read, lines }` or `{ ok: false, code }` (§5). It does not
   verify; the browser does, against the text it holds. The route stores
   nothing but the counts row.

**Keys.**
- `LLM_READER_API_KEY` (or the vendor's equivalent credentials, §6),
  `LLM_READER_VENDOR` and `LLM_READER_MODEL` go in `serverShape` in
  `src/env/schema.ts`.
- Never `NEXT_PUBLIC_*`.
- A refine generalised from `hereKeyIsNotPublic` refuses to boot if the key
  equals any public value.
- Every module with code behind the seam — the fake, the handler, the
  counts, the log line, the live wiring — imports `server-only`, so a
  client import fails the build. Tests mock it per file, as this repo's
  server tests do (no change to the Vitest config).
- A build test scans `.next/static` for the key's value — not built yet:
  no real key exists until a vendor is chosen.

## 5. Failure modes

Nothing fills on any failure. The dispatcher sees one fixed sentence and the
button stays. Each failure is a code from a closed set, and each message is
a constant that never includes vendor or document text.

| Code | When | Strip says |
|---|---|---|
| `disabled` | flag off | (button not shown) |
| `rate_limited` | per-user bucket empty | "Wait a minute and try again." |
| `capped` | daily cap reached | "Today's AI reads are used up. Type the load, or try tomorrow." |
| `too_large` | over the size limits | "This document is too long to send." |
| `not_redacted` | a detector hit, in the browser or on the server | "This document could not be prepared for reading; nothing was sent." |
| `timeout` | 25 s on the server, or 35 s in the browser | "The AI read took too long. Nothing was filled." |
| `unavailable` | vendor 5xx, network failure, 429 | "The AI reader is not available right now. Nothing was filled." |
| `refused` | the vendor declined, or a content filter fired | "The AI reader declined this document. Nothing was filled." |
| `invalid_output` | the reply failed `ModelRead` | "The AI read came back unusable. Nothing was filled." |
| `cancelled` | the dispatcher pressed Cancel | "Cancelled. Nothing was filled." |

**Partial output.**
- A reply that fails the schema anywhere is `invalid_output`, and nothing
  is used. We never salvage a part of a broken reply.
- A reply that passes the schema but fails the verifier field by field is
  not a failure. Those fields are blank and marked, and the rest fill.
- If every value fails verification: "The AI read could not be confirmed
  against the text. Nothing was filled."

**No silent catch, no unhandled rejection.**
- The adapter never throws. Every error, including SDK and network errors,
  maps to a code.
- The route has one `try` that turns anything unexpected into a 500 with a
  `RATECON-500-<base36>` reference, logged as `{ reference, code,
  vendorStatus }`. It never logs `error.message`, because a vendor or Zod
  error message can carry document text (a Zod enum error quotes the value
  it got).
- The strip's promise chain ends in a `.catch` that sets the fault state,
  as `onFile` does today.

**Keeping document text out of Sentry, logs and the database.**
- **Already off for every route** (`src/lib/sentry-privacy.ts`): request
  bodies, headers, cookies and stack-frame locals. So the request body and
  the route's local variables never reach Sentry.
- **Exception messages are still sent.** `onRequestError` forwards any
  error that escapes a route, with its message. Three layers keep text out:
  1. the route never lets an error escape (the `try` above);
  2. every error it creates carries a constant message;
  3. a `beforeSend` in `sentry.server.config.ts` (`scrubReaderEvent`) drops
     the exception value, message, `extra`, request data and breadcrumb text
     of any event whose transaction or URL is `/api/ratecon/read`, keeping
     the type and stack.
- **AI-monitoring integrations.** With tracing on, the installed Sentry
  (11.0.0) installs TEN by default — LangChain, LangGraph, Mastra, VercelAI,
  OpenAI, Anthropic_AI, Google_GenAI, Mistral, Groq, TogetherAI — whether
  or not a vendor SDK is loaded. `withoutAiIntegrations` removes them all.
  A test starts `@sentry/node` with the server's options and a capturing
  transport: an error carrying the sentinel leaves without it, and no AI
  integration is installed.
- **Breadcrumbs.**
  - Fetch breadcrumbs carry URL and status, not bodies, which are off.
  - Console breadcrumbs carry whatever is logged. So on
    `src/lib/ratecon/**`, the strip, `src/app/api/ratecon/**` and
    `src/server/ratecon-reader/**` (tests excepted), `no-console` is an
    error and `console` is a restricted global — `no-console` alone keeps
    the base config's allow-list. The route's one log line goes through
    `logReadFailure`, which takes only `{ reference, code, errorName,
    vendorStatus }`.
- **Logs.** Vercel keeps function logs, and the route logs only the fields
  above.
- **The database.** `ratecon_ai_reads` has no text column — not even the
  vendor or the model: the vendor is an enum (`fake` until one is chosen)
  and the model is not stored. A schema test asserts its column types.
  Nothing else is written.
- **Sentinel test.** In tests, every invented document line carries a
  sentinel string. The tests assert that the sentinel never appears in a
  captured console call, a Sentry event (through a test transport), a
  `ratecon_ai_reads` row, or a 4xx/5xx body.

## 6. Adapter

```ts
// src/server/ratecon-reader/adapter.ts  (types only; every module with code behind it imports 'server-only')
export interface SentLine { n: number; text: string }
export interface ReaderRequest { lines: readonly SentLine[]; today: string }  // today: YYYY-MM-DD, dispatch zone

export type AdapterResult =
  | { ok: true; output: unknown; usage: { inputTokens: number; outputTokens: number } }
  | { ok: false; code: 'timeout' | 'unavailable' | 'refused' | 'malformed'; vendorStatus: number | null };

export interface ReaderAdapter {
  readonly vendor: string;
  readonly model: string;
  /** Never throws. Never logs. Never retries. Sends modelInput(lines, today) and nothing else. */
  read(request: ReaderRequest, signal: AbortSignal): Promise<AdapterResult>;
}
```

- The instruction text and the JSON schema are shared, built once from
  `ModelRead`. Each adapter only translates them to its vendor's request
  shape and its structured-output or JSON mode, with temperature 0 where
  offered.
- Each adapter sets its vendor's no-storage and region options explicitly
  in code, never by account default alone, and has a test asserting those
  options are in the request.
- **`FakeReaderAdapter`** for tests and e2e. It is given a script (an
  output, an error code, or a delay), records the `SentLine[]` it was
  handed, and makes no network call. `LLM_READER_VENDOR=fake` selects it.
  The env schema refuses `fake` when `VERCEL_ENV` is `production`.
  `NODE_ENV` would not work, because the e2e run is a production build too.

**What each vendor would need from us** (from
[`llm-reader-vendors.md`](llm-reader-vendors.md), read 2026-10-09; not a
recommendation). The app runs on Vercel in `dub1` (Dublin).

| Vendor | Account and agreement | Credentials on Vercel | To avoid storage | Region | Notes for us |
|---|---|---|---|---|---|
| Anthropic API | API account; zero retention by agreement, if eligible | API key | Zero-retention agreement; otherwise deleted within 30 days | Global or US-only (1.1×); **no EU** | Fable 5/5.1 require 30-day retention; flagged content kept up to 2 years |
| OpenAI API | API account; zero retention if eligible | API key | Zero retention or modified abuse monitoring; use no stored endpoints | EU at `eu.api.openai.com`, only with that approval | Assistants, threads and vector stores never covered, so not used |
| Google Vertex AI | Google Cloud project | service-account credentials | Turn off caching and logging; no Search grounding | Chosen region, EU included | Some models log for 30 days with no opt-out: choose a model outside that list |
| AWS Bedrock | AWS account | IAM credentials (keys or OIDC federation) | Default for most models | Chosen region or an EU-only profile; avoid "global" | Claude Fable 5/5.1 traffic kept 30 days; some OpenAI models keep flagged traffic |
| Azure OpenAI (Foundry) | Azure subscription; apply for modified abuse monitoring | endpoint, deployment name, key or Entra ID | Modified abuse monitoring, checkable in the portal | EU Data Zone deployment; avoid Global | Flagged prompts reviewed by Microsoft staff, in the EEA for EEA deployments |
| Mistral | Account; terms to confirm in writing | API key | On written request, which Mistral can refuse | EU by default | Training default **unconfirmed**; confirm before considering |

All of them: check the data-processing agreement, sub-processors and
SOC 2/ISO reports, as `llm-reader-vendors.md` lists.

## 7. Cost

**Assumptions.**
- **Document size.** The 12 unrecognised samples hold 1.7k to 12.7k
  non-space characters (median about 7k), from the 2026-10-13 triage counts.
  That is about 8.5k characters with spaces, at about 4 characters a token,
  plus about 2 tokens a line for the `L<n>` numbering. Page selection should
  lower this but is not counted.
- **Input:** typically 4,000 tokens (2,500 document plus 1,500 instruction
  and schema); at worst 6,000.
- **Output:** about 200 tokens a stop with quotes, plus 100. Typically
  2 stops, 600 tokens; at worst 10 stops, 2,100 tokens.
- **No retries.** A failed or cancelled read may still be billed.
- **Prices are illustrative bands,** per million tokens in and out, not any
  vendor's quote: small $0.25 / $1.25, mid $1 / $5, large $3 / $15. Read
  the chosen vendor's price list at decision time. A regional premium
  multiplies (for example, 1.1× for Anthropic US-only).

| Band | Per read, typical | Per read, worst | 20 reads/month | 100 reads/month |
|---|---|---|---|---|
| Small | $0.002 | $0.004 | $0.04 – $0.08 | $0.18 – $0.41 |
| Mid | $0.007 | $0.017 | $0.14 – $0.33 | $0.70 – $1.65 |
| Large | $0.021 | $0.050 | $0.42 – $0.99 | $2.10 – $4.95 |

At these volumes cost is not the constraint. The caps guard against a loop.
The ceiling they allow is 100 reads a day for 30 days at the large band's
worst case, about **$150 a month**.

## 8. Tests

### 8.1 Invented fixtures only (phases 1 and 2)

All in the repo, all invented, each line carrying the sentinel (§5).

- **Redaction** (`redact.test.ts`):
  - a table of invented emails, phones (separators, `+1`, extensions, dots,
    spaced digits), money (`$1,250.00`, `1250 USD`, `Rate: 1,250`),
    labelled contacts, MC/DOT numbers and URLs: each masked;
  - ZIPs, times (`0800`, `14:00`), dates and street numbers: not masked;
  - running it twice changes nothing;
  - the re-scan finds nothing on output;
  - page selection keeps page 1 and pages with city lines.
- **Schema** (`model-read.test.ts`): it rejects extra keys, a `Z` or offset
  time, 21 stops, a missing quote, and a quote of four lines.
- **Verifier** (`verify-read.test.ts`), one case per row of §3's table, both
  ways. Also:
  - a quote that is not in its cited lines;
  - the right quote cited from the wrong line;
  - a quote resting on `[PHONE]`;
  - a bare `8:00`;
  - a year-less date inside and outside the window;
  - a load number with no format at all, which verifies by provenance alone
    (§12.21);
  - a fixture whose text tries to instruct the model, read through the fake
    adapter with a hostile scripted reply: every unverified value comes back
    blank.
- **Fill** (`ratecon-fill.test.ts`):
  - a verified model read fills through `fillLoad` with every field marked;
  - a 3-hour window becomes FCFS receiving hours, marked;
  - the zone follows the state.
- **Route**, with the fake adapter and the test database (`fleet_test`):
  - auth: none gives 401; a viewer gives 403;
  - flag off gives 404;
  - the rate limit; the daily cap, with concurrency, so two requests at
    cap−1 let exactly one through;
  - 413 on size and 422 on a planted phone;
  - each adapter failure code;
  - invalid output;
  - the adapter is never called on any refusal;
  - the sentinel never appears in console, Sentry or the DB;
  - no Sentry AI integration is installed.
- **Strip** (`ratecon-strip.test.tsx`):
  - the button only after a miss, with the line count;
  - Cancel;
  - each failure sentence;
  - the Replace question;
  - nothing fills on failure.
- **Bundle:** the key's value is not in `.next/static`.
- **E2e:** one flow through the fake adapter. If giving the e2e server
  `LLM_READER_VENDOR=fake` would need a Playwright config change, stop and
  ask first. The button appears only after a miss, so baseline 7f, which
  shows the idle strip, should not move; if any baseline moves, stop and
  show Alex.

### 8.2 Real samples (phase 3, separately approved)

**Nothing in this subsection runs until Alex approves it in writing, in
that session.**

**Step 0, local, no network.** Run redaction and page selection on every
text-layer sample. Report counts only, per file by number:
- lines in, lines sent;
- masks per category;
- residual detector hits (must be 0).

Then **Alex** reads the redacted text of each file locally, in a dev-only
viewer that sends nothing. The agent never prints it. Alex either signs off
the redaction or lists what it missed. Misses are fixed with invented test
cases and step 0 is re-run.

**What Alex must approve before step 1:**
- the vendor, account and settings: zero retention or equivalent, region,
  model;
- which files, by count and number;
- how many runs per file;
- the spend ceiling.

**Ground truth.** The score is only as good as `expected.json`, which today
covers 7 of 28 files. Alex writes ground truth for the 12 unrecognised files
first. The 13 template-read files serve as a control: the template's fill is
known to pass.

**Step 1.** `npm run ratecon:eval-ai`, local only. It refuses to run without
a flag naming the approval date, and sends only the approved files' redacted
text through the real adapter. It stores nothing: replies are scored in
memory and discarded. It reports, per file by number, never a value:
- outcome code, tokens and cost;
- per field: verified, blank-and-marked, and against ground truth `exact`,
  `marked` or **`WRONG`** (verified, filled, and not what the PDF says).

**The bar for leaving the flag on.** Zero WRONG on the load number,
stop count, order and type, street, ZIP, city and state, the same bar the
templates meet. Appointments are scored as `ratecon:score` scores them.

## 9. Phases (stop at each)

1. **Redaction, schema, verifier, fake adapter.**
   - **Pure code and tests:** `redact.ts`, `model-read.ts`,
     `verify-read.ts`, the `'model'` layout branch in `fillLoad`, and
     `FakeReaderAdapter`.
   - **Not in this phase:** no route, no UI, no table, no network.
   - **Size:** about the size of `9e13148`, perhaps 600–800 lines with
     tests.
2. **Server route, real adapter behind the flag, UI.**
   - **Changes:** the route, `LIMITS.llm`, the `ratecon_ai_reads` migration
     with RLS, env vars and guards, the Sentry hardening, the one real
     adapter for the vendor Alex picked, and the strip's button and states.
   - **Flag:** off in production.
   - **Needs first:** the vendor choice, and §10's answers on items 1 and 3.
3. **Real-sample evaluation,** as §8.2, under its own approval. The result
   decides whether the flag goes on.
4. **OCR for scans.**
   - **The interface, and nothing more is designed:**
     `linesFromScan(file): Promise<PdfOutcome>`, in the browser, yielding
     `Line[]` with pages and positions. Scans then take the same path:
     templates, then Read with AI.
   - **OCR assets are self-hosted.** The document never leaves the browser
     for OCR.
   - **The limit to know now:** quotes verify against the OCR text as sent,
     not against the paper. An OCR error that the model faithfully quotes
     will verify. Everything stays marked Check.

## 10. Open questions, and what I think is a bad idea

**Where the request needs changing.**

1. **"Everything marked Check" has no way to clear a correct field.**
   - **Today:** a Check mark clears only when its field is edited
     (`fillAfterEdit`), and marks do not block Save.
   - **The result:** a two-stop AI read leaves about 13 marks that never
     clear. "13 fields to check" would sit on every AI-filled load, and
     dispatchers would learn to ignore Check. That weakens the marks the
     templates leave too.
   - **Proposal:** a per-stop **Looks right** button that clears that
     stop's AI marks (one click a stop). AI marks counted apart from the
     rest ("2 stops read by AI to confirm · 1 field to check").
   - Needs Alex's decision before phase 2.
2. **Showing only the line count hides what leaves.** A dispatcher cannot
   tell whether a name slipped through. Proposal: a **Show what is sent**
   expander with the redacted, numbered lines, in the browser only, sending
   nothing extra. It costs one disclosure.
3. **The per-user rate limit is not a guard on Vercel.**
   - **The brief is stale:** `PROJECT_BRIEF.md` line 310 still says no
     route is rate-limited, but `src/server/rate-limit.ts` limits at least
     ten.
   - **Its store is in memory,** and on serverless it resets per instance.
   - **This design** puts the real guard, the daily cap, in Postgres.
   - **Worth a decision of its own:** moving the shared limiter to a
     Postgres store for every route. Out of scope here.
4. **Redaction cannot promise "driver names stripped".** It strips labelled
   names. An unlabelled name in a signature block or a sentence goes through.
   If Alex needs a guarantee, only the evaluation's manual review gives
   evidence, and only for the samples.

**Questions.**

5. **The basis for "sending is allowed."** Was it checked against the
   brokers' confidentiality clauses (old open decision 2), or is it a
   business judgment? I'd like the basis written down, whichever it is.
6. **Is EU processing required?** The app runs in Dublin, but the loads are
   US. If EU processing is required, Anthropic's own API is out today (no EU
   option), and OpenAI needs approval first.
7. **Flagged content.** Most vendors keep flagged inputs: Anthropic up to 2
   years, OpenAI and Mistral 30 days, Google 90 days, Azure for review. Is
   that acceptable for redacted rate confirmations?
8. **Caps.** 25 reads a user a day and 100 in all: right numbers?
9. **Who may use it:** dispatchers and admins, as proposed, or admins only
   at first?
10. **Year-less dates.** Is the −1 to +30 day window rule (§3) acceptable,
    or should a year-less date always be left blank and marked?
11. **Ground truth for evaluation.** Will Alex write `expected.json` entries
    for the 12 unrecognised files before phase 3?
12. **How long to keep `ratecon_ai_reads` rows,** which hold counts only:
    90 days?

**Noticed while reading.** `src/lib/ratecon/lines.ts:2` said "all three
template readers"; fixed in phase 1.

## 11. Where the build differs from this proposal

Found while building, and kept in the sections above. Phase 1:

1. **AI marks are their own kind** (Alex's answer to §10 item 1), not
   "Check: read by AI" on every field. Looks right clears them per stop; the
   load number needed its own control, which the per-stop button did not
   cover (`confirmAiLoadNumber`).
2. **A hostile document can steer a value that is in the text** (§3,
   Prompt injection). The design said injected values would fail
   verification; one that is literally in the text verifies.
3. **Redaction had two holes:** the placeholders `[PHONE]` and `[EMAIL]`
   matched the contact-label rule and were mangled; and an email split
   across two cells passed the re-scan, its domain masked as a web address
   first. Fixed: a label is never the word inside a placeholder, and any
   `@` left after masking fails closed.
4. **The time rule was stricter than the documents.** "HH:MM with a
   leading zero or an hour of 13 or more" would have lost the end of
   "08:00 - 10:00". HH:MM now counts as 24-hour when the quote shows a
   24-hour clock anywhere in it. A bare "8:00" or "10:00" alone is still
   never read.
5. **Marks quote only the document; values are its spelling** (§3, step 5).
6. **`server-only` in tests:** mocked per test file, as the repo's server
   tests already do, rather than an alias in the Vitest config.
7. **The model could not know the year.** "No year: the current year" is
   replaced by today's date in the dispatch zone, sent with the request
   (Alex, 2026-10-13).
8. **`no-console` needed help:** an override that sets only the severity
   keeps the base allow-list (`warn`, `error`, `info`), and ESLint refuses
   an empty one. `console` is a restricted global on those paths instead.

Phase 2a:

9. **The reservation moved after the body's checks** (§4): reserved first,
   a malformed, oversized or unredacted request would have spent one of
   the day's reads with no vendor call, and a stale client could drain the
   cap.
10. **A version mismatch is its own code,** `outdated` (409, "This page is
    out of date. Reload it and try again."), and a malformed body is
    `bad_request` (400); the design had neither. A 401 or 403 is
    `forbidden`.
11. **The rate-limit 429 is the shared `rateLimitResponse`,** whose body
    carries no code; the browser reads a 429 without one as
    `rate_limited`. The repo's guard requires every route to use it, and
    now reads a route together with the `@/server/**/handle-*` module it
    delegates to, accepting `llm` as a per-user limit.
12. **The counts table stores no model and no text vendor** (§5, The
    database): "no text column" was meant literally.
13. **Ten AI integrations, not "where the version ships one"** (§5):
    they are installed by default with tracing on, today.
14. **The daily-cap race test had to force the collision.** Started
    together, two reservations barely overlap and a race passed by luck.
    The test holds the table in SHARE mode so both block, then releases
    them at once; it counts only waits on this table and the reservation's
    lock, because other suites in `fleet_commit` hold locks too.
15. **The e2e needs the server's env,** which only the Playwright config,
    the npm script or `.env.local` can give the e2e server. Waiting on
    Alex; until then the spec probes the route, sees 404, and is skipped
    with that reason.
16. **Not built in 2a:** a real adapter (no vendor) and the `.next/static`
    key scan (no key yet). The shared limiter's weakness on Vercel stays a
    later decision.
