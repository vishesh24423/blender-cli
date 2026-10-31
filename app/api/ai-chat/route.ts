import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { extractScript as extractPython } from '@/lib/script-extract';
 
export const maxDuration = 300;

const PROVIDERS = {
  groq: {
    url: 'https://api.groq.com/openai/v1/chat/completions',
    key: process.env.GROQ_API_KEY,
    model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
    label: 'Groq',
  },
  inception: {
    url: 'https://api.inceptionlabs.ai/v1/chat/completions',
    key: process.env.INCEPTION_API_KEY,
    model: process.env.INCEPTION_MODEL || 'mercury-3',
    label: 'Mercury',
  },
} as const;

type Provider = (typeof PROVIDERS)[keyof typeof PROVIDERS];

function fetchProvider(p: Provider, system: string, messages: unknown[]) {
  return fetch(p.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${p.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: p.model,
      messages: [{ role: 'system', content: system }, ...messages.slice(-10)],
      temperature: 0.4,
      max_tokens: 8000,
    }),
  });
}

export async function POST(req: NextRequest) {
  const { messages, provider } = await req.json();
  if (!Array.isArray(messages) || messages.length === 0)
    return NextResponse.json({ error: 'messages[] required' }, { status: 400 });
  const key: 'groq' | 'inception' = provider === 'inception' ? 'inception' : 'groq';
  const p = PROVIDERS[key];
  if (!p.key) return NextResponse.json({ error: `AI not configured (missing ${p.label} API key)` }, { status: 500 });

  let system = '';
  try {
    system = await readFile(join(process.cwd(), 'BLENDER_AI_SYSTEM.md'), 'utf8');
  } catch {
    system = 'Generate Blender bpy scripts. Only create geometry, no export/render/quit calls.';
  }

  const res = await fetchProvider(p, system, messages);
  let active = p;
  // The Inception free tier returns 429/5xx (often a Cloudflare HTML page) when
  // Mercury is at capacity. Fall back to Groq instead of dead-ending the user
  // with a raw upstream error page.
  let upstream = res;
  if (!res.ok && key !== 'groq' && (res.status === 429 || res.status >= 500)) {
    active = PROVIDERS.groq;
    upstream = await fetchProvider(active, system, messages);
    console.log(`[ai-chat] ${p.label} ${res.status}; fell back to ${active.label}`);
  }
  if (!upstream.ok) {
    const t = await upstream.text();
    if (upstream.status === 429)
      return NextResponse.json({ error: `${active.label} rate limit hit — try again in a minute.` }, { status: 429 });
    const detail = t.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
    return NextResponse.json({ error: `${active.label} error ${upstream.status}${detail ? `: ${detail}` : ''}` }, { status: 502 });
  }
  const data = await upstream.json();
  const reply: string = data.choices?.[0]?.message?.content ?? '';
  if (!reply) {
    const fr = data?.choices?.[0]?.finish_reason;
    console.log('[ai-chat] empty reply, finish_reason:', fr, 'keys:', Object.keys(data ?? {}));
    return NextResponse.json({ error: fr === 'length'
      ? 'AI spent its whole output budget thinking — try a shorter, simpler request.'
      : 'AI returned an empty response — try again or rephrase.' }, { status: 502 });
  }
  return NextResponse.json({ reply, script: extractPython(reply) });
}
