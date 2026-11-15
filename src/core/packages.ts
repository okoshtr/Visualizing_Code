// Well-known packages: their functions and values are offered in the dropdowns of the
// library blocks once the package is imported ("importiere Paket ..."). Every other
// function of a package can still be typed in ("✎ andere Funktion …").

import type { Lang } from './ir';

export interface PackageFn {
  name: string;
  /** Names of the positional parameters (labels of the white slots). */
  params?: string[];
  /** Typical named arguments, shown in the tooltip. */
  named?: string[];
  tooltip?: string;
}

export interface KnownPackage {
  module: string;
  lang: Lang;
  /** Usual alias, e.g. np for numpy. */
  alias?: string;
  title: string;
  fns: PackageFn[];
  /** Values (constants), e.g. pulp.LpMaximize. */
  values?: string[];
}

const fn = (name: string, params: string[] = [], tooltip?: string, named?: string[]): PackageFn => ({ name, params, ...(tooltip ? { tooltip } : {}), ...(named ? { named } : {}) });

export const KNOWN_PACKAGES: KnownPackage[] = [
  {
    module: 'pulp',
    lang: 'python',
    title: 'PuLP (Optimierung)',
    fns: [
      fn('LpProblem', ['name', 'ziel'], 'Ein neues Optimierungsproblem, z. B. LpProblem("Plan", LpMaximize).'),
      fn('LpVariable', ['name'], 'Eine Entscheidungsvariable.', ['lowBound', 'upBound', 'cat']),
      fn('lpSum', ['werte'], 'Summe vieler Ausdrücke.'),
      fn('value', ['variable'], 'Der Wert einer Variablen nach dem Lösen.'),
      fn('PULP_CBC_CMD', [], 'Der eingebaute Löser.', ['msg']),
    ],
    values: ['LpMaximize', 'LpMinimize', 'LpStatus', 'LpInteger', 'LpContinuous', 'LpBinary'],
  },
  {
    module: 'numpy',
    lang: 'python',
    alias: 'np',
    title: 'NumPy (Rechnen mit Zahlenreihen)',
    fns: [
      fn('array', ['werte']),
      fn('arange', ['start', 'stopp']),
      fn('linspace', ['start', 'stopp', 'anzahl']),
      fn('zeros', ['anzahl']),
      fn('ones', ['anzahl']),
      fn('mean', ['werte'], 'Mittelwert'),
      fn('median', ['werte']),
      fn('std', ['werte'], 'Standardabweichung'),
      fn('sum', ['werte']),
      fn('sqrt', ['x']),
      fn('max', ['werte']),
      fn('min', ['werte']),
      fn('round', ['werte', 'stellen']),
    ],
    values: ['pi', 'e'],
  },
  {
    module: 'pandas',
    lang: 'python',
    alias: 'pd',
    title: 'pandas (Tabellen)',
    fns: [fn('read_csv', ['datei'], undefined, ['sep']), fn('read_excel', ['datei']), fn('DataFrame', ['daten']), fn('Series', ['werte'])],
  },
  {
    module: 'matplotlib.pyplot',
    lang: 'python',
    alias: 'plt',
    title: 'Matplotlib (Diagramme)',
    fns: [
      fn('plot', ['x', 'y'], undefined, ['label', 'color']),
      fn('bar', ['x', 'höhe']),
      fn('scatter', ['x', 'y']),
      fn('title', ['text']),
      fn('xlabel', ['text']),
      fn('ylabel', ['text']),
      fn('legend'),
      fn('grid'),
      fn('savefig', ['datei']),
      fn('show'),
    ],
  },
  {
    module: 'requests',
    lang: 'python',
    title: 'requests (Internet)',
    fns: [fn('get', ['url'], undefined, ['params', 'headers']), fn('post', ['url'], undefined, ['json', 'data', 'headers'])],
  },
  {
    module: 'statistics',
    lang: 'python',
    title: 'statistics (Statistik)',
    fns: [fn('mean', ['werte']), fn('median', ['werte']), fn('mode', ['werte']), fn('stdev', ['werte'])],
  },
  {
    module: 'json',
    lang: 'python',
    title: 'json',
    fns: [fn('dumps', ['wert'], undefined, ['indent']), fn('loads', ['text'])],
  },
  {
    module: 'os',
    lang: 'python',
    title: 'os (Dateisystem)',
    fns: [fn('getcwd'), fn('listdir', ['ordner']), fn('mkdir', ['ordner']), fn('remove', ['datei'])],
  },
  {
    module: 'lodash',
    lang: 'javascript',
    alias: '_',
    title: 'lodash',
    fns: [fn('sum', ['liste']), fn('max', ['liste']), fn('min', ['liste']), fn('uniq', ['liste']), fn('shuffle', ['liste']), fn('chunk', ['liste', 'größe']), fn('range', ['start', 'ende'])],
    values: ['VERSION'],
  },
  {
    module: 'fs',
    lang: 'javascript',
    title: 'fs (Dateien)',
    fns: [fn('readFileSync', ['datei', 'kodierung']), fn('writeFileSync', ['datei', 'text']), fn('existsSync', ['datei'])],
  },
  {
    module: 'path',
    lang: 'javascript',
    title: 'path (Pfade)',
    fns: [fn('join', ['teil1', 'teil2']), fn('basename', ['pfad']), fn('extname', ['pfad'])],
  },
];

export function findPackage(module: string): KnownPackage | undefined {
  return KNOWN_PACKAGES.find((p) => p.module === module);
}

export function findPackageFn(module: string, name: string): PackageFn | undefined {
  return findPackage(module)?.fns.find((f) => f.name === name);
}
