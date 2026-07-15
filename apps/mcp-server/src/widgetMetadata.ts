import type { McpServerConfig } from './config.js';
import type { Mode } from './types.js';

export const widgetResourceUri = 'ui://widget/kidbot-v2.html';

export const createWidgetResourceMeta = (config: McpServerConfig, mode: Mode) => ({
  ui: {
    prefersBorder: true,
    domain: config.widgetDomain,
    csp: { connectDomains: [], resourceDomains: config.widgetResourceDomains },
  },
  'openai/widgetDescription': 'Kidbot — safe creative play: voice, comics, coloring, science.',
  'openai/widgetPrefersBorder': true,
  'openai/widgetDomain': config.widgetDomain,
  'openai/widgetCSP': {
    connect_domains: [],
    resource_domains: config.widgetResourceDomains,
  },
  mode,
});
