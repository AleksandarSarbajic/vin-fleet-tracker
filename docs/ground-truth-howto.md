# Writing ground truth for the rate-confirmation samples

For Alex. The evaluation of the AI reader (`docs/llm-reader-design.md` §8.2)
is only as good as this file. Every example below is **invented**: no real
broker, address, load or time appears in this document, and none may.

## The file

- **Where:** `.samples/rate-confirmations/expected.json`, next to the PDFs.
- **Never committed, copied or pasted anywhere.** It holds real load numbers
  and addresses. `git ls-files | grep -iE "\.pdf|expected\.json|samples"`
  must print nothing.
- **One entry per PDF,** keyed by the PDF's file name. Reports call files
  by NUMBER: name order across all the PDFs. Numbers shift when a file is
  added, renamed or removed.
- **What was added 2026-10-14:** a blank entry for every text-layer file
  that had none, by `npm run ratecon:expected-skeleton`. The 7 entries
  already there were not touched. The 3 scans have none.
  - `"priority": 1`: a layout no template reads. The AI reader exists for
    these: write them first.
  - `"priority": 2`: read by a template, but never checked against the PDF.
    The control group.
- **The backup** of the file as it was is beside it:
  `expected.json.before-skeleton-2026-10-14`. Delete it when you no longer
  want it.

## `null` and `""` mean different things

- **`null` is "not written yet".** Every field of a skeleton is `null`.
  `ratecon:score` skips an entry while any `null` is left.
- **`""` is ground truth:** the document gives no such value.
  - A load number is permanently optional (§12.21): a document with none is
    `"loadNumber": ""`.
  - A stop with no street printed is `"street": ""`.

## What to write: what the PDF says, as a dispatcher would enter it

**Write it from the PDF itself, never from what the app filled.** Copying the
app's answer would make the score agree with itself.

- **Stops:** in the order the document lists them. A skeleton has two; add
  or delete stop objects to match the document.
- **`type`:** `"PU"` for a pickup, `"DEL"` for a delivery.
- **`street`, `city`:** in normal capitalization, e.g. `"4001 Main St"`,
  `"Fargo"`. Many PDFs print ALL CAPS ("FARGO"); the app converts those to
  normal case when it fills, so write the normal-case form.
  - A word with any lowercase letter is left alone by the app, so write it
    exactly as the PDF prints it ("McAllen" stays "McAllen").
  - **Write them WITHOUT trailing punctuation.** The app removes any
    comma, semicolon, colon or period at the end of a street or city
    (`"840 N Thayer Rd."` is filled as `"840 N Thayer Rd"`), so a truth that
    ends in one will score WRONG. Punctuation inside stays: `"St. Louis"`,
    `"N. Main St"`, `"Winston-Salem"`, `"#4"`.
