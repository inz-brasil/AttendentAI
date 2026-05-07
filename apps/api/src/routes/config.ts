// config.ts — Expõe APIs de configuração editáveis em tempo real para o dashboard
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { writeBusinessProfileVault } from '../config/business-vault'
import { configDefinitions, getConfigSection, type ConfigSection, updateConfigSection } from '../config/dashboard-config'

const sectionNames = Object.keys(configDefinitions) as Array<keyof typeof configDefinitions>
const configBodySchema = z.record(z.unknown())

/**
 * Registra endpoints /api/config/*.
 * @param app Instância Fastify.
 * @returns Nada.
 */
export async function registerConfigRoutes(app: FastifyInstance): Promise<void> {
  for (const section of sectionNames) {
    app.get(`/api/config/${section}`, async () => ({
      section,
      config: withSectionStatus(section, await getConfigSection(section))
    }))

    app.put(`/api/config/${section}`, async (request) => {
      const body = configBodySchema.parse(request.body ?? {})
      const config = await updateConfigSection(section, body)
      if (section === 'business') {
        await writeBusinessProfileVault(config)
      }

      return {
        section,
        config: withSectionStatus(section, config)
      }
    })
  }
}

function withSectionStatus(section: keyof typeof configDefinitions, config: ConfigSection): ConfigSection {
  if (section !== 'evolution') {
    return config
  }

  return {
    ...config,
    status: {
      configured: Boolean(config.instance && config.api_url && config.api_key),
      has_instance: Boolean(config.instance),
      has_api_url: Boolean(config.api_url),
      has_local_url: Boolean(config.local_url),
      has_api_key: Boolean(config.api_key)
    }
  }
}
