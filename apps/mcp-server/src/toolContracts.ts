import { registerAppTool, type ToolCallback } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ListToolsRequestSchema, type ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  ageBandSchema,
  generationResultMetadataShape,
  parentHistoryEventSchema,
  personaSchema,
} from './schema.js';
import { widgetResourceUri } from './widgetMetadata.js';

const noAuth = [{ type: 'noauth' as const }];

export const createToolMeta = (appOnly = false) => ({
  securitySchemes: noAuth,
  ui: { resourceUri: widgetResourceUri, visibility: appOnly ? ['app'] as const : ['model', 'app'] as const },
  ...(appOnly ? { 'openai/visibility': 'private' as const } : {}),
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

type JsonSchema = {
  type?: string;
  properties?: Record<string, JsonSchema>;
  [key: string]: unknown;
};

interface ToolDescriptorState {
  name: string;
  registered: RegisteredTool;
  successSchema?: z.AnyZodObject;
}

const toolDescriptors = new WeakMap<McpServer, Map<string, ToolDescriptorState>>();

const toJsonSchema = (schema: z.ZodTypeAny): JsonSchema =>
  zodToJsonSchema(schema, {
    $refStrategy: 'none',
    strictUnions: true,
    target: 'jsonSchema7',
  }) as JsonSchema;

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

const installToolListHandler = (server: McpServer) => {
  server.server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...(toolDescriptors.get(server)?.values() ?? [])]
      .filter(({ registered }) => registered.enabled)
      .map(({ name, registered, successSchema }) => {
        const outputSchema = registered.outputSchema
          ? toJsonSchema(registered.outputSchema as z.ZodTypeAny)
          : undefined;
        return {
          name,
          title: registered.title,
          description: registered.description,
          inputSchema: registered.inputSchema
            ? toJsonSchema(registered.inputSchema as z.ZodTypeAny)
            : { type: 'object' as const, properties: {} },
          ...(outputSchema
            ? {
                outputSchema: successSchema
                  ? exactAdvertisedOutputSchema(outputSchema, successSchema)
                  : outputSchema,
              }
            : {}),
          annotations: registered.annotations,
          securitySchemes: noAuth,
          _meta: { ...registered._meta, securitySchemes: noAuth },
        };
      }),
  }));
};

export interface KidbotToolConfig {
  title: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  outputSchema: z.ZodTypeAny;
  resultSchema: z.ZodTypeAny;
  successSchema: z.AnyZodObject;
  annotations: Required<
    Pick<ToolAnnotations, 'readOnlyHint' | 'destructiveHint' | 'openWorldHint' | 'idempotentHint'>
  >;
  appOnly?: boolean;
}

export const registerKidbotTool = (
  server: McpServer,
  name: string,
  config: KidbotToolConfig,
  callback: ToolCallback<z.ZodTypeAny>,
) => {
  const { resultSchema, successSchema, ...descriptor } = config;
  const validateCallback =
    (toolCallback: ToolCallback<z.ZodTypeAny>) =>
    async (...args: Parameters<ToolCallback<z.ZodTypeAny>>) => {
      const result = await toolCallback(...args);
      if (result.structuredContent) {
        resultSchema.parse(result.structuredContent);
      }
      return result;
    };
  const registered = registerAppTool(
    server,
    name,
    {
      ...descriptor,
      _meta: createToolMeta(config.appOnly === true),
    },
    validateCallback(callback),
  );
  const descriptors = toolDescriptors.get(server) ?? new Map<string, ToolDescriptorState>();
  const state: ToolDescriptorState = { name, registered, successSchema };
  descriptors.set(name, state);
  toolDescriptors.set(server, descriptors);

  const originalUpdate = registered.update.bind(registered);
  const applyUpdate = originalUpdate as unknown as (updates: Record<string, unknown>) => void;
  registered.update = ((updates) => {
    const allowedFields = new Set(['title', 'description', 'enabled', 'callback']);
    const contractField = Object.keys(updates).find((field) => !allowedFields.has(field));
    if (contractField) {
      throw new Error(
        `Tool ${state.name} contract-bearing update is not allowed: ${contractField}`,
      );
    }
    const normalizedUpdates = updates.callback
      ? { ...updates, callback: validateCallback(updates.callback as ToolCallback<z.ZodTypeAny>) }
      : updates;
    applyUpdate(normalizedUpdates as unknown as Record<string, unknown>);
  }) as RegisteredTool['update'];
  registered.remove = () => {
    applyUpdate({ name: null });
    descriptors.delete(state.name);
  };

  installToolListHandler(server);
  return registered;
};
