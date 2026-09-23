# RM Phone

The new RM Support phone system, built on its own before it moves into CareHub.

It currently runs entirely in the browser against a **pretend phone company**, so
it needs no SignalWire account, no phone number and no database. **All names and
numbers are fake.** Numbers use the 555-01xx range, which is reserved for fiction.

Live demo: https://rmsupportva.github.io/rm-phone/

## What works today

| Area | Behaviour |
|---|---|
| Office hours | Weekdays 9–5, closed Shabbat/Sunday, holidays (Sukkot 2026), candle-lighting early close on winter Fridays |
| Phone menu | Language (1 English / 2 Español), then 1 speak with someone / 2 leave a message. No key: English, then ring the team |
| Ringing | Every available VA rings at once for 30 s, then voicemail. If the last ringing VA declines, the caller goes to voicemail immediately |
| Voicemail | Hanging up during the greeting is a **missed call to return**, not an empty voicemail |
| Softphones | Answer, decline, hang up, dial out, wrap-up, status (available / away / offline) |
| History | Filters (to call back, voicemail, talked, outgoing), details with timeline, recording and a made-up transcript |
| Demo clock | Jump to any moment (e.g. Friday after candle lighting) and speed time up |

## How it is built

```
lib/phone/            plain TypeScript, no React, no vendor. Moves to CareHub unchanged.
  callMachine.ts      the call brain: one pure function decides every change to a call
  hours.ts            open / closed / holiday / early close, in the office time zone
  engine.ts           runs inputs one at a time, carries out effects, fires deadlines
  provider.ts         what any phone company must do (the mock now, SignalWire later)
  mock/               the pretend phone company and fake data
  store.ts            where calls live (memory now, database later)
app/                  the screens (Next.js, static export for GitHub Pages)
```

Safety rules the call brain guarantees (tested, including 3,000 random call sequences):

1. Every call that is not over has a deadline, so no call can get stuck open.
2. A call that was answered never goes to voicemail and is never "missed".
3. A timer only acts if it still matches the call's current deadline.
4. Deadlines are fired by a sweep (`tick()`), not by timers held in memory, so a restart loses nothing.

## Run the checks

```
npm install
npm run check    # typecheck + tests
npm run build    # static site in out/
```

Pushing to `main` runs the same checks on GitHub and publishes the site.

## Decisions

See [decisions.md](decisions.md).
