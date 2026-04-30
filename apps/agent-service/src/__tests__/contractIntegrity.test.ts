import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { describe, expect, it } from 'vitest';
import {
  ageBandValues as agentAgeBandValues,
  coloringRequestSchema,
  personaValues as agentPersonaValues,
  scienceRequestSchema,
  storyRequestSchema,
  voiceRequestSchema
} from '../types.js';

const accepts = (schema: { safeParse: (payload: unknown) => { success: boolean } }, payload: unknown): boolean =>
  schema.safeParse(payload).success;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../../../');

const loadMcpSchemas = async () =>
  (await import(pathToFileURL(path.join(repoRoot, 'apps/mcp-server/src/schema.ts')).href)) as {
    ageBandSchema: { options: readonly string[] };
    personaSchema: { options: readonly string[] };
    voiceInputSchema: { safeParse: (payload: unknown) => { success: boolean } };
    storyPanelsSchema: { safeParse: (payload: unknown) => { success: boolean } };
    coloringOutlineSchema: { safeParse: (payload: unknown) => { success: boolean } };
    scienceSimSchema: { safeParse: (payload: unknown) => { success: boolean } };
  };

describe('contract integrity', () => {
  it('keeps enum domains aligned between MCP and agent-service schemas', async () => {
    const mcp = await loadMcpSchemas();
    expect([...mcp.ageBandSchema.options]).toEqual([...agentAgeBandValues]);
    expect([...mcp.personaSchema.options]).toEqual([...agentPersonaValues]);
  });

  it('keeps voice schema constraints aligned', async () => {
    const mcp = await loadMcpSchemas();
    const valid = { text: 'a', persona: 'robot' as const };
    const validWithSession = {
      ...valid,
      ageBand: '7-9',
      profileId: 'local-default',
      sessionId: 'kb_session_abc123XYZ',
    };
    const maxBoundary = { text: 'a'.repeat(280), persona: 'robot' as const };
    const tooLong = { text: 'a'.repeat(281), persona: 'robot' as const };
    const missingText = { persona: 'robot' as const };
    const invalidSession = { ...valid, sessionId: 'kid name' };
    const invalidProfile = { ...valid, profileId: 'ab' };

    expect(accepts(mcp.voiceInputSchema, valid)).toBe(true);
    expect(accepts(voiceRequestSchema, valid)).toBe(true);
    expect(accepts(mcp.voiceInputSchema, validWithSession)).toBe(true);
    expect(accepts(voiceRequestSchema, validWithSession)).toBe(true);
    expect(accepts(mcp.voiceInputSchema, maxBoundary)).toBe(true);
    expect(accepts(voiceRequestSchema, maxBoundary)).toBe(true);
    expect(accepts(mcp.voiceInputSchema, tooLong)).toBe(false);
    expect(accepts(voiceRequestSchema, tooLong)).toBe(false);
    expect(accepts(mcp.voiceInputSchema, missingText)).toBe(false);
    expect(accepts(voiceRequestSchema, missingText)).toBe(false);
    expect(accepts(mcp.voiceInputSchema, { ...valid, ageBand: '7-9' })).toBe(true);
    expect(accepts(voiceRequestSchema, { ...valid, ageBand: '7-9' })).toBe(true);
    expect(accepts(mcp.voiceInputSchema, { ...valid, ageBand: '13-15' })).toBe(false);
    expect(accepts(voiceRequestSchema, { ...valid, ageBand: '13-15' })).toBe(false);
    expect(accepts(mcp.voiceInputSchema, invalidSession)).toBe(false);
    expect(accepts(voiceRequestSchema, invalidSession)).toBe(false);
    expect(accepts(mcp.voiceInputSchema, invalidProfile)).toBe(false);
    expect(accepts(voiceRequestSchema, invalidProfile)).toBe(false);
  });

  it('keeps story schema constraints aligned', async () => {
    const mcp = await loadMcpSchemas();
    const valid = { theme: 'Kind dragon story', panels: 4 };
    const validWithAge = { theme: 'Kind dragon story', panels: 4, ageBand: '7-9' };
    const validWithSession = {
      ...valid,
      ageBand: '4-6',
      profileId: 'local-default',
      sessionId: 'kb_session_story123',
    };
    const tooShortTheme = { theme: 'ab', panels: 4 };
    const tooManyPanels = { theme: 'Kind dragon story', panels: 9 };
    const tooFewPanels = { theme: 'Kind dragon story', panels: 1 };
    const invalidAge = { theme: 'Kind dragon story', panels: 4, ageBand: '13-15' };

    expect(accepts(mcp.storyPanelsSchema, valid)).toBe(true);
    expect(accepts(storyRequestSchema, valid)).toBe(true);
    expect(accepts(mcp.storyPanelsSchema, validWithAge)).toBe(true);
    expect(accepts(storyRequestSchema, validWithAge)).toBe(true);
    expect(accepts(mcp.storyPanelsSchema, validWithSession)).toBe(true);
    expect(accepts(storyRequestSchema, validWithSession)).toBe(true);
    expect(accepts(mcp.storyPanelsSchema, tooShortTheme)).toBe(false);
    expect(accepts(storyRequestSchema, tooShortTheme)).toBe(false);
    expect(accepts(mcp.storyPanelsSchema, tooManyPanels)).toBe(false);
    expect(accepts(storyRequestSchema, tooManyPanels)).toBe(false);
    expect(accepts(mcp.storyPanelsSchema, tooFewPanels)).toBe(false);
    expect(accepts(storyRequestSchema, tooFewPanels)).toBe(false);
    expect(accepts(mcp.storyPanelsSchema, invalidAge)).toBe(false);
    expect(accepts(storyRequestSchema, invalidAge)).toBe(false);
  });

  it('keeps coloring schema constraints aligned', async () => {
    const mcp = await loadMcpSchemas();
    const valid = { scene: 'space cat' };
    const validWithStyle = { scene: 'space cat', style: 'space' };
    const validWithSession = {
      ...valid,
      ageBand: '10-12',
      profileId: 'local-default',
      sessionId: 'kb_session_color123',
    };
    const invalidStyle = { scene: 'space cat', style: 'forest' };
    const tooShortScene = { scene: 'ab' };

    expect(accepts(mcp.coloringOutlineSchema, valid)).toBe(true);
    expect(accepts(coloringRequestSchema, valid)).toBe(true);
    expect(accepts(mcp.coloringOutlineSchema, validWithStyle)).toBe(true);
    expect(accepts(coloringRequestSchema, validWithStyle)).toBe(true);
    expect(accepts(mcp.coloringOutlineSchema, validWithSession)).toBe(true);
    expect(accepts(coloringRequestSchema, validWithSession)).toBe(true);
    expect(accepts(mcp.coloringOutlineSchema, invalidStyle)).toBe(false);
    expect(accepts(coloringRequestSchema, invalidStyle)).toBe(false);
    expect(accepts(mcp.coloringOutlineSchema, tooShortScene)).toBe(false);
    expect(accepts(coloringRequestSchema, tooShortScene)).toBe(false);
  });

  it('keeps science schema constraints aligned', async () => {
    const mcp = await loadMcpSchemas();
    const valid = { topic: 'buoyancy' };
    const validWithSession = {
      ...valid,
      ageBand: '7-9',
      profileId: 'local-default',
      sessionId: 'kb_session_science123',
    };
    const tooShortTopic = { topic: 'ab' };
    const validWithAge = { topic: 'buoyancy', ageBand: '10-12' };
    const invalidAge = { topic: 'buoyancy', ageBand: '13-15' };

    expect(accepts(mcp.scienceSimSchema, valid)).toBe(true);
    expect(accepts(scienceRequestSchema, valid)).toBe(true);
    expect(accepts(mcp.scienceSimSchema, validWithSession)).toBe(true);
    expect(accepts(scienceRequestSchema, validWithSession)).toBe(true);
    expect(accepts(mcp.scienceSimSchema, tooShortTopic)).toBe(false);
    expect(accepts(scienceRequestSchema, tooShortTopic)).toBe(false);
    expect(accepts(mcp.scienceSimSchema, validWithAge)).toBe(true);
    expect(accepts(scienceRequestSchema, validWithAge)).toBe(true);
    expect(accepts(mcp.scienceSimSchema, invalidAge)).toBe(false);
    expect(accepts(scienceRequestSchema, invalidAge)).toBe(false);
  });

  it('keeps widget tool ids consistent with MCP tool registrations', () => {
    const mcpToolsSource = readFileSync(path.join(repoRoot, 'apps/mcp-server/src/tools.ts'), 'utf-8');
    const widgetSources = [
      readFileSync(path.join(repoRoot, 'apps/web-widget/src/components/VoiceBar.tsx'), 'utf-8'),
      readFileSync(path.join(repoRoot, 'apps/web-widget/src/components/ComicBoard.tsx'), 'utf-8'),
      readFileSync(path.join(repoRoot, 'apps/web-widget/src/components/ColoringBook.tsx'), 'utf-8'),
      readFileSync(path.join(repoRoot, 'apps/web-widget/src/components/ScienceLab.tsx'), 'utf-8')
    ].join('\n');

    const mcpToolIds = [...mcpToolsSource.matchAll(/name:\s*'([^']+)'/g)].map((match) => match[1]).sort();
    const widgetToolIds = [...widgetSources.matchAll(/callTool\?\.\('([^']+)'/g)].map((match) => match[1]).sort();

    expect(widgetToolIds).toEqual(['coloring_outline', 'science_sim', 'story_panels', 'voice_chat']);
    expect(mcpToolIds).toEqual(['coloring_outline', 'science_sim', 'story_panels', 'voice_chat']);
    expect(widgetToolIds).toEqual(mcpToolIds);
  });
});