- **`state`:** the two-letter code, e.g. `"ND"`.
- **`zip`:** the five digits as printed, e.g. `"58102"`.
  - **A ZIP below 00501 (such as `00001`) is not a ZIP** (00501 is the lowest
    assigned US ZIP; a broker's system prints a default there). The document
    gives no usable ZIP, so the right ground truth is `""`: the app leaves it
    blank and marks it.

```json
"Example Tender 40417.pdf": {
  "priority": 1,
  "loadNumber": "EX-40417",
  "stops": [
    {
      "type": "PU",
      "street": "4001 Main St",
      "city": "Fargo",
      "state": "ND",
      "zip": "58102",
      "appointment": { "type": "APPT", "date": "2026-10-14", "time": "08:00", "windowMinutes": 120 }
    },
    {
      "type": "DEL",
      "street": "220 Harbor Rd",
      "city": "Duluth",
      "state": "MN",
      "zip": "55802",
      "appointment": { "couldntRead": true, "date": "" }
    }
  ]
}
```

Leave `"priority"` in; it changes nothing in the score.

## Appointments

### Times are stop-local wall time

- **Write the time as printed,** in the stop's own local time. Never convert
  between zones, never apply an offset, never add a zone: the app converts
  later, from the stop's address.
- **24-hour `HH:MM`:** "2:30 PM" is `"14:30"`, "0800" is `"08:00"`.
- **Dates `YYYY-MM-DD`:** "10/14/2026" is `"2026-10-14"`. For a date printed
  with no year, write the year the document means.
- **A bare "8:00" with no AM/PM is not a time anyone can enter.** It is a
  couldn't-read (below), as the app treats it — **unless the document shows a
  24-hour clock elsewhere and has no AM/PM at all** (changed 2026-10-15). Then
  it is a time: "11:00" is `"11:00"`, "8:00" is `"08:00"`. The test is the
  app's, over the text that is sent: the document has at least one time that
  can only be 24-hour (`HH:MM` with an hour from 13 to 23, or a two-digit hour
  with a leading zero such as `08:00`; four digits like `0800` do not count),
  AND no time with AM/PM anywhere in it (a single "8:00 PM", "7-10 AM" or
  "5 p.m." on any line rules it out). Otherwise "10:00" could be either half of
  the day and stays a couldn't-read.

### One time: APPT, no window

Printed: `Pick up 11/03/2026 2:30 PM`

```json
{ "type": "APPT", "date": "2026-11-03", "time": "14:30", "windowMinutes": 0 }
```

A single time the PDF calls FCFS ("FCFS by 15:00") is also written this way.
The app fills it as an appointment at that time and marks it Check.

### A window: APPT up to two hours, FCFS beyond (the two-hour rule)

`windowMinutes` is the window's length, start to end.

- **Two hours or less is APPT with that window.** A 90-minute window stays
  90. Printed `Deliver 11/04/2026 0800-1000 APPT`:

  ```json
  { "type": "APPT", "date": "2026-11-04", "time": "08:00", "windowMinutes": 120 }
  ```

- **Longer than two hours is FCFS receiving hours,** whatever word the PDF
  uses (Alex, 2026-10-13, question (b)). `endTime` is the end, and
  `"marked": true` notes that the app flags it Check; the score does not
  grade `marked`. Printed `Receiving 07:00-15:00 FCFS`, or
  `Appt 07:00-15:00`:

  ```json
  { "type": "FCFS", "date": "2026-11-04", "time": "07:00", "endTime": "15:00", "marked": true }
  ```

- **A window into the next morning** is overnight receiving hours. `date` is
  the START's date. Printed `11/04/2026 22:00-06:00`:

  ```json
  { "type": "FCFS", "date": "2026-11-04", "time": "22:00", "endTime": "06:00", "marked": true }
  ```

### No appointment at all

The stop gives no date and no time:

```json
{ "none": true }
```

### A line that offers alternatives, or that nobody could enter as one time

Printed `Delivery same day by 8 PM, or next day 7-10 AM`. The AI must not
choose one, so the right result is "Couldn't read", left for the dispatcher:

```json
{ "couldntRead": true, "date": "" }
```

- **Give `date` only when the line prints exactly one date.** Printed
  `11/05/2026 8:00` with no AM/PM, in a document that does not show a
  24-hour clock elsewhere (see above):

  ```json
  { "couldntRead": true, "date": "2026-11-05" }
  ```

- **The same form covers** a deadline with no time, a length of time ("2 hr
  window"), and anything else that cannot be typed as one appointment.

## Checking your work

```sh
npm run ratecon:check-expected   # per file by number: complete, blanks left, or where the shape is wrong
npm run ratecon:score            # the templates against the complete entries: pass/FAIL, never a value
```

Neither prints a value or a file name. A shape problem is reported as a
path, e.g. `sample 9: SHAPE — stops.1.appointment: invalid_union`, meaning
stop 2's appointment matches none of the forms above.

## Sample 12

Its entry is `{ "notRecognised": true }`: true for the templates, but it
has no stops, so the AI evaluation cannot score it. Writing its stops means
changing that entry; ask before doing so (HANDOFF, phase 3a).
