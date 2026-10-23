# NW Copywriter Lab

An internal tool built for [NW Remarketing](https://nwremarketing.com) that turns an enterprise networking hardware part number into Odoo-ready product copy: an ecommerce description, a one-line quotation description, and a standardized specifications block.

Type in something like `Cisco Nexus N9K-C93180YC-FX` and get back copy that can be pasted straight into an Odoo product record, written in a consistent, no-fluff style for network engineers.

## What it produces

Every request returns exactly three sections:

**Ecommerce Description** — A summary paragraph led by the bolded part number (series, rack units, primary use case), followed by three short feature paragraphs, each with a bold technical header.

**Quotation Description** — One dense, listing-style line: Brand + Model + Port Count + Speed + Port Type + Management Level + Form Factor.

**Specifications** — Eight `key: value` attributes, always in the same order, drawn from a fixed list of approved values so they map cleanly onto Odoo product attributes:

| Attribute | Approved values |
|---|---|
| Product Weight | lbs, or `NA` if unknown |
| Active Ports | 4P, 8P, 10P, 12P, 16P, 22P, 24P, 32P, 48P, 52P, 54P, 60P, 64P, 72P, 96P |
| Data Transfer Rate | 1Gb, 10Gb, 16Gb, 25Gb, 32Gb, 40Gb, 100Gb, 400Gb |
| Port Type | SFP, SFP+, SFP28, QSFP+, QSFP28, QSFP-DD, CPAK, Fibre Channel, RJ45, XFP |
| Management Level | Unmanaged, Smart/Web-Managed, Layer 2, Layer 3 |
| Rack Units | 1RU, 2RU, 3RU, 4RU |
| Airflow | Port-side Intake, Port-side Exhaust |
| Power Redundancy | Single, Redundant (1+1), N+1 / N+N, Chassis Only (No PSU) |

If a value doesn't fit the approved list, the model flags it as `[SUGGESTION: …]` instead of inventing a new attribute value, so a person can review it before it reaches Odoo.

### Example

Input:

```
Cisco Nexus N9K-C93180YC-FX
```

Quotation Description:

```
Cisco Nexus N9K-C93180YC-FX 48-Port 25G SFP28 6x100G QSFP28 Layer 3 Switch 1RU
```

Specifications:

```
Product Weight: 21.0 lbs
Active Ports: 48P
Data Transfer Rate: 25Gb
Port Type: SFP28
Management Level: Layer 3
Rack Units: 1RU
Airflow: Port-side Intake
Power Redundancy: Redundant (1+1)
```

## How it works

```
public/index.html   Single-page frontend (input box, formatted output, copy buttons)
worker.js           Cloudflare Worker: serves the frontend and handles POST /api/generate
wrangler.toml       Worker + static assets configuration
```

The frontend sends the part number to `/api/generate`. The Worker adds the copywriting rules as a system prompt and calls Google's Gemini API (`gemini-2.5-flash`, temperature 0.2 for consistent output). Transient 503 "high demand" errors are retried automatically up to three times with backoff.

The Gemini API key never reaches the browser; it lives only as a Worker secret.

## Running it yourself

Requires a Cloudflare account, [Wrangler](https://developers.cloudflare.com/workers/wrangler/), and a [Gemini API key](https://aistudio.google.com/apikey).

```bash
npm install -g wrangler
wrangler login

# Store the API key as a secret (you'll be prompted to paste it)
wrangler secret put GEMINI_API_KEY

# Local development
wrangler dev

# Deploy
wrangler deploy
```

For local development you can instead put the key in a `.dev.vars` file (`GEMINI_API_KEY=...`). Don't commit that file.

## Adapting it

All of the copy rules live in the `SYSTEM_PROMPT` constant at the top of `worker.js`: tone, section structure, and the approved attribute values. To match a different catalog or a different set of Odoo attributes, edit that prompt; no other code needs to change. The model is set by the `MODEL` constant on the line above it.

## Notes

- Output is AI-generated from the part number alone. Specs such as weight, airflow and PSU configuration vary by SKU and build, so verify them before publishing a listing.
- The `/api/generate` endpoint has no authentication. If you deploy your own copy, consider putting it behind [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/) so others can't use your API quota.

---

Built by David Wurgler for NW Remarketing.
