// Blockly blocks, theme and toolbox (German, Scratch-like look).

import * as Blockly from 'blockly/core';
import 'blockly/blocks';
import * as De from 'blockly/msg/de';
import { FieldMultilineInput } from '@blockly/field-multilineinput';
import { LIBRARIES, type LibFn, findLibFn, isExternalLib, externalModule } from '../core/library';
import { LANG_INFO, type Lang } from '../core/ir';

// ---------------------------------------------------------------------------
// Colours per category

export const COLORS = {
  event: '#E8A800',
  io: '#8B63E8',
  control: '#F28C1A',
  operator: '#2FAE63',
  text: '#16A2A0',
  variable: '#F2711C',
  list: '#DE4E39',
  library: '#3482D6',
  function: '#E5507A',
  dict: '#B9671E',
  advanced: '#6B7891',
} as const;

function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f)));
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

const style = (c: string, extra: Partial<Blockly.Theme.BlockStyle> = {}): Blockly.Theme.BlockStyle =>
  ({ colourPrimary: c, colourSecondary: shade(c, 0.35), colourTertiary: shade(c, -0.22), hat: '', ...extra }) as any;

/** Literal blocks (numbers, texts) are white "slots" when they sit inside another block. */
const literal = (c: string): Blockly.Theme.BlockStyle => ({ colourPrimary: c, colourSecondary: '#FFFFFF', colourTertiary: shade(c, -0.22), hat: '' }) as any;

const blockStyles: Record<string, Blockly.Theme.BlockStyle> = {
  event_blocks: style(COLORS.event, { hat: 'cap' } as any),
  io_blocks: style(COLORS.io),
  logic_blocks: style(COLORS.control),
  loop_blocks: style(COLORS.control),
  operator_blocks: style(COLORS.operator),
  math_blocks: literal(COLORS.operator),
  text_blocks: literal(COLORS.text),
  textop_blocks: style(COLORS.text),
  variable_blocks: style(COLORS.variable),
  variable_dynamic_blocks: style(COLORS.variable),
  list_blocks: style(COLORS.list),
  library_blocks: style(COLORS.library),
  procedure_blocks: style(COLORS.function),
  advanced_blocks: style(COLORS.advanced),
  dict_blocks: style(COLORS.dict),
};

const categoryStyles: Record<string, { colour: string }> = Object.fromEntries(
  Object.entries({
    event_category: COLORS.event,
    io_category: COLORS.io,
    control_category: COLORS.control,
    operator_category: COLORS.operator,
    text_category: COLORS.text,
    variable_category: COLORS.variable,
    list_category: COLORS.list,
    library_category: COLORS.library,
    function_category: COLORS.function,
    advanced_category: COLORS.advanced,
    dict_category: COLORS.dict,
  }).map(([k, c]) => [k, { colour: c }]),
);

export function makeTheme(dark: boolean): Blockly.Theme {
  return Blockly.Theme.defineTheme(dark ? 'vc-dark' : 'vc-light', {
    name: dark ? 'vc-dark' : 'vc-light',
    base: Blockly.Themes.Zelos,
    blockStyles,
    categoryStyles,
    componentStyles: dark
      ? {
          workspaceBackgroundColour: '#171C26',
          toolboxBackgroundColour: '#1E2431',
          toolboxForegroundColour: '#DCE3F0',
          flyoutBackgroundColour: '#222938',
          flyoutForegroundColour: '#DCE3F0',
          flyoutOpacity: 1,
          scrollbarColour: '#465066',
          scrollbarOpacity: 0.6,
          insertionMarkerColour: '#FFFFFF',
          insertionMarkerOpacity: 0.3,
          selectedGlowColour: '#FFD54A',
          cursorColour: '#FFD54A',
        }
      : {
          workspaceBackgroundColour: '#F7F8FC',
          toolboxBackgroundColour: '#FFFFFF',
          toolboxForegroundColour: '#2B3245',
          flyoutBackgroundColour: '#EEF1F8',
          flyoutForegroundColour: '#2B3245',
          flyoutOpacity: 1,
          scrollbarColour: '#B9C1D4',
          scrollbarOpacity: 0.7,
          insertionMarkerColour: '#000000',
          insertionMarkerOpacity: 0.2,
          selectedGlowColour: '#FFB300',
          cursorColour: '#FFB300',
        },
    fontStyle: { family: '"Nunito", "Segoe UI", "Helvetica Neue", Arial, sans-serif', weight: '700', size: 11 },
    startHats: true,
  });
}

// ---------------------------------------------------------------------------
// Messages

