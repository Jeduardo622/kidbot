import { kidTone, moderateAsync, moderateWithoutProvider, safeSystemPrompt } from '../guardrails.js';
import { MalformedOutputError, UnsafeOutputError, type ModelProvider } from '../provider.js';
import type { Persona, VoiceRequest, VoiceResponse } from '../types.js';

const personaVoices: Record<Persona, { prefix: string; emoji: string }> = {
  robot: { prefix: 'Beep boop', emoji: '🤖' },
  fairy: { prefix: 'Sparkle', emoji: '🧚' },
  explorer: { prefix: 'Adventure', emoji: '🧭' },
};

const buildSpeech = (request: VoiceRequest): { text: string; ssml: string } => {
  const tone = kidTone(request.ageBand ?? '7-9');
  const persona = personaVoices[request.persona] ?? personaVoices.robot;
  const summary = `${persona.prefix}! ${request.text}`;
  const text = `${persona.emoji} ${summary} (${tone.vocabulary}).`;
  const ssml = `<speak>${persona.prefix}! <break strength="medium"/>${request.text}. <break strength="short"/>${tone.sentenceLength}.</speak>`;
  return { text, ssml };
};

const withSsml = (persona: Persona, text: string): string => {
  const safeText = text.replace(
    /[<>&]/g,
    (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[char] ?? char,
  );
  return `<speak>${safeText}</speak>`;
};

/**
 * Everything the child supplied for this turn, current text plus any prior
 * turns the client replays, moderated as one string so one moderation call
 * covers a spoofed or edited history.
 */
export const voiceModerationInput = (request: VoiceRequest): string =>
  [...(request.history ?? []).map((turn) => turn.text), request.text].join('\n');

const historyLines = (request: VoiceRequest): string[] => {
  const history = request.history ?? [];
  if (history.length === 0) return [];
  return [
    'Earlier in this conversation (oldest first):',
    ...history.map((turn) => `${turn.role === 'child' ? 'Child' : 'Kidbot'}: ${turn.text}`),
  ];
};

const craftVoiceReplyWithProvider = async (
  request: VoiceRequest,
  provider: ModelProvider,
): Promise<VoiceResponse> => {
  const inputModeration = await moderateAsync(voiceModerationInput(request), provider, request.ageBand);
  if (inputModeration.blocked) {
    return { blocked: true, message: inputModeration.message };
  }

  const tone = kidTone(request.ageBand ?? '7-9');
  const persona = personaVoices[request.persona] ?? personaVoices.robot;
  const text = await provider.generateText({
    task: 'voice',
    system: safeSystemPrompt,
    user: [
      `Persona: ${request.persona}`,
      `Tone: ${tone.sentenceLength}; ${tone.vocabulary}`,
      'Answer the child in 1-3 cheerful, age-appropriate sentences.',
      'Avoid scary, violent, romantic, adult, or personal-data content.',
      ...historyLines(request),
      `Child request: ${request.text}`,
    ].join('\n'),
    maxTokens: 220,
    temperature: 0.5,
  });
  if (!text.trim()) {
    throw new MalformedOutputError('Provider returned an empty voice response');
  }
  const finalText = `${persona.emoji} ${text.replace(/^([🤖🧚🧭]\s)?/, '').trim()}`;
  const outputModeration = await moderateAsync(finalText, provider, request.ageBand);
  if (outputModeration.blocked) {
    throw new UnsafeOutputError(outputModeration.message);
  }

  return {
    blocked: false,
    persona: request.persona,
    text: finalText,
    ssml: withSsml(request.persona, finalText),
  };
};

export function craftVoiceReply(request: VoiceRequest): VoiceResponse;
export function craftVoiceReply(
  request: VoiceRequest,
  provider: ModelProvider,
): Promise<VoiceResponse>;
export function craftVoiceReply(
  request: VoiceRequest,
  provider?: ModelProvider,
): VoiceResponse | Promise<VoiceResponse> {
  if (provider) {
    return craftVoiceReplyWithProvider(request, provider);
  }

  const inputModeration = moderateWithoutProvider(voiceModerationInput(request));
  if (inputModeration.blocked) {
    return { blocked: true, message: inputModeration.message };
  }

  const { text, ssml } = buildSpeech(request);
  const outputModeration = moderateWithoutProvider(text);
  if (outputModeration.blocked) {
    return { blocked: true, message: outputModeration.message };
  }

  return {
    blocked: false,
    persona: request.persona,
    text,
    ssml,
  };
}
