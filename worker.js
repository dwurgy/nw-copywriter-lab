// NW Copywriter Lab — Cloudflare Worker
// Proxies requests to Gemini API. API key stored as Worker secret: GEMINI_API_KEY
// Model: gemini-2.5-flash — stable, mature, GA model recommended for production workloads.
// (Gemini 3.5 Flash is newer and can hit 503 "high demand" errors more often.)

const MODEL = 'gemini-2.5-flash';

const SYSTEM_PROMPT = `You are a specialized technical copywriter for NW Remarketing, a hardware remarketing company. Your job is to generate Odoo-ready product copy for enterprise networking hardware. You must follow all rules below exactly.

TONE & STYLE:
- Minimalist and objective. No marketing fluff, no superlatives (e.g., do not use "amazing", "powerful", "best-in-class", "robust solution", "cutting-edge").
- Write for network engineers. Focus on latency, throughput, port density, architecture.
- Output must be strictly PLAIN TEXT with no markdown bullet points (* or -), no citations, and no external links. Bold formatting using **text** is allowed in the Ecommerce Description only.

OUTPUT STRUCTURE:
You must always produce exactly three labeled sections in this order:

Ecommerce Description:
[content]

Quotation Description:
[content]

Specifications:
[content]

ECOMMERCE DESCRIPTION RULES:
- Start with a Summary Paragraph. Lead with the Part Number in **bold**. Include the product series, rack units, and primary use case in this paragraph.
- Follow with exactly 3 standalone feature paragraphs.
- Each feature paragraph must start with a **Bold Technical Header**: followed by a single concise sentence focused on a technical advantage.
- Use double line breaks (blank line) between all paragraphs.
- No bullet points or dashes anywhere.

QUOTATION DESCRIPTION RULES:
- One single sentence only.
- Format like a high-density eBay listing title: Brand + Model + Port Count + Speed + Port Type + Management Level + Form Factor.

SPECIFICATIONS RULES:
- A vertical list of key: value pairs, one per line.
- No comma-separated values. Ever. Select only the PRIMARY base port speed for Data Transfer Rate. Uplinks go in the narrative only.
- Use ONLY these approved values. If a value doesn't fit any approved option, flag it as [SUGGESTION: your value].

  Active Ports: 4P, 8P, 10P, 12P, 16P, 22P, 24P, 32P, 48P, 52P, 54P, 60P, 64P, 72P, 96P
  Data Transfer Rate: 1Gb, 10Gb, 16Gb, 25Gb, 32Gb, 40Gb, 100Gb, 400Gb
  Port Type: SFP, SFP+, SFP28, QSFP+, QSFP28, QSFP-DD, CPAK, Fibre Channel, RJ45, XFP
  Management Level: Unmanaged, Smart/Web-Managed, Layer 2, Layer 3
  Rack Units: 1RU, 2RU, 3RU, 4RU
  Airflow: Port-side Intake, Port-side Exhaust
  Power Redundancy: Single, Redundant (1+1), N+1 / N+N, Chassis Only (No PSU)

  Always include Product Weight as the first spec (in lbs, e.g. "21.0 lbs"). Use NA if unknown.
  Always include all 8 attributes in the same order: Product Weight, Active Ports, Data Transfer Rate, Port Type, Management Level, Rack Units, Airflow, Power Redundancy.

EXAMPLE INPUT:
Cisco Nexus N9K-C93180YC-FX

EXAMPLE OUTPUT:
Ecommerce Description:
The **N9K-C93180YC-FX** is a 1RU Cisco Nexus 9300 series switch designed for line-rate Layer 2 and 3 enterprise data center deployments. This platform supports hardware-based VXLAN routing and flexible port configurations suited for spine, leaf, and top-of-rack roles.

**Wire-Speed Performance**: Delivers up to 3.6 Tbps of aggregate bandwidth and 1.4 Bpps of forwarding throughput across all ports to eliminate bottlenecks under sustained traffic loads.

**Flexible Port Configuration**: Ships with 48 ports configurable to 1G, 10G, or 25G speeds plus 6 dedicated 100G QSFP28 uplink ports for high-density data center interconnects.

**Programmable Architecture**: Built on the Cisco NX-OS operating system with support for YANG data models, OpenConfig, and gRPC telemetry for automated operations workflows.

Quotation Description:
Cisco Nexus N9K-C93180YC-FX 48-Port 25G SFP28 6x100G QSFP28 Layer 3 Switch 1RU

Specifications:
Product Weight: 21.0 lbs
Active Ports: 48P
Data Transfer Rate: 25Gb
Port Type: SFP28
Management Level: Layer 3
Rack Units: 1RU
Airflow: Port-side Intake
Power Redundancy: Redundant (1+1)`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // API route — handles the Gemini call
    if (url.pathname === '/api/generate') {
      if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
      }

      try {
        const body = await request.json();
        const input = body?.input;

        if (!input || typeof input !== 'string' || input.trim().length === 0) {
          return new Response(JSON.stringify({ error: 'Input is required.' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        const callGemini = () => fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${env.GEMINI_API_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              system_instruction: {
                parts: [{ text: SYSTEM_PROMPT }],
              },
              contents: [
                {
                  role: 'user',
                  parts: [{ text: input.trim() }],
                },
              ],
              generationConfig: {
                temperature: 0.2,
                maxOutputTokens: 2048,
                topP: 0.8,
              },
            }),
          }
        );

        // Retry on transient overload (503) — up to 3 attempts with short backoff,
        // so a momentary Gemini demand spike never surfaces as an error to the user.
        let geminiResponse;
        let lastErrText = '';
        const MAX_ATTEMPTS = 3;

        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
          geminiResponse = await callGemini();

          if (geminiResponse.ok) break;

          if (geminiResponse.status === 503 && attempt < MAX_ATTEMPTS) {
            lastErrText = await geminiResponse.text();
            await new Promise(r => setTimeout(r, 800 * attempt)); // 800ms, then 1600ms
            continue;
          }

          lastErrText = await geminiResponse.text();
          break;
        }

        if (!geminiResponse.ok) {
          throw new Error(`Gemini API error ${geminiResponse.status}: ${lastErrText}`);
        }

        const geminiData = await geminiResponse.json();
        const text = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || '';

        if (!text) {
          throw new Error('Gemini returned an empty response. The model may have flagged the input.');
        }

        return new Response(JSON.stringify({ text }), {
          headers: { 'Content-Type': 'application/json' },
        });

      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // Everything else — serve the static frontend (index.html, etc.)
    return env.ASSETS.fetch(request);
  },
};
