# AidLine

Voice-first help for people in San Francisco who can't afford food: free meals, free groceries, food help lines, restaurants that take CalFresh EBT, CalFresh, WIC, and meals for older adults. It only covers food.

## Local environment

```bash
cd ~/aidline
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Keys live in `.env.local` (already created, left blank):

- `ASSEMBLYAI_API_KEY` enables the microphone and spoken replies.
- `PARALLEL_API_KEY` is optional. Without it, AidLine uses Parallel's free, rate-limited search. Add a key for higher limits. Set `PARALLEL_FREE_SEARCH=off` to use only the built-in official links.

## How results are checked

1. **Parallel Search** finds official San Francisco food pages.
2. **Parallel Decisions** then checks each place with typed questions: how likely it gives free food (places under 25% are dropped), who can go (anyone, a specific group, or apply first), and, when someone needs food today, how likely it is serving food today. Results likely open today are listed first.

Cards show these as estimates with their sources. They are never eligibility decisions. With a key, AidLine calls `POST /v1/decisions`; without one, it uses the same engine through Parallel's free `web_decisions` tool. Set `PARALLEL_DECISIONS=off` to skip this step.

## Call AidLine by phone (Twilio + AssemblyAI)

```
Caller → Twilio number → SIP trunk → AssemblyAI Voice Agent → POST /api/phone-tool → Parallel Search + Decisions
```

AssemblyAI answers the call, listens, and speaks. When it needs places, it calls AidLine's `search_assistance` tool over HTTPS, and AidLine runs the same Search and Decisions as the website.

1. In `.env.local`, set `PHONE_TOOL_SECRET` (a long random string), `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` (like `+14155550123`), and `PUBLIC_BASE_URL` (your public HTTPS address, for example a `cloudflared tunnel --url http://localhost:3000` URL).
2. Restart `npm run dev`, then run `npm run phone:setup`. It checks the tool is reachable, creates or updates the AssemblyAI agent, creates a Twilio SIP trunk pointed at AssemblyAI, attaches your number, and connects the number to the agent. It is safe to re-run.
3. If the public address changes, update `PUBLIC_BASE_URL` and run `npm run phone:setup -- --agent`.

The agent and trunk IDs are saved in `.aidline-phone.json` (gitignored).

Restart the dev server after you add or change keys. If search is unavailable, AidLine shows official starting pages and food help numbers (211, SF-Marin Food Bank, CalFresh), each copied from its official page. Without a voice key, or if the microphone is blocked, AidLine switches to a text box automatically.

```bash
npm test
npm run build
```

AidLine does not create accounts or save conversations. Do not enter Social Security numbers, bank details, or card numbers.
