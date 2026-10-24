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
  dahl: {
    url: 'https://inference.dahl.global/v1/chat/completions',
    key: process.env.DAHL_API_KEY,
    model: process.env.DAHL_MODEL || 'zai-org/GLM-5.3-Flash',
    label: 'GLM',
  },
  'dahl-deepseek': {
    url: 'https://inference.dahl.global/v1/chat/completions',
    key: process.env.DAHL_API_KEY,
    model: 'deepseek-ai/DeepSeek-V4-Flash-0731',
    label: 'DeepSeek',
  },
} as const;

export async function POST(req: NextRequest) {
  const { messages, provider } = await req.json();
  if (!Array.isArray(messages) || messages.length === 0)
    return NextResponse.json({ error: 'messages[] required' }, { status: 400 });
  const key: 'groq' | 'dahl' | 'dahl-deepseek' = provider === 'dahl' || provider === 'dahl-deepseek' ? provider : 'groq';
  const p = PROVIDERS[key];
  if (!p.key) return NextResponse.json({ error: `AI not configured (missing ${p.label} API key)` }, { status: 500 });

  let system = '';
  try {
    system = await readFile(join(process.cwd(), 'BLENDER_AI_SYSTEM.md'), 'utf8');
  } catch {
    system = 'Generate Blender bpy scripts. Only create geometry, no export/render/quit calls.';
  }

  const res = await fetch(p.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${p.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: p.model,
      messages: [{ role: 'system', content: system }, ...messages.slice(-10)],
      temperature: 0.4,
      max_tokens: 8000,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    if (res.status === 429)
      return NextResponse.json({ error: `${p.label} rate limit hit — try again in a minute.` }, { status: 429 });
    return NextResponse.json({ error: `${p.label} error ${res.status}: ${t.slice(0, 300)}` }, { status: 502 });
  }
  const data = await res.json();
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
