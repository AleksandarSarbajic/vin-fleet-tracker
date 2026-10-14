# Language-model reader: design proposal

> **Status, 2026-10-14.** Phases 1, 2a and 2b are built (§9). The vendor is
> **Anthropic** (Alex, 2026-10-13/14): `claude-haiku-5-5`, with
> `claude-sonnet-5-5` as the fallback, switched by env alone. The reader is
> behind `LLM_READER_ENABLED`, off by default, and OFF in production. No
> text from `.samples/` has been sent anywhere, and none may be without a
> separate go-ahead from Alex (see §8.2); the only live calls so far carried
> invented text (§11, phase 2b). Where the build differs from what was
> proposed, §11 says so, and the sections below are updated to match.

## Decisions this rests on (Alex, 2026-10-13)

- Sending a rate confirmation to a vendor is allowed. Scope until Alex says
  otherwise: **redacted text only**. Rates, broker contacts, phones, emails
  and driver names are stripped in the browser before anything leaves.
- Vendor: **Anthropic** (2026-10-13/14). Models: Haiku 5.5, Sonnet 5.5 as the
  fallback; no other id is accepted (Fable and Mythos require 30-day
  retention; Opus costs far more).
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
> **Read with AI** — sends 46 lines with phones, emails, rates and the names
> it recognises removed; a name it does not recognise can still go through, so
> read “Show what is sent” before you click.

(Before `redact-2026-10-14.3` it read "…with rates, contacts, phones, emails
and driver names removed. Nothing is saved until Save." That claimed more than
the code does, so it was reworded; see §2, The claim. The save is still
unsaved until Save: the fill messages say so.)

The number is the count of lines that would be sent after redaction and page
selection (§2). Nothing else from the document is shown.

**While reading.** "Reading with AI…" and a **Cancel** button. Cancel aborts
the request in the browser; the server's own timeout ends the vendor call.
Typing into the load folds the strip as today but does not cancel the read.

**After a successful read.** A read is a PAIR (§3, §4; built in 3m): two
model reads of the same lines, each verified, merged so that only what both
said stands.
- The existing Replace or Keep mine question comes first if a load number
  or address was already typed.
- Then the form fills through `fillLoad`, as with a template. Under the
  strip's line, in the fault tone, the agreement's notices when there are any:
  "The two AI reads found 1 and 2 stops. The 2 shown are the read with more;
  check each against the document." and "The two AI reads differed on 3
  fields; each is left blank and marked." Each blanked field carries its own
  mark. The strip says:
  "Filled 2 stops, read by AI. Check each stop against its quote, then press
  Looks right. Nothing is saved until Save." Its line says "2 stops read by
  AI to confirm", apart from "fields to check".
- Each AI-filled field's source line reads "Read by AI from p.2: “…”"
  (or "from the pasted text"), quoting the cited sent text. A blank field
  says why it is blank. Each stop has **Looks right**; the load number has
  its own.
- The session counts gain "N read with AI" (counts only, this tab).

**After a failure.** One line in the strip's fault tone (§5), and nothing
fills. When the pair failed — either read, at the vendor, the schema or the
verifier — the line says the AI read did not complete, then that code's own
sentence. The button stays, so the dispatcher can try once more or type the
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
| Phone and fax numbers | NANP patterns with separators, `+1`, extensions; bare 10-digit runs after a phone, fax or cell label; and (rule A, below) a bare 10- or 11-digit run with an assigned area code and no identifier label before it | `[PHONE]` |
| Money | `$` amounts (any spaces after the `$`, since 3a-2), amounts with `USD`, and any number on a line labelled Rate, Line Haul, Total, Fuel, FSC, Accessorial, Detention, Lumper, TONU, Pay or Amount | `[AMOUNT]` |
| Labelled contacts | the value after Contact, Dispatcher, Broker Rep, Agent, Rep, Booked by, Driver, Driver Name, Driver Cell, Truck #, Trailer # | `[REMOVED]` |
| Carrier and broker identifiers | MC and DOT numbers | `[ID]` |
| Web addresses | pattern | `[URL]` |

**Two passes** (phase 3a-2, 2026-10-14). Each cell is masked on its own;
then the cells, joined as they are sent, are masked again with the same
detectors (emails, web addresses, MC/DOT numbers, phones, `$` and USD
amounts). A value split across cells is whole only in the joined line:
`ops@` | `example.com`, `Call 612-555` | `0147`, `MC#` | `123456`. Any `@`
still left takes its whole token, and, at a cell edge, the word touching it
across the boundary, so a local part split from its `@` goes too. Labels are
not re-run. The pass is idempotent: a placeholder matches no detector.

**A third pass: a person's name that outruns its label's cell** (phase
3a-3, 2026-10-14; Alex decided to close the gap). On the joined line, split
back on the cell gap. After a PERSON label (contact, dispatcher, broker or
carrier rep, agent, rep, booked by, driver):
- in the label's own cell, the name-like words after its placeholders go:
  `Contact: [PHONE] Dana Example` sends `Contact: [PHONE] [REMOVED]`;
- if that reaches the cell's end, the following cells go while each is
  name-like, at most 3. A cell of placeholders only is passed over, not a
  stop (`Contact` | `[EMAIL]` | `Dana` is `Contact` | `[PHONE] Dana` cut
  differently). A cell starting with placeholders loses its leading
  name-like words. A cell with a label of its own ends the walk.
