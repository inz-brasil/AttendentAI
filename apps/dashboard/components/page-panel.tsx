// page-panel.tsx — Componentes base para páginas do dashboard
/**
 * Renderiza uma página operacional padrão.
 * @param props Conteúdo textual da página.
 * @returns Página base.
 */
export function PagePanel(props: {
  title: string
  eyebrow: string
  description: string
  children?: React.ReactNode
}): JSX.Element {
  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="font-mono text-xs uppercase tracking-[0.22em] text-accent">{props.eyebrow}</div>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-ink">{props.title}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">{props.description}</p>
        </div>
      </div>
      {props.children ?? <div className="rounded-lg bg-panel p-6 text-sm text-muted shadow-panel">Módulo pronto para integração.</div>}
    </section>
  )
}
