# AidLine

Voice-first help finding food and utility assistance in San Francisco.

## Local environment

```bash
cd ~/aidline
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Keys live in `.env.local` (already created, left blank):

- `ASSEMBLYAI_API_KEY` enables the microphone and spoken replies.
- `PARALLEL_API_KEY` enables live web search.

Restart the dev server after you add or change keys. Without a search key, AidLine still runs and shows official starting pages marked as unconfirmed. Without a voice key, use Type instead.

## Call or text AidLine (Twilio)

People can ask for help by phone call or SMS. Both use the same dialogue and Parallel search as the web app.

1. Add `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_PHONE_NUMBER` to `.env.local`.
2. Expose the dev server publicly, for example `ngrok http 3000`, and set `TWILIO_WEBHOOK_BASE_URL` to that `https://…` URL. Restart `npm run dev`.
3. In the Twilio console, open your number and set:
   - **A call comes in** → Webhook, `POST`, `https://<public-url>/api/twilio/voice`
   - **A message comes in** → Webhook, `POST`, `https://<public-url>/api/twilio/sms`

Callers speak; Twilio transcribes and AidLine answers aloud. After results, a caller can say "text me" to get the options by SMS on the number they called from. Texters can reply `RESET` to start over. Every webhook is checked against Twilio's signature; for local curl testing only, `TWILIO_SKIP_SIGNATURE=1` turns that off outside production.

Call and text context is kept in memory for 30 minutes per call or number (numbers are hashed, nothing is written to disk). On multi-instance hosts, move it to a shared store such as Redis.

```bash
npm test
npm run build
```

AidLine does not create accounts or save conversations. Do not enter Social Security numbers, bank details, or card numbers.