- **Name-like:** letters, spaces, apostrophes, hyphens and periods; no
  digit, colon or comma. So a ZIP, a time, a date, a street number, a load
  number and `Fargo, ND` each stop it.
- Only person labels walk on: after `Phone:` or `Shipper:` nothing changes.

**The re-scan has its own check,** written apart from the mask: a person
label still followed by a name-like word (in its cell) or cell (past
placeholder-only cells) is a `labelled` hit. It has NO limit, so a fourth
name-like cell past the mask's three refuses the document.

**Rule A: a bare phone** (version `redact-2026-10-14.3`, 2026-10-14). Found
in the text "Show what is sent" displays: a phone in a table cell after an
address cell, and an 11-digit number starting with 1 in a driver row, both
sent. The old rule left a bare run of digits "because it could be a load
number". Now, on the line as it is sent (and again after the later passes, so
a cell they mask cannot leave a number without its label):
- a run of **exactly 10 digits, or 11 starting with 1**, alone (not inside a
  longer number, a word, a hyphenated id or a decimal), is `[PHONE]` when its
  area code is **assigned**: a static set in `nanp-area-codes.ts` (the NANPA
  list, US, Canada, Caribbean and the toll-free codes; a snapshot, not
  exhaustive of future codes, and typed by hand — to be diffed against the
  NANPA download);
- **left alone:** a number just after an identifier label, in its cell or the
  one before (load, order, pro, bol, po, so, si, ref, reference, shipment,
  pickup, delivery, confirmation, tracking, trip, stop #; `#`, `No.`,
  `Number`, `ID` may sit between); a number whose area code is not assigned
  (a 10-digit load number starting 200); a run of more than 11 digits;
- the phone-word rule stays, so `Tel 6125550147` is masked with any area code;
- **the re-scan checks it too:** a bare phone that is not guarded is a
  `phone` hit, and nothing is sent.

**Rule B: a name in the row below a person header** (same version). A header
row — `Contact` | `Phone` | `Email`, or `Driver Name` | `Driver Cell` — has
its cells masked by the label rule, but the values are on the NEXT line.
- **Header** (widened in `redact-2026-10-14.4`, sample 17): a line with a
  cell that is a person label, **whatever follows it**. Either the cell is
  nothing but header-vocabulary words with a person role among them (contact,
  dispatcher, rep, agent, booked by, driver, name, phone, cell, email,
  carrier, broker, truck, …: `Contact`, `Booked by:`, `Carrier Contact`,
  `Driver Cell`), or the first pass left a person label at the START of a
  cell followed by nothing but placeholders (`Contact 612-555-0147`). Not a
  label inside a longer cell (`Please contact`, `Sales Rep`). In `.3` the
  label also had to be the last cell or be followed by another vocabulary
  cell; on sample 17 the cells after `Contact` were not vocabulary and the
  label rule had already turned them into placeholders, so the row below was
  sent with two names. **The cost:** `Contact:` | `Dana Example` (the value
  beside the label) is now a header too, because a value and a header cell
  are the same thing once masked; the line below it is masked by row, so a
  facility name right under a contact line goes.
- **Masked:** every cell of the next line (and of the one after it, if the
  next is blank or only placeholders — and no further) that is one to four
  words of letters, spaces, hyphens, apostrophes and periods, as
  `[REMOVED]`; placeholders beside the name stay (`Dana Example [PHONE]` is
  `[REMOVED] [PHONE]`). **By row**: there is no column alignment to go by.
- **Kept:** an ALL-CAPS cell with a company WORD (INC, LLC, LTD, CORP, CO,
  LOGISTICS, FREIGHT, TRANSPORT, TRUCKING, EXPRESS, GROUP, SERVICES,
  SOLUTIONS, DISTRIBUTION, WAREHOUSE, DC) — a whole word, in an all-caps
  cell. An all-caps cell of one to four words with none of them is a name and
  is masked (`ZORBLAT QUENBY`); `COLE QUENBY` is not kept for containing `CO`,
  and `Zorblat INC` in mixed case is not kept; a state; a run of weekdays; and
  anything with a digit or comma — a ZIP, a city line, a street number, a
  date, a time, a load number. (`cityLine` is therefore not needed: a city
  line has a comma and digits. No street-like test existed in the code; a
  digit-free one would only unmask surnames like Lane, so a number-less
  "Main St" is masked.)
- **In doubt, masked.** `Prairie Cold Storage` and `Example Logistics Inc`
  in mixed case under a person header go; that is the cost.
- A line that is itself a person header is not a row of values: it masks its
  own next line. Never across a page. Nothing outside those rows is touched.
- **The re-scan has no memory of other lines,** so it does not check rule B.

