// task-manager.ts — Gerencia lista de tarefas do operador no vault global
import { z } from 'zod'
import { env } from '../config/env'
import { VaultManager } from '../vault-manager/manager'

const TASKS_FILE = 'tarefas.md'

const taskManagerInputSchema = z.object({
  action: z.enum(['list', 'add', 'complete', 'remove', 'clear_done']),
  task: z.string().optional(),
  task_index: z.number().int().min(1).optional()
})

export type TaskManagerInput = z.infer<typeof taskManagerInputSchema>

export interface TaskManagerResult {
  success: boolean
  tasks?: Array<{ index: number; text: string; done: boolean }>
  message?: string
}

/** Executa ação na lista de tarefas do vault global. */
export async function executeTaskManagerTool(rawInput: unknown): Promise<TaskManagerResult> {
  const input = taskManagerInputSchema.parse(rawInput)
  const vault = new VaultManager(env.VAULT_PATH)
  const raw = await vault.readGlobal(TASKS_FILE)

  switch (input.action) {
    case 'list': {
      const tasks = parseTasks(raw)
      return {
        success: true,
        tasks,
        message: tasks.length === 0 ? 'Nenhuma tarefa cadastrada.' : `${tasks.filter(t => !t.done).length} pendente(s), ${tasks.filter(t => t.done).length} concluída(s).`
      }
    }
    case 'add': {
      if (!input.task) throw new Error('task é obrigatório para add')
      const updated = addTask(raw, input.task.trim())
      await vault.writeGlobal(TASKS_FILE, updated)
      return { success: true, message: `Tarefa adicionada: "${input.task.trim()}"` }
    }
    case 'complete': {
      if (!input.task_index) throw new Error('task_index é obrigatório para complete')
      const { content, task } = toggleTask(raw, input.task_index, true)
      await vault.writeGlobal(TASKS_FILE, content)
      return { success: true, message: task ? `Concluída: "${task}"` : 'Tarefa não encontrada.' }
    }
    case 'remove': {
      if (!input.task_index) throw new Error('task_index é obrigatório para remove')
      const { content, task } = removeTask(raw, input.task_index)
      await vault.writeGlobal(TASKS_FILE, content)
      return { success: true, message: task ? `Removida: "${task}"` : 'Tarefa não encontrada.' }
    }
    case 'clear_done': {
      const cleaned = clearDone(raw)
      await vault.writeGlobal(TASKS_FILE, cleaned)
      return { success: true, message: 'Tarefas concluídas removidas.' }
    }
  }
}

function parseTasks(raw: string): Array<{ index: number; text: string; done: boolean }> {
  const lines = raw.split('\n')
  const tasks: Array<{ index: number; text: string; done: boolean }> = []
  let index = 0
  for (const line of lines) {
    const doneMatch = line.match(/^- \[x\] (.+)$/i)
    const pendingMatch = line.match(/^- \[ \] (.+)$/)
    if (doneMatch) {
      index++
      tasks.push({ index, text: doneMatch[1], done: true })
    } else if (pendingMatch) {
      index++
      tasks.push({ index, text: pendingMatch[1], done: false })
    }
  }
  return tasks
}

function addTask(raw: string, task: string): string {
  if (!raw.includes('## Pendentes')) {
    return `## Pendentes\n- [ ] ${task}\n\n## Concluídas\n`
  }
  return raw.replace('## Pendentes\n', `## Pendentes\n- [ ] ${task}\n`)
}

function toggleTask(raw: string, targetIndex: number, done: boolean): { content: string; task: string | null } {
  const lines = raw.split('\n')
  let index = 0
  let found: string | null = null
  const updated = lines.map(line => {
    const doneMatch = line.match(/^- \[x\] (.+)$/i)
    const pendingMatch = line.match(/^- \[ \] (.+)$/)
    if (doneMatch || pendingMatch) {
      index++
      if (index === targetIndex) {
        const text = (doneMatch ?? pendingMatch)![1]
        found = text
        return done ? `- [x] ${text}` : `- [ ] ${text}`
      }
    }
    return line
  })
  return { content: updated.join('\n'), task: found }
}

function removeTask(raw: string, targetIndex: number): { content: string; task: string | null } {
  const lines = raw.split('\n')
  let index = 0
  let found: string | null = null
  const updated = lines.filter(line => {
    const doneMatch = line.match(/^- \[x\] (.+)$/i)
    const pendingMatch = line.match(/^- \[ \] (.+)$/)
    if (doneMatch || pendingMatch) {
      index++
      if (index === targetIndex) {
        found = (doneMatch ?? pendingMatch)![1]
        return false
      }
    }
    return true
  })
  return { content: updated.join('\n'), task: found }
}

function clearDone(raw: string): string {
  return raw
    .split('\n')
    .filter(line => !line.match(/^- \[x\] /i))
    .join('\n')
}
