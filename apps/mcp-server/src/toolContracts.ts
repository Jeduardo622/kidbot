import { registerAppTool, type ToolCallback } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import {
  ageBandSchema,
  generationResultMetadataShape,
  parentHistoryEventSchema,
  personaSchema,
} from './schema.js';
import { widgetResourceUri } from './widgetMetadata.js';

const noAuth = [{ type: 'noauth' as const }];

export const createToolMeta = () => ({
  securitySchemes: noAuth,
  ui: { resourceUri: widgetResourceUri, visibility: ['model', 'app'] as const },
  'openai/outputTemplate': widgetResourceUri,
  'openai/widgetAccessible': true,
});

const blockedFailureSchema = z
  .object({
    blocked: z.literal(true),
    message: z.string(),
  })
  .strict();

const degradedFailureSchema = z
  .object({
    blocked: z.literal(false),
    degraded: z.literal(true),
    message: z.string(),
    fallbackReason: z.string().optional(),
    correlationId: z.string().optional(),
  })
  .strict();

const requestControlFailureSchema = z
  .object({
    error: z.literal(true),
    code: z.enum(['rate_limited', 'concurrency_limited', 'request_timeout']),
    retryAfter: z.number().int().positive().optional(),
  })
  .strict();

export const commonFailureSchema = z.union([
  blockedFailureSchema,
  degradedFailureSchema,
  requestControlFailureSchema,
]);

export const voiceSuccessSchema = z
  .object({
    blocked: z.literal(false),
    persona: personaSchema,
    text: z.string(),
    ssml: z.string().optional(),
    message: z.string().optional(),
    ...generationResultMetadataShape,
  })
  .strict();

export const storyPanelsSuccessSchema = z
  .object({
    blocked: z.literal(false),
    theme: z.string(),
    panels: z.array(
      z
        .object({
          title: z.string(),
          caption: z.string(),
          imagePrompt: z.string(),
          imageUrl: z.string().nullable(),
        })
        .strict(),
    ),
    message: z.string().optional(),
    ...generationResultMetadataShape,
  })
  .strict();

export const coloringOutlineSuccessSchema = z
  .object({
    blocked: z.literal(false),
    svg: z.string(),
    message: z.string().optional(),
    ...generationResultMetadataShape,
  })
  .strict();

export const scienceSimSuccessSchema = z
  .object({
    blocked: z.literal(false),
    title: z.string(),
    objective: z.string(),
    materials: z.array(z.string()),
    steps: z.array(z.string()),
    prediction: z
      .object({
        question: z.string(),
        choices: z.array(z.string()),
        answerIndex: z.number().int().nonnegative(),
      })
      .strict(),
    explanation: z.string(),
    supervision: z.string(),
    topic: z.string(),
    message: z.string().optional(),
    ...generationResultMetadataShape,
  })
  .strict();

const parentProfileShape = {
  profileId: z.string(),
  ageBand: ageBandSchema,
  historyEnabled: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
};

export const parentProfileCreateSuccessSchema = z
  .object({
    ...parentProfileShape,
    parentAccessToken: z.string().optional(),
  })
  .strict();

export const parentProfileUpdateSuccessSchema = z.object(parentProfileShape).strict();

export const parentHistoryListSuccessSchema = z
  .object({
    events: z.array(parentHistoryEventSchema),
  })
  .strict();

const outputUnion = <Success extends z.ZodTypeAny>(successSchema: Success) =>
  z.union([successSchema, commonFailureSchema]);

export const voiceToolOutputUnion = outputUnion(voiceSuccessSchema);
export const storyPanelsToolOutputUnion = outputUnion(storyPanelsSuccessSchema);
export const coloringOutlineToolOutputUnion = outputUnion(coloringOutlineSuccessSchema);
export const scienceSimToolOutputUnion = outputUnion(scienceSimSuccessSchema);
export const parentProfileCreateToolOutputUnion = outputUnion(parentProfileCreateSuccessSchema);
export const parentProfileUpdateToolOutputUnion = outputUnion(parentProfileUpdateSuccessSchema);
export const parentHistoryListToolOutputUnion = outputUnion(parentHistoryListSuccessSchema);

const advertisedFailureShape = {
  blocked: z.boolean().optional(),
  message: z.string().optional(),
  degraded: z.literal(true).optional(),
  fallbackReason: z.string().optional(),
  correlationId: z.string().optional(),
  error: z.literal(true).optional(),
  code: z.enum(['rate_limited', 'concurrency_limited', 'request_timeout']).optional(),
  retryAfter: z.number().int().positive().optional(),
};

const advertiseObjectUnion = <Shape extends z.ZodRawShape>(successShape: Shape) => {
  const optionalSuccessShape = Object.fromEntries(
    Object.entries(successShape).map(([key, schema]) => [key, schema.optional()]),
  ) as { [Key in keyof Shape]: z.ZodOptional<Shape[Key]> };
  return z
    .object({
      ...optionalSuccessShape,
      ...advertisedFailureShape,
    })
    .strict();
};

