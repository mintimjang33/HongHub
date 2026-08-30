import { getConfigValue } from './remoteConfig';

export type AiProvider = 'claude' | 'gemini';

export async function callClaude(systemPrompt: string, userPrompt: string): Promise<string> {
  const apiKey = await getConfigValue('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY를 app_config/환경변수에서 찾을 수 없습니다.');
  const model = (await getConfigValue('ANTHROPIC_MODEL')) || 'claude-sonnet-4-6';

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Claude 요청 실패 (${res.status}): ${errText.slice(0, 300)}`);
  }
  const data = await res.json();
  return (data.content || [])
    .filter((c: { type: string }) => c.type === 'text')
    .map((c: { text: string }) => c.text)
    .join('\n')
    .trim();
}

export async function callGemini(systemPrompt: string, userPrompt: string): Promise<string> {
  const apiKey = await getConfigValue('GEMINI_API_KEY');
  if (!apiKey) throw new Error('GEMINI_API_KEY를 app_config/환경변수에서 찾을 수 없습니다.');
  const model = (await getConfigValue('GEMINI_MODEL')) || 'gemini-3.6-flash';

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
    }
  );
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Gemini 요청 실패 (${res.status}): ${errText.slice(0, 300)}`);
  }
  const data = await res.json();
  const rawText = (data.candidates?.[0]?.content?.parts || [])
    .map((p: { text?: string }) => p.text || '')
    .join('');
  return rawText.trim();
}

export async function callAi(provider: AiProvider, systemPrompt: string, userPrompt: string): Promise<string> {
  return provider === 'gemini' ? callGemini(systemPrompt, userPrompt) : callClaude(systemPrompt, userPrompt);
}

// 4번(분석) 단계 전용 — 썸네일 이미지를 실제로 보여주면서 물어봐야 해서 이미지 파츠를 넣을 수 있고,
// 이 기능만큼은 기본 GEMINI_MODEL(가벼운 flash)이 아니라 더 깊게 보는 pro 모델을 쓰도록 model을
// 직접 지정할 수 있게 했다. 일반 callGemini처럼 JSON 강제 응답 모드를 쓰지 않는다(자유 서술문 결과라).
export async function callGeminiVision({
  systemPrompt,
  userPrompt,
  imageUrls = [],
  model,
}: {
  systemPrompt: string;
  userPrompt: string;
  imageUrls?: string[];
  model?: string;
}): Promise<string> {
  const apiKey = await getConfigValue('GEMINI_API_KEY');
  if (!apiKey) throw new Error('GEMINI_API_KEY를 app_config/환경변수에서 찾을 수 없습니다.');
  const useModel = model || 'gemini-3.1-pro-preview';

  const imageParts = await Promise.all(
    imageUrls.map(async (url) => {
      const res = await fetch(url);
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      const mimeType = res.headers.get('content-type') || 'image/jpeg';
      return { inlineData: { mimeType, data: buf.toString('base64') } };
    })
  );

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${useModel}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [...imageParts.filter(Boolean), { text: userPrompt }] }],
      }),
    }
  );
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Gemini(vision) 요청 실패 (${res.status}): ${errText.slice(0, 300)}`);
  }
  const data = await res.json();
  return (data.candidates?.[0]?.content?.parts || [])
    .map((p: { text?: string }) => p.text || '')
    .join('')
    .trim();
}
