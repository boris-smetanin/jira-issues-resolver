import { z } from 'zod';
import { AGENT_PROVIDERS } from '../../integrations/agent-providers/registry.js';

const providerIds = Object.keys(AGENT_PROVIDERS) as Array<keyof typeof AGENT_PROVIDERS>;

// Loose dto — provider-specific key shape is applied in the service, where
// the registry is the source of truth. Keeping the dto simple means adding
// a new provider doesn't require touching this file.
export const createAgentAccountDto = z.object({
  provider: z.enum(providerIds as [string, ...string[]]),
  name: z.string().trim().min(1),
  apiKey: z.string().trim().min(1),
});

export type CreateAgentAccountDto = z.infer<typeof createAgentAccountDto>;

export const updateAgentAccountDto = z.object({
  name: z.string().trim().min(1).optional(),
  apiKey: z.string().trim().min(1).optional(),
});

export type UpdateAgentAccountDto = z.infer<typeof updateAgentAccountDto>;