export const voiceToolOutputSchema = advertiseObjectUnion(voiceSuccessSchema.shape);
export const storyPanelsToolOutputSchema = advertiseObjectUnion(storyPanelsSuccessSchema.shape);
export const coloringOutlineToolOutputSchema = advertiseObjectUnion(
  coloringOutlineSuccessSchema.shape,
);
export const scienceSimToolOutputSchema = advertiseObjectUnion(scienceSimSuccessSchema.shape);
export const parentProfileCreateToolOutputSchema = advertiseObjectUnion(
  parentProfileCreateSuccessSchema.shape,
);
export const parentProfileUpdateToolOutputSchema = advertiseObjectUnion(
  parentProfileUpdateSuccessSchema.shape,
);
export const parentHistoryListToolOutputSchema = advertiseObjectUnion(
  parentHistoryListSuccessSchema.shape,
);

type RequestHandler = (request: unknown, extra: unknown) => unknown | Promise<unknown>;
type ToolListResult = { tools: Array<Record<string, unknown>>; nextCursor?: string };
type JsonSchema = {
  type?: string;
  properties?: Record<string, JsonSchema>;
  [key: string]: unknown;
};

const toolSuccessSchemas = new WeakMap<McpServer, Map<string, z.AnyZodObject>>();

const exactAdvertisedOutputSchema = (schema: JsonSchema, successSchema: z.AnyZodObject) => {
  const properties = schema.properties ?? {};
  const pickProperties = (keys: string[]) =>
    Object.fromEntries(keys.flatMap((key) => (properties[key] ? [[key, properties[key]]] : [])));
  const variant = (
    keys: string[],
    required: string[],
    overrides: Record<string, JsonSchema> = {},
  ) => ({
    type: 'object' as const,
    properties: { ...pickProperties(keys), ...overrides },
    required,
    additionalProperties: false,
  });
  const successEntries = Object.entries(successSchema.shape) as Array<[string, z.ZodTypeAny]>;
  const successKeys = successEntries.map(([key]) => key);
  const successRequired = successEntries
    .filter(([, field]) => !field.isOptional())
    .map(([key]) => key);
  const successOverrides: Record<string, JsonSchema> = successKeys.includes('blocked')
    ? { blocked: { type: 'boolean', const: false } }
    : {};

  return {
    $schema: schema.$schema,
    type: 'object' as const,
    anyOf: [
      variant(successKeys, successRequired, successOverrides),
      variant(['blocked', 'message'], ['blocked', 'message'], {
        blocked: { type: 'boolean', const: true },
      }),
      variant(
        ['blocked', 'degraded', 'message', 'fallbackReason', 'correlationId'],
        ['blocked', 'degraded', 'message'],
        {
          blocked: { type: 'boolean', const: false },
          degraded: { type: 'boolean', const: true },
        },
      ),
      variant(['error', 'code', 'retryAfter'], ['error', 'code'], {
        error: { type: 'boolean', const: true },
      }),
    ],
  };
};

const decorateToolListSecuritySchemes = (server: McpServer) => {
  const protocol = server.server as unknown as {
    _requestHandlers: Map<string, RequestHandler>;
  };
  const originalHandler = protocol._requestHandlers.get('tools/list');
  if (
    !originalHandler ||
    (originalHandler as RequestHandler & { kidbotSecurityDecorated?: boolean })
      .kidbotSecurityDecorated
  ) {
    return;
  }
  const decoratedHandler = async (request: unknown, extra: unknown): Promise<ToolListResult> => {
    const result = (await originalHandler(request, extra)) as ToolListResult;
    const successSchemas = toolSuccessSchemas.get(server);
    return {
      ...result,
      tools: result.tools.map((tool) => {
        const name = typeof tool.name === 'string' ? tool.name : '';
        const successSchema = successSchemas?.get(name);
        const outputSchema = tool.outputSchema as JsonSchema | undefined;
        return {
          ...tool,
          securitySchemes: noAuth,
          ...(successSchema && outputSchema
            ? { outputSchema: exactAdvertisedOutputSchema(outputSchema, successSchema) }
            : {}),
        };
      }),
    };
  };
  (
    decoratedHandler as RequestHandler & { kidbotSecurityDecorated?: boolean }
  ).kidbotSecurityDecorated = true;
  protocol._requestHandlers.set('tools/list', decoratedHandler);
};

export interface KidbotToolConfig {
  title: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  outputSchema: z.ZodTypeAny;
  resultSchema: z.ZodTypeAny;
  successSchema: z.AnyZodObject;
  annotations: Required<
    Pick<ToolAnnotations, 'readOnlyHint' | 'destructiveHint' | 'openWorldHint'>
  >;
}

export const registerKidbotTool = (
  server: McpServer,
  name: string,
  config: KidbotToolConfig,
  callback: ToolCallback<z.ZodTypeAny>,
) => {
  const { resultSchema, successSchema, ...descriptor } = config;
  const successSchemas = toolSuccessSchemas.get(server) ?? new Map<string, z.AnyZodObject>();
  successSchemas.set(name, successSchema);
  toolSuccessSchemas.set(server, successSchemas);
  const registered = registerAppTool(
    server,
    name,
    {
      ...descriptor,
      _meta: createToolMeta(),
    },
    async (...args) => {
      const result = await callback(...args);
      if (result.structuredContent) {
        resultSchema.parse(result.structuredContent);
      }
      return result;
    },
  );
  decorateToolListSecuritySchemes(server);
  return registered;
};
