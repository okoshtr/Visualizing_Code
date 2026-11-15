// Code panel based on CodeMirror 6.

import { EditorState, Compartment, type Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { HighlightStyle, StreamLanguage, syntaxHighlighting, indentUnit, bracketMatching } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { python } from '@codemirror/lang-python';
import { java } from '@codemirror/lang-java';
import { javascript } from '@codemirror/lang-javascript';
import { cpp } from '@codemirror/lang-cpp';
import { csharp } from '@codemirror/legacy-modes/mode/clike';
import { vb } from '@codemirror/legacy-modes/mode/vb';
import type { Lang } from '../core/ir';

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.definitionKeyword, t.moduleKeyword], color: 'var(--tok-kw)', fontWeight: '600' },
  { tag: [t.string, t.special(t.string)], color: 'var(--tok-str)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--tok-num)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--tok-com)', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--tok-fn)' },
  { tag: [t.typeName, t.className, t.namespace], color: 'var(--tok-type)' },
  { tag: [t.meta, t.processingInstruction], color: 'var(--tok-com)' },
]);

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '13px', backgroundColor: 'var(--code-bg)', color: 'var(--fg)' },
  '.cm-scroller': { fontFamily: 'var(--font-code)', lineHeight: '1.55' },
  '.cm-gutters': { backgroundColor: 'var(--code-bg)', color: 'var(--muted)', border: 'none' },
  '.cm-activeLine': { backgroundColor: 'var(--code-active)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--code-active)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor': { borderLeftColor: 'var(--fg)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'var(--code-sel) !important' },
});

function language(lang: Lang): Extension {
  switch (lang) {
    case 'python':
      return python();
    case 'java':
      return java();
    case 'javascript':
      return javascript();
    case 'cpp':
      return cpp();
    case 'csharp':
      return StreamLanguage.define(csharp);
    case 'vba':
      return StreamLanguage.define(vb);
  }
}

export class CodeView {
  view: EditorView;
  private lang = new Compartment();
  private indent = new Compartment();
  private settingText = false;

  constructor(
    parent: HTMLElement,
    private onUserEdit: (text: string) => void,
  ) {
    this.view = new EditorView({
      parent,
      state: EditorState.create({
        doc: '',
        extensions: [
          lineNumbers(),
          history(),
          drawSelection(),
          highlightActiveLine(),
          bracketMatching(),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          syntaxHighlighting(highlight),
          theme,
          this.lang.of(python()),
          this.indent.of(indentUnit.of('    ')),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ 'aria-label': 'Programmcode', spellcheck: 'false' }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !this.settingText) this.onUserEdit(u.state.doc.toString());
          }),
        ],
      }),
    });
  }

  setLanguage(lang: Lang) {
    this.view.dispatch({
      effects: [this.lang.reconfigure(language(lang)), this.indent.reconfigure(indentUnit.of(lang === 'javascript' ? '  ' : '    '))],
    });
  }

  get text(): string {
    return this.view.state.doc.toString();
  }

  set text(value: string) {
    if (value === this.text) return;
    this.settingText = true;
    try {
      this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: value } });
    } finally {
      this.settingText = false;
    }
  }
}