function setMessages() {
  Blockly.setLocale(De as any);
  const M = Blockly.Msg as Record<string, string>;
  Object.assign(M, {
    CONTROLS_REPEAT_TITLE: 'wiederhole %1 mal',
    CONTROLS_REPEAT_INPUT_DO: '',
    CONTROLS_WHILEUNTIL_INPUT_DO: '',
    CONTROLS_FOR_INPUT_DO: '',
    CONTROLS_FOREACH_INPUT_DO: '',
    CONTROLS_IF_MSG_THEN: '',
    CONTROLS_IF_MSG_IF: 'falls',
    CONTROLS_IF_MSG_ELSE: 'sonst',
    CONTROLS_IF_MSG_ELSEIF: 'sonst falls',
    CONTROLS_FOREACH_TITLE: 'für jedes Element %1 in Liste %2',
    CONTROLS_FOR_TITLE: 'zähle %1 von %2 bis %3 Schritt %4',
    CONTROLS_FLOW_STATEMENTS_OPERATOR_BREAK: 'Schleife abbrechen',
    CONTROLS_FLOW_STATEMENTS_OPERATOR_CONTINUE: 'weiter mit nächster Runde',
    MATH_CHANGE_TITLE: 'ändere %1 um %2',
    TEXT_JOIN_TITLE_CREATEWITH: 'verbinde',
    LISTS_CREATE_WITH_INPUT_WITH: 'Liste aus',
    LISTS_CREATE_EMPTY_TITLE: 'leere Liste',
    PROCEDURES_DEFNORETURN_TITLE: 'definiere',
    PROCEDURES_DEFRETURN_TITLE: 'definiere',
    PROCEDURES_DEFNORETURN_PROCEDURE: 'tue_etwas',
    PROCEDURES_DEFRETURN_PROCEDURE: 'berechne',
    PROCEDURES_DEFRETURN_RETURN: 'gib zurück',
    PROCEDURES_BEFORE_PARAMS: 'mit',
    PROCEDURES_CALL_BEFORE_PARAMS: 'mit',
    PROCEDURES_DEFNORETURN_TOOLTIP: 'Eine eigene Funktion ohne Rückgabewert. Klicke auf das Zahnrad, um Parameter hinzuzufügen.',
    PROCEDURES_DEFRETURN_TOOLTIP: 'Eine eigene Funktion, die einen Wert zurückgibt. Klicke auf das Zahnrad, um Parameter hinzuzufügen.',
    NEW_VARIABLE: 'Neue Variable …',
    NEW_VARIABLE_TITLE: 'Name der neuen Variable:',
    LOGIC_TERNARY_CONDITION: 'falls',
    LOGIC_TERNARY_IF_TRUE: 'dann',
    LOGIC_TERNARY_IF_FALSE: 'sonst',
  });
}

// ---------------------------------------------------------------------------
// Icons for fields

const svg = (body: string, w = 24, h = 24) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 24 24">${body}</svg>`)}`;
const PLAY_ICON = svg('<circle cx="12" cy="12" r="11" fill="#2FAE63" stroke="#fff" stroke-width="2"/><path d="M9.5 7.5v9l7-4.5z" fill="#fff"/>');
const PLUS_ICON = svg('<circle cx="12" cy="12" r="10" fill="rgba(255,255,255,0.25)"/><path d="M12 7v10M7 12h10" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>');
const MINUS_ICON = svg('<circle cx="12" cy="12" r="10" fill="rgba(255,255,255,0.25)"/><path d="M7 12h10" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>');

// ---------------------------------------------------------------------------
// Block definitions

const LANG_OPTIONS = (Object.keys(LANG_INFO) as Lang[]).map((l) => [LANG_INFO[l].label, l] as [string, string]);

