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

// 썸네일 패턴 분석(4번 단계)처럼 이미지를 같이 보여줘야 할 때 쓴다. Claude Messages API는
// source.type="url"로 공개 이미지 URL을 그대로 넘길 수 있어 별도 다운로드/base64 변환이 필요 없다.
export async function callClaudeVision(systemPrompt: string, userPrompt: string, imageUrls: string[]): Promise<string> {
  const apiKey = await getConfigValue('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY를 app_config/환경변수에서 찾을 수 없습니다.');
  const model = (await getConfigValue('ANTHROPIC_MODEL')) || 'claude-sonnet-4-6';

  const content = [
    ...imageUrls.map((url) => ({ type: 'image', source: { type: 'url', url } })),
    { type: 'text', text: userPrompt },
  ];

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
      messages: [{ role: 'user', content }],
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Claude(vision) 요청 실패 (${res.status}): ${errText.slice(0, 300)}`);
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
