# n8n: BlueSense daily water-risk digest

[`bluesense_daily_digest.json`](bluesense_daily_digest.json) emails a short water-risk digest for Bangladesh every
day at 08:00 Asia/Dhaka.

Schedule Trigger → GET `/api/dashboard/summary?region=bd` → POST `/api/copilot/stream` (one question, response read
as text, 120 s timeout) → Code node (joins the streamed `delta` text and the key KPIs into a subject and body) →
Gmail "Send a message".

Base URL: `https://bluesense-api-preview-ca2-2uju3.vercel.app` (Vercel Preview backend).

## Import

1. In n8n, open **Workflows → Create workflow → ⋯ → Import from File** and choose `bluesense_daily_digest.json`.
2. Open **Send a message**. Under *Credential to connect with*, choose or create a Gmail OAuth2 credential. The file
   contains no credential.
3. In the same node, replace `recipient@example.com` in **To** with the real address.
4. Check **Workflow settings → Timezone** is `Asia/Dhaka`. The import sets it, and the schedule uses it.
5. Click **Execute workflow** once to test, then switch the workflow to **Active**.

## Notes

- Each run asks the Copilot one question, which counts against its per-client and per-site daily limits
  (`clientId` = `n8n-daily-digest`).
- If the Copilot fails (limit reached, timeout, model error), the email is still sent with the KPIs. The subject
  then ends with "(Copilot unavailable)" and the body gives the error code.
- If the dashboard summary request fails, the run stops and no email is sent.
- Node versions: Schedule Trigger 1.2, HTTP Request 4.2, Code 2, Gmail 2.1.
