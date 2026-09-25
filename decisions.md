# Decisions

Newest first. Each entry: what was decided, why, and what it costs.

## 2026-09-25: The real phone takes this site's design

- **Decision (owner, directly):** the survey site's /voice gets this practice site's look (Google Voice style). It replaces the earlier "keep the /voice design" rule. Every feature and option stays; only layout and look change.
- **How (branch `phone-look` on the survey site, not live yet):**
  - One menu (PhoneMenu) across Phone, Team and Phone settings: Make a call, Calls, Texts, Voicemail, Callbacks, Contacts, Team, Phone settings.
  - Calls, Texts and Contacts show the list and the open item side by side.
  - The call is a floating card (full screen on a phone).
  - Styles are in app/voice/voice.css, scoped to the phone pages, tokens only.
- **Small decisions taken:**
  - The greeting stays as the page heading.
  - The "at a glance" tiles become counts on the menu items.
  - On phones the bottom bar keeps only the five phone tabs; Team stays in the site's top bar and Phone settings stays inside Team.
- **Checking:** the owner chose to check it on the live site after deploy rather than on a local test server.

## 2026-09-25: The 15 improvements — what's built, what's split, what waits

- **Owner asked to add the 15 improvements.** An audit of the survey site's /voice found real calls, voicemail, callbacks and wrap-up live, while texts, contacts, the Team dashboard and settings were still preview data. So most items mean making the preview real.
- **Built by this session (branch `phone-15` on the survey site, not live):**
  - #11: missed incoming calls and voicemails go on the callback list, one open callback per number (repeats are noted on it). On by default.
  - #5: returning callers ring the last person who talked to them first. Old-phone rule: on, 30 days, fail-open, Spanish callers keep Spanish speakers first.
  - #14: settings saved in the database, checked before use, never breaking a call (defaults + error report if unreadable), editable wording for every message. Menu dial steps may only call US numbers (toll-fraud guard).
  - #13: live numbers for the Team page.
  - #10, #9, #1, #4: real contacts with several numbers, a CareHub card (read-only, logged as PHI access), CSV import with a preview, and merging duplicates.
- **Split:** the /voice screens that use these (dialer suggestions, settings screens, Team Live tab, voicemail player, notifications and shortcuts, the CareHub card on the call screen) are the other session's (f0). #2 Call VA ships with f0's VA sign-in, which needs the owner's direct OK.
- **Waiting for the owner:** real texting (#6 sending, #7 pictures, #8 assign/close). It is a bigger decision: provider, 10DLC registration, cost, and messages reaching families.
- **Small decisions taken:**
  - A missed call from a hidden or non-US number isn't added to the callback list, because it can't be called back.
  - Contacts are matched by name for duplicates. A number belongs to one contact only, and saving a number another contact has is refused, never moved.
  - Import and merge are for phone admins; any staff member can add or edit a contact.

## 2026-09-24: The phone menu is data, with every old step type

- **Decision:** the phone menu is a flow of steps (`lib/phone/ivr.ts`, run by `menuRunner.ts`): menu, play, set_language, hours, agent_check, queue, voicemail, callback, send_sms, dial, hangup. Today's menu (language, then "1 to talk, 2 for a message") is the default flow, so callers hear no change until someone edits it.
- **Old-phone rules kept (small decisions taken while the owner is away):** a wrong key or no key takes the menu's default option, or repeats the menu when it has none. At most 25 steps per call, then "something went wrong" and hang up. A menu with its own hours step decides after-hours itself; otherwise the number's after-hours action applies (voicemail by default). Spoken choices need confidence ≥ 0.5 and whole-word matches; a pressed key always wins. A dial step rings 5–120 s (30 by default). A menu can't be saved with missing steps, repeated keys or a loop that never waits for the caller.
- **Numbers can be set to** menu, straight to the queue, straight to voicemail, or no calls.
- **Bug found and fixed by the new tests:** a menu step dialling an outside number never learned whether that number answered or failed (the transfer code swallowed those events). They now reach the menu step.
- **Cost:** the survey site's carrier adapter (f0) must render the new caller-script parts: recorded audio, multi-key and spoken gathers, texts from the menu, and outside-number events for dial steps.

## 2026-09-24: Outgoing calls always show the main caller ID

- **Decision (owner):** every outgoing call shows the chosen main caller ID ((855) 499-3663 today), whether it is placed from the browser, the agent's own cell or the server. `chooseCallerId()` in `lib/phone/outbound.ts` applies to all modes.
- **Why:** the old phone showed it only on browser calls and the plain line number otherwise; the owner wants one consistent number.
## 2026-09-24: A separate number for testing incoming calls

- **Decision:** buy +1 (929) 412-1489 (SignalWire, same account as the old phone; voice only) for testing incoming calls on the new system. Owner approved the purchase.
- **Why:** all 6 existing numbers had real incoming calls in the last 30 days (21 to 53 each, from SignalWire's call log), so moving any of them would send real callers to an untested system. No 718 or 347 numbers were available; the owner chose 929 (NYC, covers the Bronx) over waiting.
- **Next:** f0 points the number at the survey site's inbound webhook after the caller-script code is merged, with the owner's OK. Release the number after the switch.
## 2026-09-24: In-call features and running calls from a database

- **Hold, park, transfer and "add a VA" live in the call brain** (`lib/phone/inCall.ts`), not only in screens. Requested by the session building the survey site's phone, which will carry the effects out through SignalWire.
- **Transfer rules (from the old system):** the agent stays on until the target actually answers. "Talk to them first" (warm) lets the two talk before Complete; "Send right away" (blind) hands over on answer. A transfer nobody picks up comes back to the agent. If the agent already left, the whole team is rung.
- **A caller who has talked to us never goes to voicemail.** A parked call that waits too long rings the team; if nobody answers it stays parked, until the safety cap ends it.
- **Server runner** (`lib/phone/server/callRunner.ts`): each carrier webhook loads the call, steps it and saves only if nobody changed it in between (a version number), retrying otherwise. Effects go out only after a successful save. A sweep fires passed deadlines. `supabaseStore.ts` maps this onto the bronx-survey `phone_calls` / `phone_call_events` / `phone_presence` tables.
- **Testing:** the random safety test now picks sensible actions for each call state, and it fails if it ever stops reaching parking, transfers, three-way calls or outside transfers.
## 2026-09-24: Google Voice-style layout with texts and contacts

- **Decision:** the app is organised like Google Voice: a menu (Calls, Messages, Voicemail, Contacts, then Team & demo, Settings), a list, and the open item beside it. On a phone the menu moves to the bottom and the list and the open item take turns.
- **Why:** owner request ("like Google Voice… all your contacts housed there… click a text and it opens… send a text").
- **Texting rules built in:** STOP / STOPALL / UNSUBSCRIBE / CANCEL / END / QUIT unsubscribe a number and get exactly one confirmation; START / UNSTOP resubscribe. Texting an unsubscribed number is refused with a reason (calling is still allowed). Message length follows SMS rules (160 characters, or 70 once an emoji or accent is used).
- **Shared team inbox:** texts and calls belong to the main line, not to one person. Outgoing texts record who sent them. "Using the app as" (demo only) picks the person, which the real build replaces with the signed-in user.
- **Demo data:** 8 fake contacts, 4 conversations and 6 past calls, dated relative to the moment the demo opens.

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
