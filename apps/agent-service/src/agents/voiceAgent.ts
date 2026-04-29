import { kidTone, moderate, moderateAsync, safeSystemPrompt } from '../guardrails.js';
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

const craftVoiceReplyWithProvider = async (
  request: VoiceRequest,
  provider: ModelProvider,
): Promise<VoiceResponse> => {
  const inputModeration = await moderateAsync(request.text, provider);
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
      `Child request: ${request.text}`,
    ].join('\n'),
    maxTokens: 220,
    temperature: 0.5,
  });
  if (!text.trim()) {
    throw new MalformedOutputError('Provider returned an empty voice response');
  }
  const finalText = `${persona.emoji} ${text.replace(/^([🤖🧚🧭]\s)?/, '').trim()}`;
  const outputModeration = await moderateAsync(finalText, provider);
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

  const inputModeration = moderate(request.text);
  if (inputModeration.blocked) {
    return { blocked: true, message: inputModeration.message };
  }

  const { text, ssml } = buildSpeech(request);
  const outputModeration = moderate(text);
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