const JSON_BLOCKS: any[] = [
  {
    type: 'event_start',
    message0: 'Wenn %1 Programm startet',
    args0: [{ type: 'field_image', src: PLAY_ICON, width: 26, height: 26, alt: '▶' }],
    nextStatement: null,
    style: 'event_blocks',
    tooltip: 'Hier beginnt dein Programm. Hänge darunter die Blöcke an, die ausgeführt werden sollen.',
  },
  {
    type: 'io_print',
    message0: 'schreibe %1 %2',
    args0: [
      { type: 'input_value', name: 'TEXT' },
      { type: 'field_dropdown', name: 'NEWLINE', options: [['und neue Zeile', 'LN'], ['ohne neue Zeile', 'NOLN']] },
    ],
    inputsInline: true,
    previousStatement: null,
    nextStatement: null,
    style: 'io_blocks',
    tooltip: 'Gibt einen Text oder eine Zahl in der Konsole aus.',
  },
  {
    type: 'io_ask',
    message0: 'frage %1 und lies %2',
    args0: [
      { type: 'input_value', name: 'PROMPT' },
      { type: 'field_dropdown', name: 'TYPE', options: [['Text', 'TEXT'], ['ganze Zahl', 'INT'], ['Kommazahl', 'FLOAT']] },
    ],
    inputsInline: true,
    output: null,
    style: 'io_blocks',
    tooltip: 'Stellt eine Frage und wartet auf die Eingabe in der Konsole.',
  },
  {
    type: 'op_arith',
    message0: '%1 %2 %3',
    args0: [
      { type: 'input_value', name: 'A' },
      {
        type: 'field_dropdown',
        name: 'OP',
        options: [['+', 'ADD'], ['−', 'SUB'], ['×', 'MUL'], ['÷', 'DIV'], ['÷ ganzzahlig', 'IDIV'], ['Rest von ÷', 'MOD'], ['hoch', 'POW']],
      },
      { type: 'input_value', name: 'B' },
    ],
    inputsInline: true,
    output: 'Number',
    style: 'operator_blocks',
    tooltip: 'Rechnet mit zwei Zahlen. "÷ ganzzahlig" lässt die Nachkommastellen weg, "Rest von ÷" ergibt den Rest der Division.',
  },
  {
    type: 'op_compare',
    message0: '%1 %2 %3',
    args0: [
      { type: 'input_value', name: 'A' },
      { type: 'field_dropdown', name: 'OP', options: [['=', 'EQ'], ['≠', 'NEQ'], ['<', 'LT'], ['≤', 'LTE'], ['>', 'GT'], ['≥', 'GTE']] },
      { type: 'input_value', name: 'B' },
    ],
    inputsInline: true,
    output: 'Boolean',
    style: 'operator_blocks',
    tooltip: 'Vergleicht zwei Werte und ergibt wahr oder falsch.',
  },
  {
    type: 'op_logic',
    message0: '%1 %2 %3',
    args0: [
      { type: 'input_value', name: 'A' },
      { type: 'field_dropdown', name: 'OP', options: [['und', 'AND'], ['oder', 'OR']] },
      { type: 'input_value', name: 'B' },
    ],
    inputsInline: true,
    output: 'Boolean',
    style: 'operator_blocks',
  },
  {
    type: 'op_not',
    message0: 'nicht %1',
    args0: [{ type: 'input_value', name: 'BOOL' }],
    output: 'Boolean',
    style: 'operator_blocks',
  },
  {
    type: 'op_math',
    message0: '%1 von %2',
    args0: [
      {
        type: 'field_dropdown',
        name: 'FN',
        options: [
          ['Wurzel', 'sqrt'],
          ['Betrag', 'abs'],
          ['minus', 'neg'],
          ['gerundet', 'round'],
          ['aufgerundet', 'ceil'],
          ['abgerundet', 'floor'],
          ['ln', 'ln'],
          ['log10', 'log10'],
          ['e hoch', 'exp'],
          ['10 hoch', 'pow10'],
        ],
      },
      { type: 'input_value', name: 'NUM' },
    ],
    inputsInline: true,
    output: 'Number',
    style: 'operator_blocks',
  },
  {
    type: 'op_random',
    message0: 'Zufallszahl von %1 bis %2',
    args0: [
      { type: 'input_value', name: 'FROM' },
      { type: 'input_value', name: 'TO' },
    ],
    inputsInline: true,
    output: 'Number',
    style: 'operator_blocks',
    tooltip: 'Eine zufällige ganze Zahl (beide Grenzen sind möglich).',
  },
  {
    type: 'op_convert',
    message0: '%1 als %2',
    args0: [
      { type: 'input_value', name: 'VALUE' },
      { type: 'field_dropdown', name: 'TO', options: [['ganze Zahl', 'INT'], ['Kommazahl', 'FLOAT'], ['Text', 'TEXT']] },
    ],
    inputsInline: true,
    output: null,
    style: 'operator_blocks',
    tooltip: 'Wandelt einen Wert um, z. B. den Text "42" in die Zahl 42.',
  },
  {
    type: 'list_get',
    message0: 'Element %1 von %2',
    args0: [
      { type: 'input_value', name: 'INDEX' },
      { type: 'input_value', name: 'LIST' },
    ],
    inputsInline: true,
    output: null,
    style: 'list_blocks',
    tooltip: 'Holt ein Element aus der Liste. Die Positionen beginnen bei 0.',
  },
  {
    type: 'list_set',
    message0: 'setze Element %1 von %2 auf %3',
    args0: [
      { type: 'input_value', name: 'INDEX' },
      { type: 'input_value', name: 'LIST' },
      { type: 'input_value', name: 'VALUE' },
    ],
    inputsInline: true,
    previousStatement: null,
    nextStatement: null,
    style: 'list_blocks',
    tooltip: 'Ersetzt ein Element der Liste. Die Positionen beginnen bei 0.',
  },
  {
    type: 'list_add',
    message0: 'füge %1 zu %2 hinzu',
    args0: [
      { type: 'input_value', name: 'VALUE' },
      { type: 'input_value', name: 'LIST' },
    ],
    inputsInline: true,
    previousStatement: null,
    nextStatement: null,
    style: 'list_blocks',
    tooltip: 'Hängt einen Wert hinten an die Liste an.',
  },
  {
    type: 'func_return',
    message0: 'gib %1 zurück',
    args0: [{ type: 'input_value', name: 'VALUE' }],
    previousStatement: null,
    style: 'procedure_blocks',
    tooltip: 'Beendet die Funktion und gibt den Wert zurück.',
  },
  {
    type: 'member_get',
    message0: '%1 . %2',
    args0: [
      { type: 'input_value', name: 'OBJ' },
      { type: 'field_input', name: 'NAME', text: 'eigenschaft' },
    ],
    inputsInline: true,
    output: null,
    style: 'advanced_blocks',
    tooltip: 'Eine Eigenschaft eines Objekts.',
  },
  {
    type: 'code_expr',
    message0: '%1 %2',
    args0: [
      { type: 'field_dropdown', name: 'LANG', options: LANG_OPTIONS },
      { type: 'field_input', name: 'CODE', text: '' },
    ],
    output: null,
    style: 'advanced_blocks',
    tooltip: 'Code, für den es noch keinen eigenen Block gibt. Er wird unverändert übernommen.',
  },
];

