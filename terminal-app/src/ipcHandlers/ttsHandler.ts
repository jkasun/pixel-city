/**
 * TTS IPC handler — runs Qwen3 TTS API calls from the main process
 * to bypass CORS restrictions in the renderer.
 *
 * Supports two models:
 *   - qwen3-tts-instruct-flash: expressive with emotion instructions (preset voices)
 *   - qwen3-tts-vc-2026-01-22: voice cloning (custom enrolled voices)
 *
 * Handles the 600-character API limit by splitting long text into
 * sentence-based chunks, generating audio for each, and concatenating.
 */

import { IpcMain } from 'electron';

const TTS_URL = 'https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';
const TTS_MODEL_INSTRUCT = 'qwen3-tts-instruct-flash';
const TTS_MODEL_VC = 'qwen3-tts-vc-2026-01-22';
const MAX_CHARS = 550; // Leave margin below the 600 limit

/** Split text into chunks ≤ MAX_CHARS, breaking at sentence boundaries. */
function chunkText(text: string): string[] {
  if (text.length <= MAX_CHARS) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= MAX_CHARS) {
      chunks.push(remaining);
      break;
    }

    // Find the last sentence break within the limit
    let splitAt = -1;
    for (const sep of ['. ', '! ', '? ', '.\n', '!\n', '?\n']) {
      const idx = remaining.lastIndexOf(sep, MAX_CHARS);
      if (idx > splitAt) splitAt = idx + sep.length;
    }

    // Fall back to comma/semicolon
    if (splitAt <= 0) {
      for (const sep of [', ', '; ', ' — ', ' - ']) {
        const idx = remaining.lastIndexOf(sep, MAX_CHARS);
        if (idx > splitAt) splitAt = idx + sep.length;
      }
    }

    // Last resort: split at last space
    if (splitAt <= 0) {
      splitAt = remaining.lastIndexOf(' ', MAX_CHARS);
    }

    // Absolute last resort: hard cut
    if (splitAt <= 0) {
      splitAt = MAX_CHARS;
    }

    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  return chunks.filter(c => c.length > 0);
}

/** Call the TTS API for a single chunk, returns a Buffer of audio data. */
async function generateChunk(
  text: string,
  voice: string,
  rate: number | undefined,
  apiKey: string,
  instructions?: string,
): Promise<Buffer> {
  const params: Record<string, unknown> = {};
  if (rate != null) params.rate = rate;

  // Use instruct model when instructions are provided, otherwise VC model
  const model = instructions ? TTS_MODEL_INSTRUCT : TTS_MODEL_VC;
  const input: Record<string, unknown> = { text, voice };
  if (instructions) {
    input.instructions = instructions;
    input.language_type = 'English';
  }

  const response = await fetch(TTS_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input,
      parameters: params,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`TTS API error ${response.status}: ${err}`);
  }

  const json: any = await response.json();
  if (json.code) throw new Error(`TTS failed [${json.code}]: ${json.message}`);

  // Handle base64 audio response (only if data is non-empty)
  const audioData = json.output?.audio?.data;
  if (audioData && audioData.length > 0) {
    const raw = audioData.startsWith('data:')
      ? audioData.split(',')[1]
      : audioData;
    return Buffer.from(raw, 'base64');
  }

  // Handle URL response
  const audioUrl = json.output?.audio?.url || json.output?.audio;
  if (audioUrl && typeof audioUrl === 'string' && audioUrl.startsWith('http')) {
    const audioRes = await fetch(audioUrl);
    return Buffer.from(await audioRes.arrayBuffer());
  }

  throw new Error('Unexpected TTS response format');
}

export function register(ipcMain: IpcMain) {
  // Single text → audio (legacy / fallback)
  ipcMain.handle('tts-generate', async (_event, { text, voice, rate, instructions }: { text: string; voice: string; rate?: number; instructions?: string }) => {
    const apiKey = process.env.MODEL_STUDIO_API_KEY;
    if (!apiKey) return { error: 'MODEL_STUDIO_API_KEY not set' };

    try {
      const chunks = chunkText(text);
      const audioBuffers: Buffer[] = [];

      for (const chunk of chunks) {
        const buf = await generateChunk(chunk, voice, rate, apiKey, instructions);
        audioBuffers.push(buf);
      }

      const combined = Buffer.concat(audioBuffers);
      return { audioDataUrl: `data:audio/mpeg;base64,${combined.toString('base64')}` };
    } catch (err: any) {
      return { error: `TTS request failed: ${err.message}` };
    }
  });

  // Array of segments → single concatenated audio (per-segment emotion control)
  ipcMain.handle('tts-generate-segments', async (_event, { segments, voice, rate, baseInstructions }: {
    segments: Array<{ text: string; emotion?: string }>;
    voice: string;
    rate?: number;
    baseInstructions: string;
  }) => {
    const apiKey = process.env.MODEL_STUDIO_API_KEY;
    if (!apiKey) return { error: 'MODEL_STUDIO_API_KEY not set' };

    try {
      const audioBuffers: Buffer[] = [];

      for (const segment of segments) {
        // Build per-segment instructions: base voice + emotion override
        const instructions = segment.emotion
          ? `${baseInstructions} Deliver this part with emotion: ${segment.emotion}.`
          : baseInstructions;

        const chunks = chunkText(segment.text);
        for (const chunk of chunks) {
          const buf = await generateChunk(chunk, voice, rate, apiKey, instructions);
          audioBuffers.push(buf);
        }
      }

      const combined = Buffer.concat(audioBuffers);
      return { audioDataUrl: `data:audio/mpeg;base64,${combined.toString('base64')}` };
    } catch (err: any) {
      return { error: `TTS request failed: ${err.message}` };
    }
  });
}
