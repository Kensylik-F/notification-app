import type { Channel } from './api';
import { SERVICE_TEMPLATES } from './generated/templates';

export interface TemplateVariable {
  name: string;
  /** The renderer is strict: a missing required variable fails the send. */
  required: boolean;
}

/** One template key as the service ships it. */
export interface TemplateDescriptor {
  key: string;
  /** Channel → languages the template renders in for that channel. */
  channels: Partial<Record<Channel, string[]>>;
  variables: TemplateVariable[];
  /** Has no per-recipient content, so it can be published as an announcement. */
  announcement: boolean;
  /** Filled by the service's own digest job; not for manual sends. */
  digest: boolean;
}

export { SERVICE_TEMPLATES };

/** The order channels are offered in, everywhere. */
export const CHANNEL_ORDER: readonly Channel[] = [
  'EMAIL',
  'IN_APP',
  'CHAT',
  'WEBHOOK',
];

export function channelsOf(template: TemplateDescriptor): Channel[] {
  return CHANNEL_ORDER.filter(
    channel => (template.channels[channel]?.length ?? 0) > 0
  );
}

export function missingVariables(
  template: TemplateDescriptor,
  values: Readonly<Record<string, string>>
): string[] {
  return template.variables
    .filter(v => v.required && !(values[v.name] ?? '').trim())
    .map(v => v.name);
}

/** Only non-empty values are sent: the renderer treats an absent optional
 *  variable correctly, an empty string it would print. */
export function toVariables(
  values: Readonly<Record<string, string>>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(values)) {
    if (value.trim() !== '') out[name] = value.trim();
  }
  return out;
}
