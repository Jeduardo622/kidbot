import { kidTone, moderate } from '../guardrails.js';
import type { VoiceRequest, VoiceResponse } from '../types.js';

const personaVoices: Record<string, { prefix: string; emoji: string }> = {
  robot: { prefix: 'Beep boop', emoji: '🤖' },
  fairy: { prefix: 'Sparkle', emoji: '🧚' },
  explorer: { prefix: 'Adventure', emoji: '🧭' }
};

const buildSpeech = (request: VoiceRequest): { text: string; ssml: string } => {
  const tone = kidTone(request.ageBand ?? '7-9');
  const persona = personaVoices[request.persona];
  const summary = `${persona.prefix}! ${request.text}`;
  const text = `${persona.emoji} ${summary} (${tone.vocabulary}).`;
  const ssml = `<speak>${persona.prefix}! <break strength="medium"/>${request.text}. <break strength="short"/>${tone.sentenceLength}.</speak>`;
  return { text, ssml };
};

export const craftVoiceReply = (request: VoiceRequest): VoiceResponse => {
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
    ssml
  };
};
