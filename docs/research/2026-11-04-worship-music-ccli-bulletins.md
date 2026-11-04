# Worship module research: music, licensing integrations, bulletins

Research date: 2026-11-04. Scope: the music side (song libraries, charts, audio), the CCLI and OneLicense integrations, and bulletins. Written for the worship Phase 1 (`docs/work-log/2026-11-04-worship.md`), its increments 2, 3, 5 and 6, and open questions Q2 to Q7, Q15, Q16 and Q22.

**This is not legal advice.** Every licensing point below is "the licensor's text says", and the places where counsel is needed are marked **[counsel]**.

**Evidence markers** (used throughout and in the Sources list):

- **[V] Verified.** I read it on the vendor's or licensor's own site or document.
- **[R] Reported.** It comes from a third party, or from a vendor page I could only see as a search-index excerpt (the page itself returned 403 or 404 to me).
- **[U] Unverified.** Inference or background knowledge with no source I could read.

Raw captures were kept locally during the research and are not committed: the CCLI master terms PDF and its text, the SongSelect Partner API Postman JSON, and the Glory to God permission PDFs.

---

## 0. The findings that change the Phase 1 plan

1. **CCLI has closed the SongSelect API partner program.** CCLI's own published API documentation opens: "**NOTICE**: CCLI has retired the SongSelect API Partner Program and is no longer accepting new API partners." [V, undated]. Increment 6, as "apply to CCLI and get SongSelect import plus auto-reporting", has no published path today. The API does exist and is documented: OAuth 2.0 Authorization Code with PKCE, a per-partner subscription key, and a Reporting API with `report-usage`. Existing partners keep it.
2. **CCLI's own Terms of Use for SongSelect bar the obvious workaround.** The church "will not … transmit, distribute … or allow any third party to use the Service." Codes and passwords may go to nobody "other than your church staff or volunteers" (SongSelect TOU 6.3 and 6.6) [V]. So PresbyPortal must never hold a church's SongSelect credentials or scrape SongSelect.
3. **The CCLI master terms give hosting a textual hook.**
   - The Church Copyright License permits "Copy Musical Compositions into and from computerized storage and retrieval software" (§3.1.4) [V].
   - CCLI's support site tells churches to download a song "as a PDF or via ChordPro to then be uploaded into your planning software" [V].
   - The Rehearsal License allows streaming through an "Approved Website", defined to include "a hosted website" (§2.1.2, §6.1.1) [V].

   Together these move Q4 from "unknown" toward "plausible, counsel to confirm" [counsel].
4. **The Rehearsal License is more permissive about downloads than Phase 1 assumed, and stricter about church recordings.**
   - It permits streaming, and also "digitally distributing Master Recordings to the Worship Team for download, storage, and playback on a personal computer", as "temporary reference Copies" (§6.1.1, §6.2.3) [V].
   - It bars recording "a version of Musical Composition to be distributed or otherwise shared with any person … including with the Worship Team" (§6.2.2) [V].

   That answers most of Q6 from the text. CCLI does not cover a church band's own recordings.
5. **For a Presbyterian congregation, OneLicense matters about as much as CCLI, probably more.** The PC(USA) *Glory to God* electronic-edition permissions table assigns each copyrighted hymn to OneLicense, CCLI or both [V]. My rough parse of that PDF:
   - about 416 rows need some permission;
   - about 209 name OneLicense only, about 46 CCLI only, and about 158 both.

   These counts are approximate; the PDF layout is multi-line. A CCLI-only design leaves roughly half of a PC(USA) church's hymnal unreportable.
