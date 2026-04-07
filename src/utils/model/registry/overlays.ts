import {
  CLAUDE_3_5_HAIKU_CONFIG,
  CLAUDE_3_5_V2_SONNET_CONFIG,
  CLAUDE_3_7_SONNET_CONFIG,
  CLAUDE_HAIKU_4_5_CONFIG,
  CLAUDE_OPUS_4_1_CONFIG,
  CLAUDE_OPUS_4_5_CONFIG,
  CLAUDE_OPUS_4_6_CONFIG,
  CLAUDE_OPUS_4_CONFIG,
  CLAUDE_SONNET_4_5_CONFIG,
  CLAUDE_SONNET_4_6_CONFIG,
  CLAUDE_SONNET_4_CONFIG,
} from '../configs.js'
import type { ProviderDescriptorOverlay } from './types.js'

type CloudModelConfig = {
  bedrock: string
  vertex: string
  foundry: string
}

function createProviderOverlays(
  canonicalId: string,
  config: CloudModelConfig,
  capabilityOverride: Partial<
    Record<'bedrock' | 'vertex' | 'foundry', ProviderDescriptorOverlay['capabilityOverride']>
  > = {},
): ProviderDescriptorOverlay[] {
  return [
    {
      provider: 'bedrock',
      canonicalId,
      modelId: config.bedrock,
      providerPolicy: { authMode: 'cloud' },
      capabilityOverride: capabilityOverride.bedrock,
    },
    {
      provider: 'vertex',
      canonicalId,
      modelId: config.vertex,
      providerPolicy: { authMode: 'cloud' },
      capabilityOverride: capabilityOverride.vertex,
    },
    {
      provider: 'foundry',
      canonicalId,
      modelId: config.foundry,
      providerPolicy: { authMode: 'cloud' },
      capabilityOverride: capabilityOverride.foundry,
    },
  ]
}

const NO_3P_HAIKU_THINKING = {
  thinking: {
    supported: false,
    mode: 'none' as const,
    adaptive: false,
    defaultEnabled: false,
  },
}

export const PROVIDER_DESCRIPTOR_OVERLAYS: ProviderDescriptorOverlay[] = [
  ...createProviderOverlays('claude-3-5-haiku', CLAUDE_3_5_HAIKU_CONFIG),
  ...createProviderOverlays('claude-haiku-4-5', CLAUDE_HAIKU_4_5_CONFIG, {
    bedrock: NO_3P_HAIKU_THINKING,
    vertex: NO_3P_HAIKU_THINKING,
  }),
  ...createProviderOverlays('claude-3-5-sonnet', CLAUDE_3_5_V2_SONNET_CONFIG),
  ...createProviderOverlays('claude-3-7-sonnet', CLAUDE_3_7_SONNET_CONFIG),
  ...createProviderOverlays('claude-sonnet-4', CLAUDE_SONNET_4_CONFIG),
  ...createProviderOverlays('claude-sonnet-4-5', CLAUDE_SONNET_4_5_CONFIG),
  ...createProviderOverlays('claude-sonnet-4-6', CLAUDE_SONNET_4_6_CONFIG),
  ...createProviderOverlays('claude-opus-4', CLAUDE_OPUS_4_CONFIG),
  ...createProviderOverlays('claude-opus-4-1', CLAUDE_OPUS_4_1_CONFIG),
  ...createProviderOverlays('claude-opus-4-5', CLAUDE_OPUS_4_5_CONFIG),
  ...createProviderOverlays('claude-opus-4-6', CLAUDE_OPUS_4_6_CONFIG),
]