**Rule C: a name before " at <COMPANY>"** (version `redact-2026-10-14.5`,
2026-10-15). Found on the first page of a C.H. Robinson carrier load
confirmation, where it names the carrier's rep: `Dana Example at ACME FREIGHT
INC - T1234567`. No label, so no other rule saw it.
- **The shape:** two to four Capitalised words (letters, apostrophe, period,
  hyphen), then ` at `, then a company or an ID: an ALL-CAPS word of two or
  more characters (`ACME`, `T1234567`), a number of six or more digits, or an
  `[ID]` the id rule had already made. The NAME part becomes `[REMOVED]`;
  ` at <rest>` stays. Anywhere in a cell, across the cell gap in the joined
  pass (`Dana Example at` | `ACME FREIGHT INC`; `Dana` | `Example at ACME`).
  Run in both passes; the joined pass alone gives the same text (the cell pass
  is defence in depth). After the label rule, which masks a labelled value
  whole, company and all.
- **Also:** `<Name> with <COMPANY>` (the company must be ALL-CAPS letters: an
  ID or a number is not enough, so `Loaded Trailer with ABC123` passes), and
  `<Name>, <Role> at <COMPANY>`: the name goes, the role stays. A role is a
  role only with a role word in it (manager, director, agent, sales, …);
  otherwise what follows the comma may be the name, and the name before `at`
  is masked instead.
- **Untouched:** a facility or function word ends the run (pick up, check in,
  arrive, dock, gate, door, warehouse, delivery, appointment, stop, …): `Pick
  Up at DOCK 4` and `Check In at GATE B` pass; `Call Dana Example at ACME`
  loses only the name; a single word, lower case, `at Dock 4`, `at 08:00`,
  `at Gate B`, `at 8 PM`, `at PM`, a mixed-case company, `atACME`.
- **In doubt, mask:** the run may begin inside a word (`d'Arcy Example`
  becomes `d'[REMOVED]`); an ALL-CAPS name is a name; five Capitalised words
  mask the last four.
- **The re-scan checks it,** with the same detector, so a miss fails closed
  (`labelled`). It is a miss only if the text changed after the mask.
- **Known limit:** a name with no company or ID after it (`of the carrier
  desk`), `Last, First at ACME`, a company in mixed case, a name next to a
  facility word it takes for a place, and every way of introducing a name this
  does not know. On the 28 samples that existed, rule C fires on none; on the
  C.H. Robinson file added on 2026-10-15 it fires on one line, once.

**The claim.** The strip said "rates, contacts, phones, emails and driver
names removed". `redact.ts` says it is not a guarantee, and rules A and B
exist because the claim was wrong. It now says what is true: phones, emails,
rates and the names it can recognise are removed; a name it cannot recognise
can still go through; read what is sent before you click.

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
  - a labelled name that shares a later cell with a non-name word:
    `Dispatcher: Dana` | `Example x22` sends `Example` (the walk takes
    whole name-like cells only), and the re-scan agrees with the mask;
  - a name on the line after its label: the walk is within one line. Since
    rule B, one case is closed: the line below a header row that names a
    person. A name further down, or under a header that is not a person
    label (`Carrier`, `Name`), still goes through;
  - a name of more than four words, or in a cell with a digit or comma, under
    a person header;
  - a name with no company or ID after it, or in a form rule C does not
    know (`Last, First at ACME`); a company in mixed case after `at`;
  - a bare phone with an area code assigned after the list was written, in a
    cell right after a `Pickup`, `Ref` or similar cell, or with letters
    stuck to it;
  - a name after a contact label that is not a person label (`Phone:`
    | `[PHONE]` | `Dana`);
  - a broker's company name in a page header;
  - a contact detail written in a way no pattern expected.