6. **OneLicense has no public API either.** Its only confirmed automated reporting integration is publisher software: *Christian Worship: Service Builder* (Northwestern Publishing House / Concordia). It reports reprinted titles automatically. Online usage still has to be reported by hand [V, via OneLicense's own news post].
7. **Planning Center does not build a bulletin from Services.**
   - It prints the plan as a "plan report" and publishes a "Public Plan" link.
   - Its bulletin guidance is to build a custom page in its separate Publishing product, Plus or Premium tier [R; help page 404 to me, seen through the search index].

   The tools that go plan to bulletin in one step are the denominational planners: Lutheran Service Builder, CW: Service Builder and Sundays and Seasons [V]. That is the gap PresbyPortal's Increment 3 would fill for mainline churches.

---

## 1. Comparison tables

### 1a. Song library, charts, transposition, offline

| Product | Library model | Chart formats | Transposition | Offline on stage | Catalog scope | Sources |
|---|---|---|---|---|---|---|
| **Planning Center Services** (+ Music Stand) | Song, then Arrangement, then Key; files on song, arrangement, key or plan item | In-app "Lyrics & Chords" editor (ChordPro-style brackets); PDF attachments; editable ChordPro import from SongSelect (new 2025-08-26) | Editor charts render in every arrangement key; PDF only in the key you imported | Music Stand keeps the **last 10 viewed plans** offline; annotations sync later [R]. A third-party "PCO Songbook" app claims full offline [V listing] | Per church. Integrations pull from SongSelect, PraiseCharts and MultiTracks | [V] SongSelect help; [V] changelog; [R] transpose/editor, Music Stand |
| **WorshipTools** (Charts, Planning, Presenter; free; CCLI family company) | Org library shared across apps | ChordPro editing, PDFs, SongSelect, PraiseCharts | "Instant transposition" | Release notes mention an offline mode [R] | Per org; one SongSelect link shared by every app and user in the org [V] | [V] SongSelect doc; [R] Charts listing, pocket guide |
| **OnSong** (iOS) | Device library, sync | ChordPro native; SongSelect delivered as PDF in-app | ChordPro transposes locally. SongSelect PDFs transpose by **re-fetching a new PDF from SongSelect per key** (online the first time, then cached) [R, 2015 manual] | Yes, device-local | Per user | [R] OnSong manual, KB |
| **SongSelect** (CCLI) | CCLI catalog; the church downloads | Lyrics, chord, lead, vocal and hymn sheets (PDF); ChordPro (Premium) | Server-side: the chord-sheet PDF endpoint takes `?key=D` [V API doc] | n/a (downloads) | Shared catalog, licensed per church | [V] Postman API doc; [V] CCLI support |
| **PraiseCharts** | Purchased arrangements | PDF charts, orchestrations | Charts sold per key | n/a | Per purchase; "non-transferable and cannot be shared with other churches" [R] | [V] help article 55 |
| **MultiTracks.com** (Playback, ChartBuilder, RehearsalMix) | Account plus seats | Chart Pro (charts); RehearsalMix audio | ChartBuilder app | Playback is a local app | **RehearsalMix is per-seat, per user**. Chart Pro and RehearsalPack, once imported to PCO, are visible to the whole PCO account [R] | [V] stereo-mix article; [R] PCO integration help |
| **Loop Community** (Prime, Rehearse; CCLI family) | Tracks app; setlists shared to team (up to 100 members, Pro) | n/a (tracks) | n/a | Local app | Rehearse integrates with WorshipTools Planning, **not yet Planning Center** [R] | [R] Loop support FAQ |
| **forScore / MobileSheets** | Personal PDF library on a tablet | PDF plus annotations | None (PDF) | Fully local | Personal; shares a setlist as a file without its scores [R] | [R] forScore docs |
| **ProPresenter / EasyWorship / Proclaim / MediaShout / SongShow Plus** | Presentation library (lyrics slides) | Lyrics | n/a | Local | Per install | CCLI auto-reporting partner list [V] |

**How musicians actually use this.** They want a chart in the right key on a tablet with no network. The market answers with local caches: Music Stand's 10-plan cache, OnSong, forScore, PCO Songbook. Every one of those copies lives outside any destroy-on-lapse reach. Phase 1's G19 calls that a residual; the market treats offline as table stakes.

### 1b. CCLI and OneLicense integrations

| Product | SongSelect import | CCLI auto-report | OneLicense auto-report | How they describe the connection | Source |
|---|---|---|---|---|---|
| Planning Center Services | Yes: lyrics, PDF chord chart, editable ChordPro. Lead sheets **not** imported | Yes, weekly every Monday, previous week's plans; CCL and Streaming only; songs without a CCLI number excluded; once per song per week | No mention | Administrator: Songs, then Actions, then Song File Integrations; "agree to license terms", sign in with CCLI credentials, then "Allow". Integration **disabled after 60 days of no SongSelect activity**. Each chart import counts against the **copy limit**. Recorded CCLI data kept **2 years** | [V] PCO SongSelect help; [V] PCO CCLI help |
| WorshipTools (Charts, Planning, Presenter) | Yes | Yes (CCLI recommends it to churches with no software) | — | Organization administrator only; "sign in with an active CCLI Profile login"; shared by every app and user | [V] WT doc; [V] CCLI auto-reporting page |
| ProPresenter 7.12+ | Yes | Yes. Reported when a slide with a CCLI number is triggered, once a day per song | — | Sign in under Settings, Integrations. Legacy ≤7.11 lost the API on 2023-06-26 | [R] Renewed Vision help |
| Faithlife Proclaim | Yes | Yes, after a ≥15-minute "On Air" session; paid SongSelect tier required | No; a user forum thread asks about OneLicense | Re-link the account for the new API | [R] Proclaim help |
| EasyWorship, MediaShout, SongShow Plus, ChurchTools, SongBeamer | (varies) | Listed as auto-reporting partners | — | — | [V] CCLI auto-reporting logos |
| Elvanto (Tithe.ly) | Yes ("SongSelect by CCLI Integration") | [U] | — | — | [R] help title (page 403) |
| Tithe.ly | "SongSelect Extension" | [U] | — | — | [R] help title (page 403) |
| **Christian Worship: Service Builder** (NPH/CPH) | — | — | **Yes: reprints and slides exported in the prior 7 days, Mondays.** Streaming and podcast still manual | The church enters its OneLicense number in Account Settings | [V] NPH product page; [V] OneLicense news; [R] CW help |
| Sundays and Seasons (Augsburg/ELCA) | — | — | No. Hymns are reported by hand in the OneLicense account | — | [V] OneLicense news |
| GIA Planner | — | — | No; manual | — | [V] OneLicense news |
| Prelude Music Planner | — | — | No (2017) | — | [R] |
| FreeShow (open source) | Community scraper script, not an API | — | — | Raises SongSelect TOU concerns | [R] GitHub issues |

### 1c. Bulletins / orders of worship

| Product | Plan to bulletin? | Output | Notices | Large print | Source |
|---|---|---|---|---|---|
| Planning Center | **No native bulletin.** Plan reports print the service order (customizable templates); Public Plans give a no-login web link to the order of service (can auto-publish per service type); a bulletin is a **Publishing custom page** (Plus or Premium) | Print, web | Not described | Not described | [R] PCO help via search index; [V] Public Plans blog |
| Breeze | Service Planning prints the plan from the "more" menu | Print | — | — | [R] Breeze help |
| ChurchSuite | No official bulletin; a third-party open-source "Plan Viewer" prints plans with templates, base font size and page size | Print | — | Base font size is user-set | [R] |
| WorshipTools Planning | Print template reported as not customizable | Print | — | — | [R] WT forum |
| **Lutheran Service Builder** (CPH) | **"Go from plan to bulletin in one click."** Shows headings or full content, music notation or text only; reusable custom orders | Export to a word processor (export requires purchase) | Not stated on the page | Not stated | [V] |
| **CW: Service Builder** (NPH) | "Edit and export bulletin layouts" plus slides | Export | "Prompts" for copyright compliance; auto OneLicense reporting | Not stated | [V] |
| **Sundays and Seasons** (ELCA) | Planner by date and base liturgy; download content and **format in Word or PowerPoint** | Download | Augsburg liturgies licensed with the subscription; hymns need OneLicense or CCLI | Not stated | [V] |
| PC(USA) *Book of Common Worship* | Downloadable edition: PDF and **Word files "arranged … for the ease of bulletin creation"** | Files | Credit line "Reprinted by permission from the Book of Common Worship, © 2018 Westminster John Knox Press" [R] | — | [R] WJK/PCUSA store |
| PC(USA) *Glory to God* web edition | Downloadable PDF per hymn "for inserting into a bulletin … (when rights allow)"; one-time purchase | PDF | Copyright notice printed beneath each hymn | Large-print loose-leaf pew edition sold separately [R] | [R] PCUSA store |
| Faithlife (Proclaim / Sites) | "Digital Bulletin" with on-screen affirmations | Web/app | — | — | [R] |
| Church apps (Pushpay, Tithe.ly, Subsplash, "In The Bulletin") | Digital bulletin in the app, push notifications, links, forms, giving | App/web | — | — | [R] vendor blogs |

**What Presbyterian and mainline churches typically use** [R/U]. No PC(USA)-specific planner turned up. The pattern the evidence supports:

- the Book of Common Worship's Word and PDF files plus the *Glory to God* web edition for content;
- Word or Publisher for layout;
- OneLicense and/or CCLI for reprint rights, reported by hand;
- in larger or contemporary-leaning congregations, Planning Center for teams.

One Christian Reformed forum thread cites a Presbyterian church recommending Planning Center [R].

---

## 2. Per-product notes

**Planning Center Services** [V unless marked]
- **SongSelect.** An administrator turns it on and agrees to the license terms; the integration is "Sign in … select Allow". Imports lyrics as plain text, an editable ChordPro chart (transposed into the arrangement's keys) or a fixed PDF chart in a chosen key. "Lead sheets: Not imported." "Every time you add a chord chart from SongSelect to your Services, that is one copy toward your copy limit." "If SongSelect hasn't been used for 60 days, the integration is disabled." Editors can view the settings; only administrators can toggle them.
- **CCLI reporting.**
  - Auto: "your song usage for the previous week is automatically reported to CCLI each Monday". It covers the Streaming and Copyright licenses, not Rehearsal or Streaming Plus. Songs without a CCLI number are excluded. Each song is counted once per week across campuses.
  - Manual: usage counts by type (Print, Digital, Recording, Translation) in each plan, and a "CCLI Copy Activity report".
  - Recorded data is kept two years.
- **Storage** [R].
  - Files can be **linked rather than uploaded** "to save on your file storage". This is the precedent for PresbyPortal's Increment 2 "links".
  - SongSelect PDFs count toward storage. MultiTracks imports do not, and PraiseCharts imports generally do not.
  - Audio plays in the browser from the Files page.
  - Editor-made charts do not count toward storage.
- **Public API** at api.planningcenteronline.com, JSON:API, OAuth for third-party apps [R]. Relevant only to Q19, the Planning Center import.

**SongSelect Partner API (CCLI)** [V; CCLI-published on Postman, undated]
- Status: "retired … no longer accepting new API partners."
- Authentication: OIDC/OAuth 2.0, Authorization Code + PKCE, scope `openid cclipartnerapi.read offline_access`; access tokens last 1 hour; refresh tokens are 60-day sliding and single-use. An `Ocp-Apim-Subscription-Key` header is required.
- Rate limits: 100 calls per 10 seconds, and 300 per 5 minutes, per user.
- Endpoints: song search, details, lyrics, lyrics preview, chord-sheet PDF (`key`, `style`, `columns`), ChordPro (`key`), rights, lists, popular and top-100.
- Fetching lyrics, PDF or ChordPro "is recorded and monetized for the current payout period."
- **Reporting API** has `POST /v1/report-usage` for songs (CCLI numbers by date) and for recordings (ISRC, album, `useType` `stream` or `rehearse`). It rejects dates older than 45 days and records "one song usage per day per organization."
- The v1 API was shut on 2023-06-26 [R: Renewed Vision, OnSong].

**CCLI corporate family** [V/R]. The master terms PDF has a "CCLI Affiliate Services" section. It lists CVLI, Loop Community, WorshipTools, SundaySounds and Christian Copyright Solutions [V]. A 2026 announcement names the "CCLI Group of Companies" [R]. CCLI's auto-reporting page recommends WorshipTools to churches with no software [V]. Expect CCLI to point new entrants at WorshipTools.

**WorshipTools** [V]: Charts, Planning, Presenter and Rehearse are free. Only an Organization Administrator can connect SongSelect, and the link is shared by every app and user. A quota exists ("SongSelect quota").

**OnSong** [R]: SongSelect charts arrive as PDFs. Transposing one re-fetches a new PDF per key from SongSelect, then caches it. SongSelect Premium ChordPro imports become fully editable.

**PraiseCharts** [V/R]: "Your initial download usually includes permission to make 3 copies of Piano/Vocal charts. … Any additional copies … would require a multi-copy purchase." Chord charts fall under the church's CCLI license [V]. Music "cannot be shared with other churches" [R].

**MultiTracks.com** [V]: "It is against the MultiTracks.com terms of use … to create and share your own mixes", including uploading stems or stereo files "to rehearsal or file-sharing services such as Planning Center Services." "Multitracks … are only licensed for live performance use." Rehearsal sharing goes through Playback Team Sharing or RehearsalMix (per-seat) only.

**OneLicense**: onelicense.net returned 403 to every fetch.
- From its official news blog [V]:
  - weekly reports, with Duplicate and Lists features and "Report List of SKUs";
  - a 20-week reporting window;
  - "report 100% of the music";
  - a practice-track license that will "cover sharing of masters **or personally recorded tracks** for the purpose of rehearsing";
  - a Podcast/Streaming license.
- From its FAQ as seen through the search index [R]:
  - "If your license is no longer active, you will be required to destroy all reprinted material";
  - "You must include your ONE LICENSE license number with any reprint or projection";
  - an annual license "allows you to maintain a library of worship aids and downloaded music files as long as the license is valid";
  - notice wording "Reprinted with permission under ONE LICENSE #A-000000".

**PC(USA) / Presbyterian Publishing** [V]
- Pew-edition singing never needs permission. Public-domain hymns are free to reproduce or project.
- PPC's fair-use policy lets a congregation reprint hymns PPC controls (about 30 hymns, per the PCUSA store [R]) in bulletins. The condition is that the notice "shown beneath the hymn is included" and *Glory to God* is acknowledged.
- Everything else needs OneLicense, CCLI or the copyright holder.
- "Projecting from the web edition or print editions … is never allowed"; projection needs the separate projection edition.
- The Copyright Holder Index (59 pages) lists text and music holders separately per hymn, each with "works with OneLicense? / CCLI?".

---

## 3. Table stakes vs differentiators

**Table stakes** (every serious worship tool has them):
- a song library with title, writers, copyright, CCLI number, keys and tags;
- a dated service order with song items;
- per-plan song usage feeding a report-ready CCLI list;
- attachments, or links to charts and audio;
- a chart in the right key on a phone or tablet;
- a printable order of service;
- the license notice on anything reproduced.

**Market expectations PresbyPortal will not meet early** (state them so nobody is surprised):
- SongSelect import and CCLI auto-reporting (partner-gated, and closed);
- offline charts on stage;
- multitrack and rehearsal-audio integrations (MultiTracks, Loop);
- annotation.

**Differentiators open to PresbyPortal:**
1. **Two agencies, not one.** No general-purpose tool found reports or annotates for OneLicense; only Service Builder does, and only for its own content. Per-song agency tracking (CCLI, OneLicense, both, PPC fair use, public domain, direct permission) with **separate text and music rights** matches how the *Glory to God* index is organized. It also produces a weekly OneLicense list and a CCLI list.
2. **Plan to bulletin with correct notices generated per agency.** Planning Center does not do this; only the denominational planners do. The PC(USA) has no such planner.
3. **Bundled with the roll, groups and directory, and not billed per seat.** Phase 1 already identifies this.
4. **Large-print as a first-class output** (no vendor surveyed advertises it).

---

## 4. Recommendations

### Increment 2: service order, song library, report lists

- **Song fields.**
  - Title, alternate first line, writer credit (text) and writer credit (music).
  - **Separate © lines for text and music.**
  - CCLI song number.
  - **Licensing route per song**: an enum of `ccli`, `onelicense`, `both`, `publisher_fair_use`, `public_domain`, `direct_permission` and `unknown`, with a note. Optional OneLicense SKU or number.
  - Default key and tags.
  - Hymnal references (see Q22).

  Evidence: the GtG index's per-hymn text and music split and its CCLI/OneLicense columns [V]; OneLicense's SKU-based reporting [V]; CCLI §10.5's notice requires writer credits and the © line [V].
- **Per-congregation license registry.** CCLI license number, OneLicense number (format `A-xxxxxx` [R]), which add-ons (Streaming, Rehearsal, Practice-Track) are held, and the expiry date. The expiry date drives the destroy-on-lapse logic in Increment 5. This is a recorded attestation, not an integration (as Phase 1 already proposes).
- **Notice generator, by agency.**
  - CCLI exact template (§10.5) [V]: `"[Song Title]" words and music by [Writers] / © [Year] [Publisher] / Used by Permission. CCLI License #[n]`.
  - OneLicense: `Reprinted with permission under ONE LICENSE #A-…. All rights reserved.` [R; confirm with OneLicense].
  - PPC fair use: the hymn's own © line plus a *Glory to God* acknowledgment [V].
  - BCW liturgy: "Reprinted by permission from the Book of Common Worship, © 2018 Westminster John Knox Press" [R].
  - Store each template as data, not code, so a licensor's wording change is not a deploy.
- **Two report lists.**
  - **CCLI "Songs used"**: date, CCLI number, title, and usage type (Print, Digital, Record, Translate, as Planning Center models it [V]). Deduplicate to one usage per song per day per organization, as CCLI's own API does [V].
  - **OneLicense weekly list**: week, title, SKU or number. It must work for at least the 20-week window OneLicense reports in [V].
  - Keep at least 2 years; Planning Center keeps 2 [V].
  - Mark songs missing a number as "can't be reported", as both Phase 1 and Planning Center do.
- **External links, not uploads.** Planning Center itself offers linking "to save on your file storage" [R]. Phase 1's plan is aligned with the market.
- **Key placement (G17).** Follow Planning Center: song, then arrangement (optional), then key, with the plan item choosing the key [V]. A ChordPro text renders in any key; a PDF is fixed to one key. SongSelect itself transposes PDFs only by re-rendering server-side [V].

### Increment 3: bulletins

- **Print-optimized HTML plus save-as-PDF** is enough for v1 (Q15). The market's mainline tools also let staff **finish in Word**: Sundays and Seasons, LSB, and the BCW downloadable edition's Word files [V/R]. Plan a **"Download as .docx"** follow-up as a Phase 2 dependency decision. It is probably what a church secretary asks for first [U].
- **Large print** at a **minimum of 18 pt body text** (American Foundation for the Blind standard, as cited [R]). Offer a 22 pt option; one United Methodist accessibility guide asks for "at least size 22 font" and "include the words and music for hymns" [R].
  - Including hymn words in large print is a reprint and needs the license. Gate it on the song's licensing route.
  - Hymns whose route is `unknown` or `direct_permission` print titles and numbers only.
- **Notices.** Print the agency notice at the foot of each reproduced song. One Catholic OneLicense guide puts it at the bottom of the first page of each reprinted song [R]. Block printing lyrics for a song with no complete notice, as Phase 1 Flow 9 already says.
- **Public website copy: titles, hymnal and number, writers and © only.** Neither the CCLI §3.1 grant nor anything I read covers lyrics on an open web page. The CCL's reproduction grant is for "bulletins, liturgies … and similar **tangible** forms" (§3.1.1) [V]. "Approved Website" appears only in the streaming and rehearsal grants. **[counsel]** before any lyrics appear even behind a login. A members-only "digital bulletin" with lyrics is an open legal question, not a feature.
- **Public plan precedent.** Planning Center's Public Plans publish a no-login order-of-service link and can auto-publish per service type [V]. PresbyPortal's liveSlot website copy is the same shape.
- **Liturgy text.** The church pastes BCW text from its own purchased edition. The platform supplies none of it and offers the BCW credit line as a preset.

### Increment 5: hosted charts, sheet music and audio

- **Legal posture (Q4) is better supported than Phase 1 assumed, but still [counsel].**
  - CCL §3.1.4: "Copy Musical Compositions into and from computerized storage and retrieval software" [V].
  - CCLI support recommends uploading SongSelect downloads "into your planning software" [V].
  - Planning Center, WorshipTools and others host church-uploaded charts commercially [V].
  - Against hosting:
    - CCL §12, no sublicense or assignment [V];
    - SongSelect TOU 6.3, no transmission to third parties [V];
    - SongSelect's 200-song print cap per year (TOU 6.4; CCLI support says 200 unique songs for Advanced and Premium) [V];
    - PraiseCharts' 3-copy rule [V];
    - MultiTracks' ban on uploading mixes or stems to sharing services [V].

    The upload attestation should therefore name the **source**: SongSelect, PraiseCharts, a publisher purchase, the church's own arrangement, or public domain. Uploads of commercial multitracks or stems should be refused outright, citing MultiTracks' terms.
- **Audio (Q6).** The CCLI Rehearsal License allows streaming **and** download to a personal device as "temporary reference Copies" through an Approved Website, which can be "a hosted website" [V].
  - Stream-only by default is a stricter platform choice, not a license requirement. Keep it as the default, and record that the license allows more.
  - **Church-made recordings are barred under CCLI** (§6.2.2) [V].
  - For OneLicense-covered songs, OneLicense's Practice-Track license covers "personally recorded tracks" [V, 2016 wording; reconfirm].
  - So the attestation for a church recording must name the OneLicense practice-track license, or a direct permission.
- **Destroy on lapse (Q5).** CCLI §10.4: "immediately destroy all copies … if an applicable license … expires" [V]. CCLI support adds "deleting and destroying all copies made physically and electronically" [V]. OneLicense says the same of reprints [R].
  - The license registry's expiry date should drive a **warning before expiry and a purge of the bytes on lapse**, keeping a tombstone row (Phase 1 Q5).
  - Note that CCLI may also end a license for "a specific item of Content" at any time (§20) [V]. A per-song "withdrawn" purge is therefore also needed.
- **Transposition.** Store charts as **ChordPro text where possible** and transpose on render; PDFs stay single-key, as at every vendor.
  - Dependency warning for Phase 2: the best-known JS library, **ChordSheetJS, is GPL-2.0**, and `chorpro-parser` is **AGPL-3.0** [V, GitHub API]. PresbyPortal is MIT.
  - A small in-house transposer, or a verified MIT library, is needed. `simplechordpro` is listed MIT [R].
  - Also needed: Phase 1's "ChordPro with hostile markup" sanitization.
- **Offline.** Every surveyed stage tool caches charts offline (Music Stand, the last 10 plans [R]; OnSong; forScore; PCO Songbook [V]). Keep it out of v1 as Phase 1 says, but expect it as the first request. Any cache must be tied to the expiry and purge logic, or recorded as `paper`.
- **DMCA.** Registering an agent with the US Copyright Office costs $6 per designation and must be **renewed every 3 years**, or safe harbor is lost [R; confirm at copyright.gov] **[counsel]**.

### Increment 6: CCLI connection (conditional)

- **Treat the CCLI partner path as closed unless CCLI says otherwise.** CCLI's own API documentation states the program is retired to new partners [V]. Planning Center still gained ChordPro import on 2025-08-26 [V], so CCLI serves *existing* partners; the door is shut to new ones.
- **What to ask CCLI** (Q3), in this order:
  1. Is there any path for a new software partner, reporting-only (the Reporting API) or full?
  2. Can reporting.ccli.com accept a file upload? [U: not found]
  3. Is a church band's own recording ever covered?
  4. CCLI's position on a multitenant platform storing a church's SongSelect downloads under CCL §3.1.4.
- **Ask OneLicense the same.** One publisher tool already auto-reports to it [V], so an integration mechanism exists. Whether a third party can get one is unknown [U].
- **Never** take SongSelect credentials or scrape SongSelect (TOU 6.3 and 6.6 [V]; the FreeShow scraper is the cautionary example [R]).
- **Fallback that needs nobody's permission.** The Increment 2 report lists, formatted for fast manual entry: CCLI by date, OneLicense by week with SKUs.

### Open questions

| Q | Recommendation | Evidence |
|---|---|---|
| **Q2** Which licenses do pilots hold? | Ask before Increment 2, and add OneLicense, Practice-Track and the PPC hymnal edition to the list. Expect **OneLicense** at a PC(USA) church. Model both agencies from day one | GtG table: about half the copyrighted hymns are OneLicense-only [V, approximate count]; PPC recommends "CCLI, OneLicense.net, and LicenSing" [R] |
| **Q3** Approach CCLI? | Yes, but expect "not accepting partners". Also approach OneLicense. Build nothing dependent | Postman notice [V]; Service Builder to OneLicense [V] |
| **Q4** Host church-licensed files? | Plausible. CCL §3.1.4 and CCLI's own "upload into your planning software" advice support it. Conditions: a source-specific attestation, no cross-church sharing (CCL §12), refusal of multitracks and stems, and a DMCA agent. **[counsel]** on terms | §3.1.4, §12 [V]; CCLI support 808 [V]; MultiTracks [V] |
| **Q5** Destroy vs soft-delete | Purge the bytes and keep a tombstone. Trigger it on license expiry from the registry, and per song on content withdrawal | §10.4, §20 [V]; CCLI support 2084 [V] |
| **Q6** Audio | Team-only. Stream-only by default, though the CCLI Rehearsal License allows temporary downloads. Church-made recordings only under a OneLicense Practice-Track license or direct permission, **not** CCLI | §6.1.1, §6.2.2 [V]; OneLicense 2016 FAQ [V] |
| **Q7** Object store | Yes. Charts plus audio exceed bytea; vendors meter storage per church (Planning Center) | [R] |
| **Q15** Bulletin output | HTML print and PDF, plus large print at 18 pt or more (22 pt option). Plan a .docx export later, because mainline staff finish in Word | S&S, LSB, BCW [V/R]; AFB 18 pt [R] |
| **Q16** Names on the public copy | Two outputs, as Phase 1 recommends. The Planning Center Public Plans precedent does not document which people appear [V], so PresbyPortal sets the consent rule itself | [V] |
| **Q22** Hymnal references | Yes, make them **structured**: hymnal (a closed list per org, starting with *Glory to God*, *The Presbyterian Hymnal*, *Sing the Faith*) plus a number, and separate text and music rights. Do **not** seed from Hymnary.org or the PPC index without permission; neither publishes reuse terms I could find | GtG index [V]; Hymnary has CSV export but no published reuse terms [R] |

---

## 5. Sources

Each entry: URL, marker, and what it supports. "Read 2026-11-04" unless noted.

**CCLI**
- https://store.ccli.com/download/CCLI_terms_of_agreement_us — [V] the CCLI Master Terms of Agreement plus the SongSelect Terms of Use and affiliate terms, in one PDF. Linked as "HERE" from the license summary and from ccli.com/us/en/terms. The PDF carries no version date; its footer is a generation stamp of 2026-11-04. Quoted: §2.1 Approved Website; §3.1.1, §3.1.4, §3.2.2; §6 Rehearsal; §8 Music Reproduction Licence (not available in all territories); §10.4 and §10.5; §12; §20; SongSelect TOU §§3, 4, 6.1, 6.3, 6.4, 6.6, 6.7, 13; Affiliate Services.
- https://ccli.com/us/en/church-copyright-license-summary — [V] permitted and not-permitted activities, the destroy-on-expiry rule, the notice format, and "report … once every 2 1/2 years".
- https://ccli.com/us/en/auto-reporting — [V] auto-reporting covers CCL and Streaming only; Rehearsal and Streaming Plus come later; partner logos (Planning Center, ProPresenter, Proclaim, easyWORSHIP, MediaShout, SongShow Plus, ChurchTools, SongBeamer, WorshipTools Charts, Planning and Presenter); WorshipTools recommended.
- https://ccli.com/us/en/terms — [V] links to the master terms PDF.
- https://documenter.getpostman.com/view/604633/TzseGkmA (JSON via documenter.gw.postman.com) — [V] SongSelect Partner API: retirement notice, OAuth/PKCE, endpoints, Reporting API, 45-day and one-per-day rules. Undated.
- https://support-ccli-us.helpscoutdocs.com/article/808-why-cant-i-download-chord-sheets-into-my-software-program — [V] "uploaded into your planning software"; ChordPro is Premium.
- https://support-ccli-us.helpscoutdocs.com/article/323-is-there-a-limit-to-how-many-songs-i-can-download-from-songselect — [V] 200 unique songs per year, Advanced and Premium.
- https://support-ccli-us.helpscoutdocs.com/article/2084-can-we-still-use-copies-of-song-words-or-music-that-we-made-under-our-license-if-that-license-has-expired — [V] delete physical and electronic copies.
- https://support-ccli-us.helpscoutdocs.com/article/325-can-songselect-link-directly-to-my-church-presentation-software — [V] points to songselect.ccli.com/about/apipartners. That page is JavaScript-only; **the partner list could not be read** [U].
- https://support-ccli-us.helpscoutdocs.com/article/2089-how-do-we-report — [V] auto or manual reporting.
- https://songselect.ccli.com/about/termsofuse — **could not be read** (403 to the fetch tool; JavaScript shell to curl). The same TOU text is in the PDF above [V].

**Planning Center**
- https://help.planningcenter.com/en/139448-songselect--by-ccli-integration.html — [V] connect flow, import types, copy limit, 60-day disable.
- https://help.planningcenter.com/en/139389-ccli-reporting.html — [V] weekly Monday auto-report, exclusions, 2-year retention, manual types.
- https://www.planningcenter.com/changelog/services/40401998080667-new-import-editable-chordpro-files-from-songselect — [V] editable ChordPro import, 2025-08-26.
- https://www.planningcenter.com/blog/2024/06/share-service-details-with-new-public-plans — [V] Public Plans.
- https://help.planningcenter.com/en/139414-manage-files-and-storage.html; https://help.planningcenter.com/en/create,-upload,-or-link-to-files.html — [R] storage counting and linking (search-index excerpts; direct fetch 404).
- https://help.planningcenter.com/en/create-a-bulletin.html (also /139225-create-a-bulletin.html) — [R] bulletin as a Publishing custom page, Plus or Premium (direct fetch 404).
- https://help.planningcenter.com/en/use-the-lyrics---chords-editor.html — [R] editor transposition, no storage cost.
- https://www.planningcenter.com/blog/musicstand-version-3; https://help.planningcenter.com/en/140421-introduction-to-music-stand.html — [R] 10-plan offline cache, annotations.
- https://help.planningcenter.com/en/139447-multitracks-integrations.html — [R] RehearsalMix seats vs account-wide Chart Pro.
- https://api.planningcenteronline.com/docs/overview/getting-started; https://www.planningcenter.com/developers — [R] public API.
- https://apps.apple.com/app/id6759177151 — [V] "PCO Songbook" is a third-party app (developer Josiah Oslund) claiming full offline.

**Other music vendors**
- https://www.worshiptools.com/en-us/docs/73-ch-ss-integration — [V] SongSelect connection by an organization administrator, shared across the org.
- https://www.worshiptools.com/charts; https://www.worshiptools.com/pdf/pocketGuide.pdf; https://apps.apple.com/us/app/id1511797596 — [R] Charts features.
- https://help.praisecharts.com/article/55-can-i-share-my-pro-access-downloads-with-other-members-of-my-worship-team — [V] 3 copies; chord charts under CCLI.
- https://www.praisecharts.com/company/terms-of-use — [R] non-transferable, not shareable with other churches.
- https://helpcenter.multitracks.com/en/articles/7979940-can-i-create-and-share-stereo-mixes-for-rehearsal-purposes — [V] no uploading mixes or stems to Planning Center; live-performance-only license.
- https://helpcenter.multitracks.com/en/articles/4460304-integrating-rehearsalmix-with-planning-center — [R] per-user seats.
- https://support.loopcommunity.com/article/3653-does-rehearse-integrate-with-service-planning-tools — [R] Rehearse works with WorshipTools, not Planning Center.
- https://loopcommunity.com/become-a-pro/prime — [R] team sharing, up to 100 members.
- https://onsongapp.com/docs/1.999/interface/menubar/songs-menu/all-songs/add/songselectv1/transpose; https://desk.zoho.com/portal/onsong/kb/articles/why-can-t-i-edit-chord-charts-i-ve-imported-from-songselect — [R] PDF transposition by re-fetch; ChordPro editable.
- https://forscore.co/documentation/setlists — [R] setlist sharing without scores.
- https://support.renewedvision.com/hc/en-us/articles/360041815033-Importing-from-SongSelect; https://support.renewedvision.com/hc/en-us/articles/16717107843987-Update-about-CCLI-and-ProPresenter — [R] ProPresenter auto-reporting; legacy cut-off 2023-06-26.
- https://support.proclaim.logos.com/hc/en-us/articles/19864484520973-How-to-Enable-Auto-reporting-to-CCLI — [R] Proclaim auto-reporting (403 to direct fetch).
- https://help.elvanto.com/hc/en-us/articles/7607943730199-How-to-set-up-the-SongSelect-by-CCLI-Integration — [R] title only (403).
- https://support.tithe.ly/hc/en-us/articles/32701149980951-Managing-The-SongSelect-Extension — [R] title only (403).
- https://github.com/ChurchApps/FreeShow/issues/883 and /572 — [R] scraper approach; a reported ~$1,200/yr historical API fee (unverified).
- https://github.com/martijnversluis/ChordSheetJS (GPL-2.0); https://github.com/chordproject/chorpro-parser (AGPL-3.0) — [V] via the GitHub API. https://www.npmjs.com/package/simplechordpro — [R] MIT.

**OneLicense and other publishers**
- https://www.onelicense.net/faqs, https://onelicense.net/ — **403 to every fetch; not read.** FAQ statements are [R] from search-index excerpts.
- https://news.onelicense.net/2025/04/14/popular-digital-resources-from-our-member-publishers/ — [V] Sundays and Seasons, Service Builder (reprints auto-reported), GIA, OCP.
- https://news.onelicense.net/2026/03/27/three-things-you-maybe-didnt-know-you-could-do-reporting-edition/ — [V] weekly reports, Lists, "Report List of SKUs", 20-week window, no API mentioned.
- https://news.onelicense.net/2016/12/14/the-new-one-license-frequently-asked-questions/ — [V] license types; practice-track covers "personally recorded tracks"; report 100%.
- https://news.onelicense.net/2019/05/17/announcing-a-new-partnership-with-hymnary-org/ — [V] search and preview partnership, no API.
- https://online.nph.net/servicebuilder — [V] CW: Service Builder, bulletin export, auto OneLicense reporting, pricing.
- https://help.christianworship.com/hc/en-us/articles/4417355171227-Hymn-Usage-Reporting — [R] Monday job, prior 7 days, reprints and slides (403).
- https://lacatholics.org/onelicense/ — [R] OneLicense notice layout and placement.
- https://www.pcusastore.com/Pages/Hymnal/Hymnal-Rights-and-Permissions.aspx — [V] PPC fair use, OneLicense or CCLI for others.
- https://www.pcusastore.com/Content/Site119/Basics/7431ElectronicE_00000162997.pdf — [V] GtG electronic-edition permissions table (my approximate agency counts).
- https://www.pcusastore.com/Content/Site119/Basics/7430Copyrightho_00000163000.pdf — [V] GtG Copyright Holder Index (separate text and music holders and agencies).
- https://www.pcusastore.com/Content/Site119/Basics/7430VirtualWors_00000160122.pdf — [V] virtual worship guidelines.
- https://www.pcusastore.com/www.thepresbyterianlead er.com/Pages/About/FAQ.aspx — [R] web edition, one-time charge, per-hymn PDF for bulletins.
- https://www.thethoughtfulchristian.com/Products/0664269745/book-of-common-worship-downloadable-edition.aspx; https://www.pcusastore.com/Content/Site119/FilesSamples/199602BookofCom_00000124089.pdf — [R] BCW Word files for bulletins, credit line.
- https://admin.cokesbury.com/9780664503239-Glory-to-God-Large-Print-Loose-leaf-Edition — [R] large-print edition exists.
- https://hymnary.org/widgets — [R] CSV and JSON exports; no reuse terms found.

**Bulletins and accessibility**
- https://sundaysandseasons.com/ — [V] planner, Word/PowerPoint finishing, licensing scope, pricing.
- https://music.cph.org/lutheran-service-builder/features/bulletins — [V] plan to bulletin in one click, export to a word processor.
- https://support.breezechms.com/hc/en-us/articles/17481063475735-How-to-Use-Breeze-Service-Planning — [R].
- https://hussra.github.io/churchsuite-plan-viewer/usage.html — [R].
- https://worshiptools.com/help/thread/6312652540215296 — [R] print template not customizable.
- https://pushpay.com/blog/10-best-church-app-features/; https://get.tithe.ly/blog/best-church-app-features; https://subsplash.com/blog/best-church-app-features; https://faith.tools/app/in-the-bulletin — [R] digital bulletin features.
- https://www.anabaptistdisabilitiesnetwork.org/wp-content/uploads/2026/02/Best-Practices-for-Printed-Materials.pdf; https://www.umcnic.org/media/files/Congregational%20Life/How%20to%20Make%20a%20Church%20More%20Accessible.doc; https://www.bristol.anglican.org/content/pages/documents/how-to-create-an-accessible-service-order.pdf — [R] large-print sizes.
- https://churchpublishing.org/pages/riteplanning — RitePlanning (Episcopal planner); **not read** (429).

**Legal infrastructure**
- https://copyright.gov/dmca-directory/ ; https://copyright.gov/newsnet/2016/640.html — [R] $6 designation, 3-year renewal (from law-firm summaries; confirm on copyright.gov).

**Could not read at all:** songselect.ccli.com (every page is a JavaScript shell or 403), onelicense.net (403), Proclaim, Elvanto, Tithe.ly and Christian Worship help centers (403), several Planning Center help URLs (404 after a URL change), and RitePlanning (429). Christian Copyright Solutions (WORSHIPcast / PERFORMmusic) is a performance-rights licensor in the CCLI group [R]. It does not bear on bulletins or charts, so I did not research it further.
