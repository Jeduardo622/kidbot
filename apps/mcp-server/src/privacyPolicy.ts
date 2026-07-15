const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character] ?? character,
  );

const title = 'Kidbot Privacy Policy';
const lastUpdated = 'July 15, 2026';
const contactUrl = 'https://github.com/Jeduardo622/kidbot/issues';

const sections = [
  {
    title: 'What Kidbot processes',
    paragraphs: [
      'Kidbot processes prompts, selected persona and age band, generated text, story image prompts and images, and optional session and parent-profile metadata needed to provide the requested feature. Parent access tokens and service credentials are used for authorization and are not included in activity history or request-summary logs.',
      'Request-summary logs contain route, status, timing, sizes, safety and provider outcomes, age band, and keyed pseudonymous session or profile references in secured deployments. They do not contain raw session or profile identifiers, prompts, tokens, PINs, generated content, full image URLs, or arbitrary provider error messages. Local fallback logs omit session and profile references.',
    ],
  },
  {
    title: 'Service providers and purposes',
    paragraphs: [
      'OpenAI processes prompts and generated outputs for moderation and AI text or image generation when provider-backed features are enabled.',
      'Railway hosts the Kidbot services and Redis deployment, so it processes requests, operational logs, parent profiles, and consented metadata-only activity history as needed to operate the service.',
      'Supabase Storage stores generated story-panel images when production image storage is configured for Supabase. The image object URL is public while the object exists and may be cached by browsers or networks.',
      'Browser speech recognition may send microphone audio to the browser, operating-system, or speech-service provider chosen by the user agent. Kidbot receives the recognized text, not the raw microphone audio. Browser speech synthesis uses the browser or operating system to play returned text.',
    ],
  },
  {
    title: 'Retention',
    paragraphs: [
      'In production, Kidbot retains an explicitly enabled parent profile and its metadata-only session history for exactly 30 days from activity, subject to the configured history event limit. Production startup fails if a conflicting retention override is supplied. Development and test environments may use explicit shorter values. History does not include prompts, responses, PINs, tokens, or generated artifacts.',
      'In production, generated story images are configured for exactly 24 hours of retention. Production startup fails if a conflicting image-retention override is supplied. Development and test environments may use explicit shorter values. Cleanup of local or Supabase image objects is best effort, and cached copies may remain outside Kidbot after the source object expires.',
      'Kidbot does not set or guarantee each provider’s independent security, backup, abuse-monitoring, or legal retention. Provider terms and the operator’s account settings also apply.',
    ],
  },
  {
    title: 'Deletion and limitations',
    paragraphs: [
      'An authorized parent can use the parent profile deletion control to delete the Kidbot parent profile and its associated session and history records from the active Kidbot store.',
      'That deletion cannot recall data already processed or independently retained by OpenAI, Railway, Supabase, browser or operating-system speech services, backups, or caches. Kidbot does not currently offer an individual generated-image deletion control; image cleanup follows the production 24-hour best-effort retention process.',
    ],
  },
  {
    title: 'Contact',
    paragraphs: [
      `For privacy, deletion, or support requests, open an issue at ${contactUrl}.`,
    ],
  },
] as const;

const closing = 'This operational disclosure describes the current Kidbot implementation. Privacy and legal review is required before public launch.';

export const privacyPolicyMarkdown = [
  `# ${title}`,
  `Last updated: ${lastUpdated}`,
  ...sections.flatMap((section) => [
    `## ${section.title}`,
    ...section.paragraphs,
  ]),
  closing,
].join('\n\n') + '\n';

const renderedSections = sections
  .map(({ title: sectionTitle, paragraphs }) => {
    const renderedParagraphs = paragraphs
      .map((paragraph) => {
        if (sectionTitle === 'Contact') {
          const contactIndex = paragraph.indexOf(contactUrl);
          const prefix = paragraph.slice(0, contactIndex);
          const suffix = paragraph.slice(contactIndex + contactUrl.length);
          return `<p>${escapeHtml(prefix)}<a href="${escapeHtml(contactUrl)}" rel="noreferrer">${escapeHtml(contactUrl)}</a>${escapeHtml(suffix)}</p>`;
        }
        return `<p>${escapeHtml(paragraph)}</p>`;
      })
      .join('');
    return `<section><h2>${escapeHtml(sectionTitle)}</h2>${renderedParagraphs}</section>`;
  })
  .join('');

export const privacyPolicyHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${escapeHtml(title)}</title><style>body{font-family:system-ui,sans-serif;line-height:1.55;margin:0 auto;max-width:760px;padding:32px 20px;color:#172033}h1,h2{line-height:1.2}a{color:#075dad}</style></head><body><main><h1>${escapeHtml(title)}</h1><p>Last updated: ${escapeHtml(lastUpdated)}</p>${renderedSections}<p>${escapeHtml(closing)}</p></main></body></html>`;