function installBlocks() {
  // Plain text literal without quote images, so it renders as a white slot like numbers.
  delete Blockly.Blocks['text'];
  Blockly.common.defineBlocksWithJsonArray([
    { type: 'text', message0: '%1', args0: [{ type: 'field_input', name: 'TEXT', text: '' }], output: 'String', style: 'text_blocks', tooltip: 'Ein Text.' },
  ]);
  Blockly.common.defineBlocksWithJsonArray(JSON_BLOCKS);
  // a few built-in blocks get our category colours
  const restyle = (type: string, styleName: string) => {
    const def = Blockly.Blocks[type];
    const init = def.init;
    def.init = function (this: Blockly.Block) {
      init.call(this);
      this.setStyle(styleName);
    };
  };
  restyle('logic_boolean', 'operator_blocks');
  restyle('text_join', 'textop_blocks');
  for (const type of ['text_join', 'lists_create_with']) {
    const def = Blockly.Blocks[type];
    const init = def.init;
    def.init = function (this: Blockly.Block) {
      init.call(this);
      this.setInputsInline(true);
    };
  }
  restyle('text_length', 'textop_blocks');
  restyle('logic_ternary', 'operator_blocks');

  Blockly.Blocks['code_comment'] = {
    init(this: Blockly.Block) {
      this.appendDummyInput().appendField('Notiz').appendField(new FieldMultilineInput('Kommentar'), 'TEXT');
      this.setPreviousStatement(true);
      this.setNextStatement(true);
      this.setStyle('advanced_blocks');
      this.setTooltip('Ein Kommentar: wird als Kommentar in den Code übernommen und nicht ausgeführt.');
    },
  };

  Blockly.Blocks['code_raw'] = {
    init(this: Blockly.Block) {
      this.appendDummyInput().appendField(new Blockly.FieldDropdown(LANG_OPTIONS), 'LANG').appendField('Code');
      this.appendDummyInput().appendField(new FieldMultilineInput(''), 'CODE');
      this.setPreviousStatement(true);
      this.setNextStatement(true);
      this.setStyle('advanced_blocks');
      this.setTooltip('Code, für den es noch keinen eigenen Block gibt. Er wird unverändert übernommen.');
    },
  };

  installVariadic();
  installDictCreate();
  Blockly.common.defineBlocksWithJsonArray([
    {
      type: 'controls_dowhile',
      message0: 'wiederhole',
      message1: '%1',
      args1: [{ type: 'input_statement', name: 'DO' }],
      message2: 'und prüfe danach: %1 %2',
      args2: [
        { type: 'field_dropdown', name: 'MODE', options: [['solange', 'WHILE'], ['bis', 'UNTIL']] },
        { type: 'input_value', name: 'BOOL' },
      ],
      previousStatement: null,
      nextStatement: null,
      style: 'loop_blocks',
      tooltip: 'Führt die Blöcke mindestens einmal aus und prüft die Bedingung erst danach (do … while).',
    },
    {
      type: 'control_try',
      message0: 'versuche',
      message1: '%1',
      args1: [{ type: 'input_statement', name: 'TRY' }],
      message2: 'falls ein Fehler passiert',
      message3: '%1',
      args3: [{ type: 'input_statement', name: 'CATCH' }],
      previousStatement: null,
      nextStatement: null,
      style: 'logic_blocks',
      tooltip: 'Wenn in den oberen Blöcken ein Fehler passiert (z. B. keine Zahl eingegeben), werden die unteren Blöcke ausgeführt statt das Programm abzubrechen.',
    },
    {
      type: 'error_throw',
      message0: 'löse Fehler aus %1',
      args0: [{ type: 'input_value', name: 'VALUE' }],
      previousStatement: null,
      style: 'logic_blocks',
      tooltip: 'Bricht mit einer Fehlermeldung ab (oder springt in "falls ein Fehler passiert").',
    },
    {
      type: 'error_message',
      message0: 'Fehlermeldung',
      output: 'String',
      style: 'logic_blocks',
      tooltip: 'Die Meldung des Fehlers, der gerade abgefangen wurde.',
    },
    {
      type: 'dict_get',
      message0: 'Wert zu %1 in %2',
      args0: [
        { type: 'input_value', name: 'KEY' },
        { type: 'input_value', name: 'DICT' },
      ],
      inputsInline: true,
      output: null,
      style: 'dict_blocks',
      tooltip: 'Der Wert, der im Wörterbuch zu diesem Schlüssel gespeichert ist.',
    },
    {
      type: 'dict_set',
      message0: 'setze in %1 den Wert zu %2 auf %3',
      args0: [
        { type: 'input_value', name: 'DICT' },
        { type: 'input_value', name: 'KEY' },
        { type: 'input_value', name: 'VALUE' },
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      style: 'dict_blocks',
      tooltip: 'Speichert einen Wert zu einem Schlüssel (ein vorhandener Wert wird ersetzt).',
    },
  ]);
  installLibraryBlocks();

  Blockly.Blocks['func_return'].onchange = function (this: Blockly.BlockSvg) {
    if (!this.workspace || this.workspace.isFlyout) return;
    let b: Blockly.Block | null = this;
    while ((b = b.getSurroundParent())) if (b.type.startsWith('procedures_def')) break;
    this.setWarningText(b ? null : 'Dieser Block gehört in eine eigene Funktion ("definiere ...").');
  };
}

// --- blocks with a variable number of arguments (+ / - buttons) -------------------

function addArgButtons(block: Blockly.Block & { argCount_: number; updateArgs_: () => void }, input: Blockly.Input) {
  input.appendField(
    new Blockly.FieldImage(MINUS_ICON, 18, 18, '−', () => {
      if (block.argCount_ > 0) {
        Blockly.Events.setGroup(true);
        const old = Blockly.Xml.domToText(block.mutationToDom?.() ?? Blockly.utils.xml.createElement('mutation'));
        block.argCount_--;
        block.updateArgs_();
        fireMutation(block, old);
        Blockly.Events.setGroup(false);
      }
    }),
    'MINUS',
  );
  input.appendField(
    new Blockly.FieldImage(PLUS_ICON, 18, 18, '+', () => {
      Blockly.Events.setGroup(true);
      const old = Blockly.Xml.domToText(block.mutationToDom?.() ?? Blockly.utils.xml.createElement('mutation'));
      block.argCount_++;
      block.updateArgs_();
      fireMutation(block, old);
      Blockly.Events.setGroup(false);
    }),
    'PLUS',
  );
}

function fireMutation(block: Blockly.Block, oldMutation: string) {
  const newMutation = Blockly.Xml.domToText(block.mutationToDom!());
  Blockly.Events.fire(new (Blockly.Events.get(Blockly.Events.BLOCK_CHANGE))(block, 'mutation', null, oldMutation, newMutation));
}

/** Rebuilds ARG0..n inputs, keeping connected blocks where possible. */
function rebuildArgs(block: Blockly.Block, count: number, label: (i: number) => string, shadow: (i: number) => any | null, before?: string) {
  const old: (Blockly.Block | null)[] = [];
  for (let i = 0; block.getInput(`ARG${i}`); i++) {
    const conn = block.getInput(`ARG${i}`)!.connection!;
    const target = conn.targetBlock();
    old.push(target && !target.isShadow() ? target : null);
    if (target && !target.isShadow()) conn.disconnect();
    block.removeInput(`ARG${i}`);
  }
  for (let i = 0; i < count; i++) {
    const input = block.appendValueInput(`ARG${i}`);
    const l = label(i);
    if (l) input.appendField(l);
    if (before && block.getInput(before)) block.moveInputBefore(`ARG${i}`, before);
    const sh = shadow(i);
    if (sh) input.connection!.setShadowState(sh);
    const prev = old[i];
    if (prev && prev.outputConnection) input.connection!.connect(prev.outputConnection);
  }
  for (let i = count; i < old.length; i++) old[i]?.dispose(true);
}

function installDictCreate() {
  Blockly.Blocks['dict_create'] = {
    argCount_: 0,
    init(this: any) {
      this.argCount_ = 0;
      const head = this.appendDummyInput('HEAD').appendField('Wörterbuch');
      addArgButtons(this, head);
      this.setOutput(true);
      this.setInputsInline(false);
      this.setStyle('dict_blocks');
      this.setTooltip('Ein Wörterbuch speichert Paare aus Schlüssel und Wert, z. B. Name → Alter. Mit + und − änderst du die Anzahl.');
    },
    updateArgs_(this: any) {
      const old: Record<string, Blockly.Block | null> = {};
      for (let i = 0; this.getInput(`KEY${i}`); i++) {
        for (const n of [`KEY${i}`, `VALUE${i}`]) {
          const c = this.getInput(n).connection;
          const t = c.targetBlock();
          old[n] = t && !t.isShadow() ? t : null;
          if (old[n]) c.disconnect();
          this.removeInput(n);
        }
      }
      for (let i = 0; i < this.argCount_; i++) {
        const k = this.appendValueInput(`KEY${i}`).setAlign(Blockly.inputs.Align.RIGHT).appendField('Schlüssel');
        k.connection.setShadowState({ type: 'text', fields: { TEXT: '' } });
        const v = this.appendValueInput(`VALUE${i}`).setAlign(Blockly.inputs.Align.RIGHT).appendField('→ Wert');
        v.connection.setShadowState({ type: 'math_number', fields: { NUM: 0 } });
        for (const [n, inp] of [[`KEY${i}`, k], [`VALUE${i}`, v]] as const) if (old[n]?.outputConnection) inp.connection.connect(old[n]!.outputConnection);
      }
      for (const [n, b] of Object.entries(old)) if (b && !this.getInput(n)) b.dispose(true);
    },
    saveExtraState(this: any) {
      return { pairs: this.argCount_ };
    },
    loadExtraState(this: any, s: any) {
      this.argCount_ = s?.pairs ?? 0;
      this.updateArgs_();
    },
    mutationToDom(this: any) {
      const m = Blockly.utils.xml.createElement('mutation');
      m.setAttribute('pairs', String(this.argCount_));
      return m;
    },
    domToMutation(this: any, m: Element) {
      this.argCount_ = Number(m.getAttribute('pairs') ?? 0);
      this.updateArgs_();
    },
  };
}

function installVariadic() {
  const make = (isStmt: boolean) => ({
    argCount_: 0,
    init(this: any) {
      this.argCount_ = 0;
      this.appendValueInput('OBJ').appendField('rufe von');
      const head = this.appendDummyInput('HEAD').appendField('die Methode').appendField(new Blockly.FieldTextInput('methode'), 'NAME').appendField('auf');
      addArgButtons(this, head);
      this.setInputsInline(true);
      if (isStmt) {
        this.setPreviousStatement(true);
        this.setNextStatement(true);
      } else this.setOutput(true);
      this.setStyle('advanced_blocks');
      this.setTooltip('Ruft eine Methode eines Objekts auf. Mit + und − änderst du die Anzahl der Werte.');
    },
    updateArgs_(this: any) {
      rebuildArgs(this, this.argCount_, (i: number) => (i === 0 ? 'mit' : ''), () => null);
    },
    saveExtraState(this: any) {
      return { args: this.argCount_ };
    },
    loadExtraState(this: any, s: any) {
      this.argCount_ = s?.args ?? 0;
      this.updateArgs_();
    },
    mutationToDom(this: any) {
      const m = Blockly.utils.xml.createElement('mutation');
      m.setAttribute('args', String(this.argCount_));
      return m;
    },
    domToMutation(this: any, m: Element) {
      this.argCount_ = Number(m.getAttribute('args') ?? 0);
      this.updateArgs_();
    },
  });
  Blockly.Blocks['method_expr'] = make(false);
  Blockly.Blocks['method_stmt'] = make(true);
}

// --- library blocks (dropdowns: library, function, then white argument slots) -------

/** External libraries known in the current program (set by the editor). */
export const externalLibs = new Map<string, Set<string>>();

export function registerExternal(lib: string, fn: string) {
  if (!externalLibs.has(lib)) externalLibs.set(lib, new Set());
  externalLibs.get(lib)!.add(fn);
}

function libLabel(lib: string): string {
  if (!isExternalLib(lib)) return LIBRARIES.find((l) => l.id === lib)?.label ?? lib;
  const m = externalModule(lib);
  return m ? m : 'Funktion';
}

function fnsOf(lib: string, statement: boolean): LibFn[] {
  return LIBRARIES.find((l) => l.id === lib)?.fns.filter((f) => (f.returns === null) === statement) ?? [];
}

export function paramShadow(p: LibFn['params'][number] | undefined): any | null {
  if (!p) return null;
  if (p.kind === 'number') return { type: 'math_number', fields: { NUM: typeof p.def === 'number' ? p.def : 0 } };
  if (p.kind === 'text' || p.kind === 'any') return { type: 'text', fields: { TEXT: p.def === undefined ? '' : String(p.def) } };
  return null;
}

function installLibraryBlocks() {
  const make = (isStmt: boolean) => ({
    lib_: isStmt ? 'list' : 'math',
    fn_: isStmt ? 'sort' : 'sin',
    argCount_: 1,
    init(this: any) {
      this.lib_ = isStmt ? 'list' : 'math';
      this.fn_ = isStmt ? 'sort' : 'sin';
      this.argCount_ = 1;
      const self = this;
      const libField = new Blockly.FieldDropdown(
        function () {
          const opts: [string, string][] = LIBRARIES.filter((l) => fnsOf(l.id, isStmt).length).map((l) => [l.label, l.id]);
          for (const lib of externalLibs.keys()) opts.push([libLabel(lib), lib]);
          if (!opts.some((o) => o[1] === self.lib_)) opts.push([libLabel(self.lib_), self.lib_]);
          return opts;
        },
        function (this: Blockly.FieldDropdown, value: string) {
          if (value !== self.lib_) {
            self.lib_ = value;
            if (!isExternalLib(value)) {
              self.fn_ = fnsOf(value, isStmt)[0]?.id ?? '';
              self.argCount_ = findLibFn(value, self.fn_)?.params.length ?? 0;
            } else {
              self.fn_ = [...(externalLibs.get(value) ?? [])][0] ?? 'funktion';
            }
            self.setFieldValue(self.fn_, 'FN');
            self.updateArgs_();
          }
          return value;
        },
      );
      const fnField = new Blockly.FieldDropdown(
        function () {
          if (!isExternalLib(self.lib_)) {
            const opts = fnsOf(self.lib_, isStmt).map((f) => [f.label, f.id] as [string, string]);
            if (!opts.some((o) => o[1] === self.fn_)) opts.push([self.fn_, self.fn_]);
            return opts;
          }
          const names = new Set([self.fn_, ...(externalLibs.get(self.lib_) ?? [])]);
          return [...[...names].map((n) => [n, n] as [string, string]), ['✎ andere Funktion …', '__other__']];
        },
        function (this: Blockly.FieldDropdown, value: string) {
          if (value === '__other__') {
            Blockly.dialog.prompt('Name der Funktion:', self.fn_, (name) => {
              if (name && /^[\p{L}_][\p{L}\p{N}_.]*$/u.test(name.trim())) {
                registerExternal(self.lib_, name.trim());
                self.fn_ = name.trim();
                self.setFieldValue(self.fn_, 'FN');
              }
            });
            return null;
          }
          if (value !== self.fn_) {
            self.fn_ = value;
            if (!isExternalLib(self.lib_)) {
              self.argCount_ = findLibFn(self.lib_, value)?.params.length ?? 0;
              self.updateArgs_();
            }
          }
          return value;
        },
      );
      const head = this.appendDummyInput('HEAD').appendField(libField, 'LIB').appendField(fnField, 'FN');
      this.headInput_ = head;
      this.setInputsInline(true);
      if (isStmt) {
        this.setPreviousStatement(true);
        this.setNextStatement(true);
      } else this.setOutput(true);
      this.setStyle('library_blocks');
      this.updateArgs_();
    },
    updateArgs_(this: any) {
      const external = isExternalLib(this.lib_);
      const def = external ? null : findLibFn(this.lib_, this.fn_);
      const count = def ? def.params.length : this.argCount_;
      this.argCount_ = count;
      // +/- buttons only for external functions (unknown number of parameters)
      const head: Blockly.Input = this.getInput('HEAD');
      if (external && !this.getField('PLUS')) addArgButtons(this, head);
      if (!external && this.getField('PLUS')) {
        head.removeField('PLUS');
        head.removeField('MINUS');
      }
      rebuildArgs(
        this,
        count,
        (i) => (def ? def.params[i].name : i === 0 ? 'mit' : ''),
        (i) => (def ? paramShadow(def.params[i]) : null),
      );
      this.setTooltip(def?.tooltip ?? (def ? `${libLabel(this.lib_)}: ${def.label}` : `Funktion ${this.fn_} aus ${libLabel(this.lib_)}`));
    },
    saveExtraState(this: any) {
      return { lib: this.lib_, fn: this.fn_, args: this.argCount_ };
    },
    loadExtraState(this: any, s: any) {
      this.lib_ = s?.lib ?? this.lib_;
      this.fn_ = s?.fn ?? this.fn_;
      this.argCount_ = s?.args ?? findLibFn(this.lib_, this.fn_)?.params.length ?? 0;
      if (isExternalLib(this.lib_)) registerExternal(this.lib_, this.fn_);
      this.updateArgs_();
    },
    mutationToDom(this: any) {
      const m = Blockly.utils.xml.createElement('mutation');
      m.setAttribute('lib', this.lib_);
      m.setAttribute('fn', this.fn_);
      m.setAttribute('args', String(this.argCount_));
      return m;
    },
    domToMutation(this: any, m: Element) {
      this.loadExtraState({ lib: m.getAttribute('lib'), fn: m.getAttribute('fn'), args: Number(m.getAttribute('args')) });
    },
  });
  Blockly.Blocks['lib_expr'] = make(false);
  Blockly.Blocks['lib_stmt'] = make(true);
}

// ---------------------------------------------------------------------------
// Toolbox

const num = (v: number) => ({ shadow: { type: 'math_number', fields: { NUM: v } } });
const txt = (v: string) => ({ shadow: { type: 'text', fields: { TEXT: v } } });

function libBlock(lib: string, fn: string, statement: boolean) {
  const def = findLibFn(lib, fn)!;
  const inputs: Record<string, any> = {};
  def.params.forEach((p, i) => {
    const sh = paramShadow(p);
    if (sh) inputs[`ARG${i}`] = { shadow: sh };
  });
  return { kind: 'block', type: statement ? 'lib_stmt' : 'lib_expr', extraState: { lib, fn, args: def.params.length }, fields: { LIB: lib, FN: fn }, inputs };
}

export const TOOLBOX = {
  kind: 'categoryToolbox',
  contents: [
    {
      kind: 'category',
      name: 'Start',
      categorystyle: 'event_category',
      contents: [{ kind: 'block', type: 'event_start' }],
    },
    {
      kind: 'category',
      name: 'Ausgabe',
      categorystyle: 'io_category',
      contents: [
        { kind: 'block', type: 'io_print', inputs: { TEXT: txt('Hallo!') } },
        { kind: 'block', type: 'io_ask', inputs: { PROMPT: txt('Name?') } },
        { kind: 'block', type: 'io_ask', fields: { TYPE: 'INT' }, inputs: { PROMPT: txt('Alter?') } },
      ],
    },
    {
      kind: 'category',
      name: 'Steuerung',
      categorystyle: 'control_category',
      contents: [
        { kind: 'block', type: 'controls_repeat_ext', inputs: { TIMES: num(10) } },
        { kind: 'block', type: 'controls_whileUntil', fields: { MODE: 'UNTIL' } },
        { kind: 'block', type: 'controls_whileUntil', fields: { MODE: 'WHILE' } },
        { kind: 'block', type: 'controls_for', inputs: { FROM: num(1), TO: num(10), BY: num(1) } },
        { kind: 'block', type: 'controls_forEach' },
        { kind: 'block', type: 'controls_if' },
        { kind: 'block', type: 'controls_if', extraState: { hasElse: true } },
        { kind: 'block', type: 'controls_flow_statements', fields: { FLOW: 'BREAK' } },
        { kind: 'block', type: 'controls_flow_statements', fields: { FLOW: 'CONTINUE' } },
        { kind: 'block', type: 'controls_dowhile', fields: { MODE: 'WHILE' } },
        { kind: 'block', type: 'control_try' },
        { kind: 'block', type: 'error_message' },
        { kind: 'block', type: 'error_throw', inputs: { VALUE: txt('Ungültige Eingabe') } },
      ],
    },
    {
      kind: 'category',
      name: 'Operatoren',
      categorystyle: 'operator_category',
      contents: [
        { kind: 'block', type: 'op_arith', fields: { OP: 'ADD' }, inputs: { A: num(1), B: num(1) } },
        { kind: 'block', type: 'op_arith', fields: { OP: 'MUL' }, inputs: { A: num(2), B: num(3) } },
        { kind: 'block', type: 'op_compare', fields: { OP: 'GT' }, inputs: { A: num(5), B: num(3) } },
        { kind: 'block', type: 'op_compare', fields: { OP: 'EQ' }, inputs: { A: num(1), B: num(1) } },
        { kind: 'block', type: 'op_logic', fields: { OP: 'AND' } },
        { kind: 'block', type: 'op_not' },
        { kind: 'block', type: 'logic_boolean' },
        { kind: 'block', type: 'op_random', inputs: { FROM: num(1), TO: num(10) } },
        { kind: 'block', type: 'op_math', inputs: { NUM: num(9) } },
        { kind: 'block', type: 'op_convert', inputs: { VALUE: txt('42') } },
        { kind: 'block', type: 'math_number', fields: { NUM: 0 } },
        { kind: 'block', type: 'logic_ternary' },
      ],
    },
    {
      kind: 'category',
      name: 'Text',
      categorystyle: 'text_category',
      contents: [
        { kind: 'block', type: 'text', fields: { TEXT: 'Hallo' } },
        { kind: 'block', type: 'text_join', extraState: { itemCount: 2 }, inputs: { ADD0: txt('Hallo '), ADD1: txt('Welt') } },
        { kind: 'block', type: 'text_length', inputs: { VALUE: txt('Hallo') } },
        libBlock('text', 'upper', false),
        libBlock('text', 'contains', false),
      ],
    },
    { kind: 'category', name: 'Variablen', categorystyle: 'variable_category', custom: 'VARIABLE' },
    {
      kind: 'category',
      name: 'Listen',
      categorystyle: 'list_category',
      contents: [
        { kind: 'block', type: 'lists_create_with', extraState: { itemCount: 3 }, inputs: { ADD0: num(1), ADD1: num(2), ADD2: num(3) } },
        { kind: 'block', type: 'lists_create_empty' },
        { kind: 'block', type: 'list_add', inputs: { VALUE: num(4) } },
        { kind: 'block', type: 'list_get', inputs: { INDEX: num(0) } },
        { kind: 'block', type: 'list_set', inputs: { INDEX: num(0), VALUE: num(0) } },
        { kind: 'block', type: 'lists_length' },
        libBlock('list', 'sort', true),
        libBlock('list', 'contains', false),
      ],
    },
    {
      kind: 'category',
      name: 'Bibliotheken',
      categorystyle: 'library_category',
      contents: [
        { kind: 'label', text: 'Wähle Bibliothek und Funktion im Block aus' },
        libBlock('math', 'sin', false),
        libBlock('math', 'max', false),
        libBlock('text', 'replace', false),
        libBlock('list', 'removeAt', true),
        libBlock('random', 'choice', false),
        libBlock('time', 'sleep', true),
        libBlock('list', 'sum', false),
        libBlock('file', 'read', false),
        libBlock('file', 'appendLine', true),
      ],
    },
    {
      kind: 'category',
      name: 'Wörterbücher',
      categorystyle: 'dict_category',
      contents: [
        {
          kind: 'block',
          type: 'dict_create',
          extraState: { pairs: 2 },
          inputs: { KEY0: txt('Anna'), VALUE0: num(12), KEY1: txt('Ben'), VALUE1: num(15) },
        },
        { kind: 'block', type: 'dict_get', inputs: { KEY: txt('Anna') } },
        { kind: 'block', type: 'dict_set', inputs: { KEY: txt('Clara'), VALUE: num(11) } },
        libBlock('dict', 'has', false),
        libBlock('dict', 'keys', false),
        libBlock('dict', 'size', false),
        libBlock('dict', 'remove', true),
      ],
    },
    { kind: 'category', name: 'Funktionen', categorystyle: 'function_category', custom: 'FUNKTIONEN' },
    {
      kind: 'category',
      name: 'Mehr',
      categorystyle: 'advanced_category',
      contents: [
        { kind: 'block', type: 'code_comment' },
        { kind: 'block', type: 'method_stmt', fields: { NAME: 'methode' } },
        { kind: 'block', type: 'method_expr', fields: { NAME: 'methode' } },
        { kind: 'block', type: 'member_get' },
      ],
    },
  ],
};

export function registerFunctionCategory(ws: Blockly.WorkspaceSvg) {
  ws.registerToolboxCategoryCallback('FUNKTIONEN', (w) => {
    const items = Blockly.Procedures.flyoutCategory(w).filter((it: any) => it.type !== 'procedures_ifreturn');
    const idx = items.findIndex((it: any) => it.type === 'procedures_defreturn');
    items.splice(idx + 1, 0, { kind: 'block', type: 'func_return' } as any);
    return items as any;
  });
}

let installed = false;
export function installAll() {
  if (installed) return;
  installed = true;
  setMessages();
  installBlocks();
}
