# Train Refund

An app that catches every delayed or cancelled UK train you're owed money for — whether you booked through Trainline, TrainPal, the operator or a station ticket machine — and has your Delay Repay claim filled in and ready for one tap.

## How it works

1. **Bookings come in** from your Trainline confirmation emails: paste one into the page, or connect Gmail (read-only) and they're picked up every 15 minutes.
2. **After each journey** (an hour after scheduled arrival) the app asks National Rail's Historical Service Performance (HSP) data when your train actually arrived.
3. **If you're owed money** under the operator's Delay Repay scheme, a claim appears with the amount and the 28-day deadline.
4. **One tap** copies every detail the operator's form needs and opens that form. You check it, submit, and mark it as submitted, then paid.
5. **Cancelled train or missed connection?** The app asks what time you actually arrived, then works out the refund.

The final submit stays with you: operator forms ask the claimant to confirm the claim is true, and most have bot checks.

## Run it

Needs Node 22.6 or newer. No packages to install.

```bash
cp .env.example .env     # add your HSP login (and Google keys if using Gmail)
npm start                # http://localhost:3000
npm test                 # 34 tests, no network needed
```

### HSP access (needed for real delay data)
Create a free account on the Rail Data Marketplace (raildata.org.uk) or the National Rail Data Portal (opendata.nationalrail.co.uk, tick **HSP**). HSP must be called from the server (no browser/CORS). The Marketplace limits requests to about 1 per second; the app spaces requests out automatically.

### Gmail (optional)
In Google Cloud Console: create a project, enable the **Gmail API**, set up the OAuth consent screen (add yourselves as test users), and create an OAuth client of type *Web application* with redirect URI `http://localhost:3000/auth/google/callback`. Put the ID and secret in `.env`. The app only asks for `gmail.readonly` and only reads emails from trainline.com.
Note: `gmail.readonly` is a restricted scope. It works for test users while the app is in testing; a public launch needs Google's verification and security assessment.

## Code map

| File | What it does |
|---|---|
| `src/compensation.ts` | Delay Repay rules (DR15/DR30, single/return) per operator |
| `src/booking.ts` | Parses Trainline confirmation emails into bookings with legs |
| `src/hsp.ts` | Looks up a train's actual arrival in HSP |
| `src/stations.ts` | Station name → 3-letter code |
| `src/matcher.ts` | Booking + HSP → owed / not owed / needs arrival time |
| `src/claimPack.ts` | Every field for the operator form, deadline and claim link |
| `src/store.ts` | JSON file storage (single user) |
| `src/scheduler.ts` | Checks journeys after arrival, rate-limits HSP, notifies |
| `src/gmail.ts` | Read-only Gmail OAuth and booking email sync |
| `src/server.ts` | API + background checks every 15 minutes |
| `public/index.html` | The one-tap web page |

## Known gaps / next tickets

- **Parser built from a made-up email.** `test/fixtures/trainline-sample.txt` is synthetic. Replace it with a real (redacted) Trainline email and adjust `booking.ts`. Return journeys aren't parsed yet.
- **HSP responses are modelled on the documented format.** Check against a real response once you have a key.
- **Only five operators** have rules and claim links (Avanti, GWR, LNER, Northern, TransPennine Express). Check each operator's Delay Repay page before adding more.
- **Station list** covers major stations only; swap in the full National Rail station list.
- **TrainPal, operator websites and paper tickets** (photo scan) need their own parsers.
- **Single user, no login**, binds to localhost. Add accounts and a real database before hosting it.
- **Notifications** print to the console; plug in email or push.
