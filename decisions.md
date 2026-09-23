# Decisions

Newest first. Each entry: what was decided, why, and what it costs.

## 2026-09-22: Build the new phone system as its own project first

- **Decision:** a brand-new phone system in its own GitHub project (`rmsupportva/rm-phone`), published on GitHub Pages. It moves into CareHub when finished; the old RM Support telephony keeps running until then and is closed after.
- **Why:** the owner does not want to risk either live system (CareHub or the current phone system) while building. Vercel access to CareHub was not available yet.
- **Tradeoff:** GitHub Pages only serves static files, so everything runs in the browser for now. The repository and site are public (owner accepted), so they must only ever contain fake data and no secrets.

## 2026-09-22: Nothing is copied from the old phone system

- **Decision:** the old system (`rm-telephony` + the RM Support softphone) was studied for lessons only. No code is copied.
- **Why:** owner's instruction; the old system has four parallel inbound designs, very large files and several writers that can end a call.
- **Lessons carried over as rules:** answered calls never overflow to voicemail; a hang-up during the greeting is a missed call; every open call must have a deadline; deadlines must survive a restart.

## 2026-09-22: A pure "call brain" plus a vendor-neutral phone company interface

- **Decision:** `lib/phone/callMachine.ts` is one pure function `step(call, input) → (call, effects)`. Carriers implement `PhoneProvider` (`perform` effects, `subscribe` to events). A pretend carrier (`MockProvider`) is the only one today.
- **Why:** one place changes a call, so races like "answered at 29.9 s vs ring timeout at 30 s" are decided in order. SignalWire becomes one adapter later instead of being spread through the code.
- **Tradeoff:** the SignalWire adapter must translate its webhooks into these inputs. The mock was designed from how the old system saw SignalWire behave (greeting before `<Record>`, recordings arriving after hang-up).

## 2026-09-22: Deadlines are swept, not timed

- **Decision:** every open call stores `deadline {kind, at}`. `engine.tick()` fires any deadline that has passed. No `setTimeout` per call.
- **Why:** the old system kept ring timers in server memory; a deploy mid-ring meant no voicemail. A sweep works the same from a database (e.g. a job every second) and survives restarts.

## 2026-09-22: Version 1 scope

- **Decision:** incoming calls (hours → menu → ring all → voicemail), outgoing calls, history, recordings and transcripts (fake). Not yet: transfer, park, Call VA, SMS, IVR editor, live monitor, returning-caller routing.
- **Why:** recommended default while the owner had not chosen; the core has to be right before the in-call tools.

## 2026-09-22: Ring everyone available at once

- **Decision:** `ring_all` for 30 s, then voicemail. Spanish callers also ring everyone (no Spanish-first phase yet).
- **Why:** matches the live business decision of 2026-09-22 ("ring all available VAs at once"). Spanish-first routing is a business question for the owner.

## 2026-09-22: Look and feel follows CareHub

- **Decision:** CareHub's colour tokens, radii and system font; white/light theme.
- **Why:** the screens move into CareHub later; the owner prefers a light theme.

## 2026-09-22: Local tooling

- **Decision:** a portable Node 22 LTS in `C:\Users\admin\tools` (checksum-verified), and `NODE_OPTIONS=--use-system-ca` for npm.
- **Why:** Node was not installed. Something on this machine inspects TLS, so npm needs the Windows certificate store. Certificate checks stay on.
