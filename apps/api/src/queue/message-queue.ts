// message-queue.ts — Configura fila BullMQ de processamento de mensagens
import { Queue, type Job } from 'bullmq'
import type { WebhookPayload } from '../orchestrator'
import { redisConnection } from './redis'

export const messageQueue = new Queue<WebhookPayload>('message-processing', {
  connection: redisConnection,
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 500,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000
    }
  }
})

/**
 * Enfileira uma mensagem recebida por webhook.
 * @param payload Payload validado do webhook.
 * @returns Job criado no BullMQ.
 */
export async function enqueueMessage(payload: WebhookPayload): Promise<Job<WebhookPayload>> {
  return messageQueue.add('process-message', payload)
}