- **Known over-masking:**
  - a load number made of 10 bare digits after a phone label would be
    masked, and that field would then come back blank and marked; since
    rule A, so would one with an assigned area code that has no identifier
    label in its cell or the one before (a load number under a `Load #`
    header on the line above);
  - under a person header, a facility or company name in mixed case, and a
    street name with no number;
  - a facility name in the cells right after a person label goes with the
    name (`Contact:` | `Dana` | `Prairie Cold Storage`).

  We accept both: masking too much loses a field; masking too little sends
  a phone number or a name.

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
| Time | `timeQuote` holds a time our parser reads as that time: AM/PM (a start with none takes its end's, "7-10 AM", never past its end), four digits (`1400`), or `HH:MM` when the quote shows a 24-hour clock — a leading zero or an hour of 13 or more anywhere in it, so "08:00 - 10:00" reads both. A bare `8:00` or `10:00` alone is never guessed (§12.122) — unless the DOCUMENT is 24-hour (below) | `unreadable`, quoted |
| Flag | APPT, appointment, FCFS or first come appears in that stop's quotes | flag set to null |

**A 24-hour document** (phase 3x, 2026-10-15). A real C.H. Robinson load had
`08:00-15:00` on the pickup and `Delivery Time: 11:00 Appt.` on the delivery;
the AI read both correctly and the verifier discarded both. Two causes, two
fixes in `verify-read.ts`:
1. **A date ate a time.** The numeric date pattern matched `00-15` inside
   `08:00-15:00` and the date blanking removed it, so every time in the quote
   vanished. A numeric date now never starts right after a colon or ends right
   before a colon and a digit (`10-11:30 AM` and `13:00-17` too). A year after a
   named date is 2020 to 2039, so `Oct 14 0800` is a date and a time.
2. **The document's clock.** Computed once from the lines that were sent: the
   document is 24-hour when it holds at least one unambiguous 24-hour time
   (`HH:MM` with an hour from 13 to 23, or a two-digit hour with a leading zero:
   `08:00`) AND no time with AM/PM anywhere. Then a bare `HH:MM` in a quote is
   read as 24-hour. With any AM/PM time, or no 24-hour evidence, nothing
   changes: `11:00` alone is not guessed. The model, the prompt and the schema
   are unchanged. The ground truth follows the same rule
   (`ground-truth-howto.md`).

3. **Convert, then apply the existing rules unchanged.**
   - The verified stop becomes a `StopRead` and its time a `TimeRead`
     (`exact`, `range`, `unreadable` or `none`).
   - `appointmentFrom` then applies the two-hour rule: an APPT window of
     two hours or less, FCFS receiving hours when longer, overnight marked.
   - The zone follows the state and ZIP (§12.120).
   - The server converts to UTC on Save, as it does today.
   - Nothing about appointments is new, except one thing (phase 3v,
     2026-10-15): **an appointment the AI filled is never silent.** Whenever a
     `model` read fills an appointment (enabled, with a time: APPT or FCFS,
     exact or a window), the stop's appointment field carries a check, after
     any it already had: "Check: the AI filled this appointment. Confirm the
     date and time against the PDF." See "The case agreement cannot see",
     below.
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

**The dropped-stop cue** (`src/lib/ratecon/address-cue.ts`, phases 3c and
3d, 2026-10-14). The verifier checks each value against its quote and never
counts stops, so a read that leaves a stop out verifies cleanly (evaluation
run 1, sample 22). After verification, the strip names the sent lines that:
- look like a US city, state and ZIP (`cityLine`, on the line or any cell);
- no quote in the text covers (a made-up citation covers nothing);
- come AFTER the first line any stop was read from (3d).

It says "N lines that look like addresses were not used: L12, L45", with
"Show what is sent". It blocks nothing and changes no mark.
- **It cannot catch a dropped FIRST stop:** its lines come before any stop
  the read kept.
- **It cannot tell a stop from another address after the stops,** such as a
  remit-to or a footer.
- **Measured offline, with nothing dropped:** 1 of 6 control files and 5 of
  13 template-read files. Without the "after the first stop" rule (3c) it
  was 5 of 6, because a header's addresses come before the stops.

**Two-read agreement** (`src/lib/ratecon/agree-reads.ts`, phase 3d; in the
app since phase 3m). Two reads of the same lines, each verified, merged so
that only what both said stands. The browser strip and `ratecon:eval-ai
--pairs` both call ONE function for it, `readPair` (`read-pair.ts`):
verify each reply against exactly the lines sent, `agreePair`, then the cue
(a line EITHER read cited is used) — so the evaluation measures what the app
runs and the two cannot drift:
- **When the stop counts differ,** the read with more stops gives them, and
  a notice names both counts.
- **Stop by stop, by index,** a field they differ on is left blank and
  marked "The two AI reads differed." An appointment that differs in any
  part is blanked and marked whole.
- **A field both left blank or unconfirmed stays as it was.**

It catches a read that drops a stop or wanders on a value. It CANNOT catch
the same mistake made twice: run 1's sample 27 appointment was WRONG the
same way in 3 runs of 3. Comparing by index blanks the stops after a
dropped middle stop: the safe side.

**The case agreement cannot see: both reads wrong, the same way** (phase 3v,
2026-10-15). Evaluation run 10 had one: stop 1 of one file, an appointment
filled wrong by BOTH reads. They agreed, so nothing blanked it, and it had no
check, so nothing told the dispatcher to look. Nothing in the reads can catch
that; the form can: **every appointment a model read fills carries a check**
(`fillStop`, `AI_APPOINTMENT_CHECK`), appended after the date, window or flag
check it already had. Not for a template read (it is not the AI's), not for a
blank appointment or one the pair blanked and marked (each has its own check).
The dispatcher clears it as any check: by editing the appointment. "Looks
right" clears the AI mark, as it does for every field, not a check. "Fields to
check" rises by the appointments that gained one; the outcome counts are
unchanged (a filled appointment is still counted as filled). The evaluation
now scores a filled appointment "marked", never "exact" or a silent WRONG: its
per-part lines still say what differs.

**What it costs in the app** (3m):
- one read is two calls, made in parallel, so the latency is about one
  call's;
- **the cap counts reads, and a pair is ONE read** (Alex, 2026-10-14):
  one reservation, two vendor calls. A failed pair is one read too (§4,
  §5). The count per read is unchanged; the spend per read doubles;
- about **$0.0033 a pair** on Haiku 5.5, from run 6's measured $0.0502 for
  15 pairs (30 calls); run 1 measured $0.0016 a single read. The caps
  (25 a user, 100 a day) and the per-user rate limit (3 at once, then 1 a
  minute) are unchanged and count reads, not calls.

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
   - **Two-read agreement** (§3; decided 2026-10-14, built in 3m): a pair
     is ONE read against the cap. It makes one reservation, then both calls.
     The row's outcome is the pair's, and its tokens are both calls'
     summed (empty, not zero, when neither call reported any). `lines_sent`
     is the lines once. A pair that fails is still one read against the cap,
     as a failed single read was. The table has no new column and no
     migration: one row now means one pair.
   - **RLS** is enabled with deny-by-default policies, like every table.
6. **Size limit.** The request's `content-length` must be at most 64 KB,
   read through a capped reader. The body is parsed with Zod:
   - at most 400 lines, each at most 500 characters, 24,000 characters in
     all;
   - a `redactionVersion` string that must match the server's.

   Over the limit gets 413 with a fixed message.
7. **Redaction re-check** (§2). Any hit gets 422, with no vendor call.
8. **The vendor calls** (a pair: TWO, with the same redacted lines, made
   at once through the adapter, §6) under one `AbortSignal` of 25 s joined
   with the request's own, so a timeout or a Cancel reaches both (a
   dispatcher's Cancel is recorded as `cancelled`, not `timeout`). The request carries **today's date in
   the dispatch zone**, so a date with no year can be read (Alex,
   2026-10-13); the verifier stays the judge of the year. No retries in the
   first release: a failed read costs one click, never a loop.
9. **Parse each reply** with `ModelRead.safeParse`. The route returns
   `{ ok: true, reads: [A, B], readId }` or `{ ok: false, code }` (§5). Either call
   failing, at the adapter or the schema, fails the request with read A's
   code, else read B's, and returns neither reply. It does not verify or
   merge; the browser does, with `readPair`, against the text it holds. The
   route stores nothing but the counts row.

**What the dispatcher did with a read** (Alex, 2026-10-14; migration 0028,
`POST /api/ratecon/outcome`). A real-world trial needs accuracy evidence, and
the counts row says only what a read cost. So, once per read that filled the
form, at the FIRST save of the load after the fill, the modal tells the server:
- **per field name** (load number, stop type, street, city, state, ZIP,
  appointment), summed over stops, one outcome each: a field the read FILLED
  is **kept** (saved as it was), **changed**, or **cleared** (saved empty, or
  its stop removed); a field the read left **blank and marked** is
  **blank-filled** by the dispatcher or **blank-left**. A value is compared
  trimmed, and by value, so a field edited and put back is kept.
- **Never** a value, a quote, an address, a load number, a file name or a
  field's text. The browser compares the values in its own memory and sends
  counts. The tables hold a read id and numbers (below).
- **Tables.** `ratecon_ai_outcomes`: one row a read, its primary key the read
  (a foreign key to `ratecon_ai_reads`, `ON DELETE CASCADE`) — the once-per-read
  marker. `ratecon_ai_outcome_fields`: one row a (read, field name), with
  `kept`, `changed`, `cleared`, `blank_filled`, `blank_left` as small ints,
  checked against what a read can fill (one load number; at most 10 of any
  other field). The field names are an enum. RLS on, deny-by-default. They go
  with the read when its row is deleted at 90 days, so **an outcome lives 90
  days**: read the numbers inside that, or copy them out.
- **The route.** The read response carries `readId` (the counts row's id). The
  modal posts `{ readId, fields }`. The server: the address limit; a
  dispatcher or admin; the reader on (off: 404); the user's `write` limit, not
  the reader's three-a-minute; a 4 KB body (2 KB before the layout); a strict Zod parse (an unknown key,
  a field name off the list, a negative or large count, counts that add up to
  more than a read can fill, or a field twice is a 400); then the read must be
  **the caller's own and `ok`** — anyone else's, none, or a failed pair is the
  same `unknown_read`. The marker is inserted `on conflict do nothing`; only
  the post that inserted it stores the counts, in the same transaction, so a
  second post (or two at once) stores nothing and answers `recorded: false`.
- **Which layout it was** (Alex, 2026-10-15; migration 0029). The body also
  carries `layout`: a fingerprint of the document, so the layouts that recur
  can be counted and the ones worth a template seen. The browser takes the
  LABELS in the text it sent — the text just before a colon or a `#` in a cell
  (`Pick Up Date`, `Appointment#`) — lower-cased, digits removed, 2 to 40
  characters and at most five words, ignoring any cell that holds a
  placeholder; and sends the first 8 hex characters of each label's SHA-256,
  sorted, each once, at most 64 (the 64 smallest hashes). **Hashes only:** no
  label text, value, name, address or load number is stored, logged or
  returned. The server accepts an optional array of at most 64 strings of 8
  lower-case hex characters, strictly ascending, and the column
  (`ratecon_ai_outcomes.layout`, additive, with a check that refuses anything
  else) lives and dies with the outcome row: 90 days. It is stored with the
  once-per-read marker, so a second post stores nothing. **Known limit:** any
  text directly before a colon is a label, so a name written `Dana Example:`
  would be hashed; it is 8 hex characters, and the redaction has already run.
  Reads are grouped by Jaccard similarity of their label sets: a read joins the
  earliest read it is 0.7 similar to. `npm run ratecon:layouts-report` prints,
  per group, the reads, the share where the dispatcher kept every filled field,
  the share with at least one change, and the changes by field name
  (HANDOFF phase 3y gives the SQL and how to read it).
- **It is never in the way of a save.** The modal posts AFTER the load has
  saved and does not await it; `recordFillOutcome` cannot throw or reject. A
  failure is counted in the tab (`outcomeNotRecorded`) and shown to nobody; the
  server logs a failure as one line of a reference, a code and a class name
  (`logOutcomeFailure`), never the request or the error's message. It changes
  nothing the dispatcher sees.
- **Not recorded:** a load saved with no AI fill; a template fill (or an AI
  fill the dispatcher replaced with one); a failed pair; a save that did not
  land (the outcome waits for the one that does); a modal closed without
  saving; later saves; the reader off.

**Keys.**
- The reader's settings are parsed by `parseReaderEnv` in
  `src/env/schema.ts`, apart from the app's (2b follow-up). Any problem
  turns the reader OFF and is logged once by setting name, never by value.
  No reader setting stops the app booting, with one exception.
- Never `NEXT_PUBLIC_*`.
- **The exception:** a refine generalised from `hereKeyIsNotPublic`, in
  `AppEnv`, refuses to boot if the key equals any public value.
- Every module with code behind the seam — the fake, the handler, the
  counts, the log line, the live wiring — imports `server-only`, so a
  client import fails the build. Tests mock it per file, as this repo's
  server tests do (no change to the Vitest config).
- **Built in 2b, without a build:** `src/test/reader-key-bundle.test.ts`
  walks the import graph from every `'use client'` module and shows that
  none reaches server code, the env loader, `server-only` or the SDK, and
  none reads the key; only the env schema names it.
- **Built in the 2b follow-up, on the build:** `e2e/reader-key-bundle.spec.ts`
  scans the e2e build's static files for a SYNTHETIC key that `npm run e2e`
  gives the build. It checks itself first: the e2e Sentry DSN, which Next
  inlines, must be found by the same scan.

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
| `unavailable` | vendor 5xx, network failure, 429, 401/403, any other 4xx | "The AI reader is not available right now. Nothing was filled." |
| `vendor_capped` | the vendor's account is out of money: Anthropic's 400 "You have reached your specified…" (a spend limit the account set), its 429 `enforced_spend_limit_reached` (a tier's monthly cap), a 402, or "Your credit balance is too low…" on any 4xx (a prepaid balance run dry) | "The AI reader’s spending limit is reached. Tell an admin." |
| `refused` | the vendor declined, or a content filter fired | "The AI reader declined this document. Nothing was filled." |
| `invalid_output` | the reply failed `ModelRead` | "The AI read came back unusable. Nothing was filled." |
| `cancelled` | the dispatcher pressed Cancel | "Cancelled. Nothing was filled." |

**A pair fails as a whole** (two-read agreement, §3; Alex, 2026-10-14; built
in 3m). When either read of a pair fails, the pair fails, and nothing is
filled. A read fails at the adapter (`timeout`, `unavailable`, `refused`,
…), at the schema (`invalid_output`), or at the verifier
(`nothing_confirmed`).
- **The code** is read A's when A failed, else read B's.
- **Never the read that succeeded:** one read alone is exactly what
  agreement exists to distrust. `agreePair` (`agree-reads.ts`) is the rule
  in code.
- **The strip says the AI read did not complete,** then that code's own
  sentence, which says nothing was filled: "The AI read did not complete. The
  AI reader is not available right now. Nothing was filled." Said for
  `timeout`, `unavailable`, `vendor_capped`, `refused`, `invalid_output` and
  `nothing_confirmed`; not for a code that stops a read before any call, nor
  for Cancel, nor for the server's own `error`.
- **The browser checks the pair's shape too:** a reply list that is not
  exactly two schema-valid reads is `invalid_output`.
- **It is one read against the cap** (§4).

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
  vendor or the model: the vendor is an enum (`fake`, `anthropic`)
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

export type AdapterUsage = { inputTokens: number; outputTokens: number };
export type AdapterResult =
  | { ok: true; output: unknown; usage: AdapterUsage }
  // `usage` when the vendor answered and billed: a refusal, a cut-off reply.
  | { ok: false; code: 'timeout' | 'unavailable' | 'refused' | 'malformed' | 'vendor_capped'; vendorStatus: number | null; usage?: AdapterUsage };

export interface ReaderAdapter {
  readonly vendor: string;
  readonly model: string;
  /** Never throws. Never logs. Never retries. Sends modelInput(lines, today) and nothing else. */
  read(request: ReaderRequest, signal: AbortSignal): Promise<AdapterResult>;
}
```

- The instruction text and the JSON schema are shared, built once from
  `ModelRead`. Each adapter only translates them to its vendor's request
  shape and its structured-output or JSON mode.
- **Corrected in 2b: no "temperature 0".** Claude Haiku 5.5 and Sonnet 5.5
  answer 400 to a non-default `temperature`, any `top_p`/`top_k`, a forced
  `tool_choice` and an assistant prefill, so none is sent. The shape is held
  by structured outputs (`output_config.format`), the reply by the route's
  `ModelRead.safeParse`, and every value by the verifier.
- **The Anthropic adapter** (`src/server/ratecon-reader/anthropic.ts`), as
  built: `system` is the instruction; one user message is `modelInput`;
  `output_config: { effort: 'low', format: json_schema }`; no `thinking`
  parameter (both models then think adaptively, sized by effort; thinking
  bills as output); `max_tokens` 8192; `inference_geo: 'global'`; no
  metadata, no `cache_control`. The client pins `baseURL`, sends no auth
  token, logs nothing, and makes one attempt (`maxRetries: 0`), under the
  route's 25 s signal. `EFFORT` and `THINKING` are constants for phase 3 to
  compare.
- **The schema Anthropic is sent** is `ModelRead`'s, cut to what its
  structured outputs accept and made small enough to compile (§11, items
  21–23): parts used more than once are defined once under `$defs`; every
  property is required; a nullable enum is one enum listing `null`; bounds
  and patterns are dropped — `ModelRead` still enforces them on the route.
- Each adapter sets its vendor's no-storage and region options explicitly
  in code, never by account default alone, and has a test asserting those
  options are in the request. For Anthropic that is the region only
  (`inference_geo`): it has no per-request no-storage option; zero retention
  is an account agreement, outside the code.
- **`FakeReaderAdapter`** for tests and e2e. It is given a script (an
  output, an error code, or a delay), records the `SentLine[]` it was
  handed, and makes no network call. `LLM_READER_VENDOR=fake` selects it.
  With `VERCEL_ENV` `production`, `fake` turns the reader off
  (`parseReaderEnv`).
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

**Measured** (Haiku 5.5): evaluation run 1, $0.0280 for 18 single calls,
about $0.0016 a read; run 6 (phase 3l), $0.0502 for 30 calls in 15 pairs,
about **$0.0033 a read now that a read is a pair**. The doubling is the
vendor spend only: the caps count reads.

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
   - **Built in two parts:** 2a, everything but the adapter, through the
     fake; 2b, the Anthropic adapter, tried only on invented text.
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

Phase 2b (Anthropic, 2026-10-14):

17. **No temperature** (§6): these models refuse it, and every other
    sampling knob; the design's "temperature 0" is withdrawn.
18. **A new failure code, `vendor_capped`** (§5), and a matching outcome in
    the counts table (migration 0027 adds it beside the `anthropic`
    vendor). Besides the 400 Alex named, it covers two cases the docs give
    that mean the same — no money, an admin must act: the 429 of a tier's
    monthly cap (`error.details.error_code: enforced_spend_limit_reached`)
    and a 402 `billing_error`. A prepaid balance run dry was added in the
    follow-up (item 26).
19. **A failed read keeps what it cost.** A refusal or a cut-off reply is
    billed, so its tokens go in the counts row; and every vendor failure
    but a cancel is logged as one line, code and vendor status, so a revoked
    key (401) can be told from an outage (5xx). 2a logged only 500s.
20. **Not the SDK's schema transform.** `@anthropic-ai/sdk` 0.133's
    `transformJSONSchema` moves `enum` and `const` into description text, so
    the grammar would no longer pin `kind`, `type`, `flag` or
    `schemaVersion`. The adapter cuts the schema to the documented keywords
    itself (`anthropicSchema`); a test holds it to that list.
21. **"The compiled grammar is too large"** (smoke runs 2 and 3). As
    generated — the quote inlined 12 times, 13 optional properties, 8 unions
    — Anthropic refused to compile the schema. Making every property
    required and sending the nullable flag as one enum did not suffice
    (run 3). Defining each reused part once under `$defs` did (run 4, 4.2 KB
    from 9.3 KB). `ModelRead` changed only so: the cited text is one
    instance (`CitedText`), used five times.
22. **Two clauses added to the instruction** for the now-required fields:
    `lineEnd` equals `line` for a one-line quote; a range's `endQuote` is the
    same as `timeQuote` when both times are in one quote. The verifier
    already read both so.
23. **Patterns are not in the grammar.** Anthropic's documented keyword list
    has no `pattern`, so `HH:MM` and `YYYY-MM-DD` are enforced by
    `ModelRead` on the route, not by the vendor.
24. **The browser's list of codes is derived** from `READ_MESSAGES`. The
    hand-kept list would have read `vendor_capped` as `unavailable` by its
    503; a test now runs every code through it.

Phase 2b follow-up (config safety, Alex 2026-10-14):

25. **Reader settings fail closed.** In 2b an unknown vendor, an unlisted
    model, a blank or invalid cap, or the fake in production each refused to
    boot the whole app, because every route imports `serverEnv`.
    `parseReaderEnv` now parses them apart and never throws: any problem
    turns the reader off and is logged once as `{ setting, fault }`. Only a
    key equal to a `NEXT_PUBLIC_*` value still refuses boot. A blank cap is
    the default.
26. **A prepaid balance run dry is `vendor_capped`.** Anthropic documents
    the message ("Your credit balance is too low to access the Anthropic
    API…", api-credits-for-subscribers, read 2026-10-14) but not its status
    or error type, so it is matched on any 4xx. The vendor's status is in the
    log line either way.
27. **The key scan on the build** (§4, Keys) uses a synthetic key: the real
    one never enters the e2e run.
28. **`inference_geo` stays `global`** (Alex). Standard pricing; `us` would
    be 1.1×.

Phase 3a-2 (redaction, 2026-10-14):

29. **A second masking pass over the joined line** (§2, Two passes). Before
    it, 9 of the 25 text-layer samples were refused for a residual hit;
    after it, none. The 16 that already passed send byte-identical text
    (compared by hash). `REDACTION_VERSION` is `redact-2026-10-14.1`.
30. **The `$` detector took at most one space** after the `$`, so `$` |
    `1,850` in two cells passed the mask AND the re-scan. It now takes any
    run of spaces. Stronger, not looser: the re-scan is stronger with it.
31. **Labelled names split across cells were a known miss** (§2), found
    while testing. Closed in 3a-3, below.

Phase 3a-3 (redaction) and 3b-prep (the evaluation script, 2026-10-14):

32. **The person-name pass** (§2, A third pass), Alex's rule with three
    refinements: placeholder-only cells are passed over rather than ending
    the walk; a cell with its own label ends it; and the re-scan has no
    3-cell limit, so a longer run is refused, not sent. `REDACTION_VERSION`
    is `redact-2026-10-14.2`. On the real samples, 11 files changed (21
    masks on 20 lines), 14 are byte-identical, and none has a residual hit.
33. **`ratecon:eval-ai` bounds each call without asking the vendor.** "Measured
    tokens" before a call would mean `count_tokens`, which sends the
    document's text a second time. Instead: spent is measured (each reply's
    usage × the price constants); the next call's most is its body's UTF-8
    bytes plus 2,000 tokens in, and `max_tokens` out. A reply billed past
    its bound stops the run; a failure with no usage is counted at its bound.

Phase 3c (2026-10-14):

34. **The dropped-stop cue** (§3) is built as asked: every uncited
    address-like line. Measured offline, it is noisy: with nothing dropped
    it would fire on 5 of 6 control files and 12 of 13 template-read files,
    because every one of those files has more address-like lines than
    stops. A narrowing to lines after the first stop's first line would fire
    on 1 of 6 and 5 of 13. It is measured, not built: it would miss a dropped
    FIRST stop.
35. **The form has no end date,** so appointment diagnostics name `window`
    (an appointment's end) or `end time` (receiving hours' end); an end-date
    error shows as one of those.

Phase 3d (2026-10-14):

36. **Two-read agreement** (§3) is a library and an evaluation mode
    (`ratecon:eval-ai --pairs`), not yet a feature (it is, since 3m: item
    39). The stop type cannot be
    left blank in a read, so a differing type keeps the base read's value
    and is marked. StopRead gains `timeCheck`, which the fill says in place
    of its own appointment check; only agreement sets it.
37. **The cue is narrowed** to lines after the first stop (§3). It now
    misses a dropped first stop, which it caught before; it no longer fires
    on a header's addresses.

Phase 3f (2026-10-14):

38. **A failed pair fails as a whole, and is one read against the cap**
    (§4, §5). This replaces 3d's "two calls against the daily cap". The
    cap counts reads; a pair is one read made of two calls.

Phase 3m (2026-10-14):

39. **A read in the app is a pair** (§3–§5). The route makes two concurrent
    calls under one reservation and returns `reads: [A, B]`; the browser
    verifies and merges with `readPair`, the one function `ratecon:eval-ai`
    calls too. There is no path that fills the form from one AI read
    (`src/test/pair-only.test.ts` fails if one appears). The evaluation's
    default single mode (no `--pairs`) and `reader:smoke` remain as
    diagnostics that fill no form. Three consequences of the decisions above,
    for Alex to weigh: a pair is as
    available as both of its calls (a failure of either fails it); the other
    call is not cancelled when one fails, so a failed pair still pays for
    both; and per-call detail is not kept (one row per pair).

Phase 3s (2026-10-14):

40. **What the dispatcher did with an AI read is recorded** (§4): counts per
    field name and outcome, once per read, at the first save after the fill,
    in two new tables linked to the read's counts row. The read response gains
    `readId`. Counts only, 90 days. Recording is after the save, not awaited,
    and cannot fail it. The queries to read it are in HANDOFF, phase 3s.

Phase 3t (2026-10-14):

41. **Two redaction gaps closed, and the claim made honest** (§2).
    `REDACTION_VERSION` is `redact-2026-10-14.3`: rule A (a bare phone), rule
    B (a name under a person header), the strip's line reworded. Every
    approval that named a sent-text hash is void and must be re-reviewed.
    The known limit stays: a name with no label and no header above it can
    still go through.

42. **Rule B's header widened** (§2; `redact-2026-10-14.4`). A header is any
    line with a person label, whatever follows it (sample 17: two names under
    a carrier header were sent). The doubt goes to masking: a value beside
    the label also makes the line below a masked row. Approvals that named a
    `.3` hash are void.

Phase 3v (2026-10-15):

43. **An appointment the AI filled is never silent** (§3, "The case agreement
    cannot see"). Every filled appointment of a model read carries a check,
    after any it had. It adds to "fields to check"; it does not change an
    outcome count.

Phase 3w (2026-10-15):

44. **Rule C** (§2; `redact-2026-10-14.5`): a name before ` at <COMPANY>`
    (also ` with `, and `<Name>, <Role> at`) is masked, found on a C.H.
    Robinson carrier load confirmation. Approvals that named a `.4` hash are
    void. **Sample numbers shifted:** a new file became 22, so the old 22 to
    28 are 23 to 29; every earlier HANDOFF and design entry uses the old
    numbers, and the next `--files` must use 29 where it meant 28.

Phase 3x (2026-10-15):

45. **The verifier reads a bare `HH:MM` as 24-hour when the document is 24-hour,
    and a date no longer eats a time** (§3, "A 24-hour document"). The model,
    prompt and schema are unchanged. Ground truth: a bare time is a time in a
    24-hour document.

Phase 3y (2026-10-15):

46. **A layout fingerprint is recorded with each AI read's outcome** (§4, "Which
    layout it was"): hashes of the label words, at most 64, on the outcome row,
    90 days. Counts and hashes only. A report groups reads at 0.7 Jaccard.
