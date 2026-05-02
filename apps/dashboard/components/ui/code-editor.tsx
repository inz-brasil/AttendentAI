'use client'
// code-editor.tsx — Wrapper React do CodeMirror 6 com tema dark operacional
import { useEffect, useRef, useCallback } from 'react'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { yaml } from '@codemirror/lang-yaml'
import { oneDark } from '@codemirror/theme-one-dark'
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from '@codemirror/language'

type CodeLang = 'markdown' | 'yaml'

interface CodeEditorProps {
  value: string
  onChange: (value: string) => void
  lang?: CodeLang
  minHeight?: number
  placeholder?: string
  readOnly?: boolean
}

/** Tema personalizado para o canvas dark do AttendentAI */
const attaiTheme = EditorView.theme({
  '&': {
    fontSize: '12.5px',
    fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
    background: '#08090a',
    color: '#e2e8f0'
  },
  '.cm-content': { padding: '12px 0', caretColor: '#f7ff6a' },
  '.cm-scroller': { fontFamily: 'inherit' },
  '.cm-cursor': { borderLeftColor: '#f7ff6a', borderLeftWidth: '2px' },
  '.cm-gutters': { background: '#0e1012', borderRight: '1px solid #1e2226', color: '#454f58' },
  '.cm-activeLineGutter': { background: '#13171a' },
  '.cm-activeLine': { background: 'rgba(247,255,106,0.04)' },
  '.cm-selectionBackground': { background: 'rgba(247,255,106,0.12)' },
  '&.cm-focused .cm-selectionBackground': { background: 'rgba(247,255,106,0.15)' },
  '.cm-matchingBracket': { color: '#79e2ff', outline: '1px solid #79e2ff40' },
  '.cm-placeholder': { color: '#454f58' }
}, { dark: true })

/**
 * Editor de código CodeMirror 6 com tema dark do AttendentAI.
 * @param props Valor, callback onChange, linguagem e opções visuais.
 * @returns Editor controlado.
 */
export function CodeEditor({
  value,
  onChange,
  lang = 'markdown',
  minHeight = 400,
  placeholder: _placeholder,
  readOnly = false
}: CodeEditorProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  // Usamos ref para o callback para evitar recriar o editor ao mudar o handler
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const setup = useCallback(() => {
    if (!containerRef.current) return

    const langExt = lang === 'yaml' ? yaml() : markdown()

    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        langExt,
        oneDark,
        attaiTheme,
        syntaxHighlighting(defaultHighlightStyle),
        bracketMatching(),
        EditorView.lineWrapping,
        EditorView.editable.of(!readOnly),
        EditorView.updateListener.of(update => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString())
          }
        }),
        EditorView.theme({ '&': { minHeight: `${minHeight}px` } })
      ]
    })

    viewRef.current = new EditorView({ state, parent: containerRef.current })
  }, [lang, minHeight, readOnly]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setup()
    return () => {
      viewRef.current?.destroy()
      viewRef.current = null
    }
  }, [setup])

  // Sincroniza valor externo sem recriar o editor
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current !== value) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value }
      })
    }
  }, [value])

  return (
    <div
      ref={containerRef}
      className="overflow-hidden rounded-lg border border-line focus-within:border-cyan/60 transition"
      style={{ minHeight: `${minHeight}px` }}
    />
  )
}
