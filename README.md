# Visualizing Code – Blöcke statt Syntax

Ein Scratch-ähnlicher Block-Editor für **Python, Java, JavaScript, C#, C++ und VBA**.
Man zieht Blöcke aus der Palette, steckt sie zusammen und sieht daneben sofort den
echten Code in der gewählten Sprache. Die Syntax muss man dafür nicht kennen.
Es geht auch umgekehrt: Vorhandener Code wird in Blöcke umgewandelt.

Das Projekt besteht aus

- einer **Web-App**, die ohne Installation im Browser läuft, und
- einer **VS-Code-Erweiterung**, die `.blocks`-Dateien als Block-Editor öffnet und
  jede Code-Datei (`.py`, `.java`, `.js`, `.cs`, `.cpp`, `.bas`) als Blöcke anzeigen kann.

Beide nutzen denselben sprachneutralen Kern.

## Funktionen

| | |
|---|---|
| **Blöcke → Code** | Live-Ansicht in 6 Sprachen. Ein Klick auf eine andere Sprache übersetzt das ganze Programm. |
| **Code → Blöcke** | Code im Code-Feld ändern oder eine Datei öffnen, dann „In Blöcke umwandeln“. |
| **Start / Konsole** | Das Programm läuft direkt im Editor, mit Ausgabe und Eingabe („frage … und lies“). „Zeitlupe“ zeigt den gerade ausgeführten Block. |
| **Bibliotheken** | Ein Block mit zwei Dropdowns: Bibliothek (Mathe, Text, Liste, Zufall, Zeit) und Funktion. Die Parameter sind weiße Felder, in die man Werte oder Blöcke zieht. Jede Funktion hat für jede Sprache die passende Umsetzung (z. B. `s.upper()`, `s.toUpperCase()`, `s.ToUpper()`, `UCase(s)`). Nötige `import`/`#include`-Zeilen ergänzt der Editor selbst. |
| **Fremde Pakete** | Wird im Code z. B. `import numpy as np` verwendet, erscheint `np` als eigene Bibliothek im Dropdown, mit den Funktionen, die im Code vorkommen. |
| **Typen** | Für Java, C# und C++ werden Typen (`int`, `double`, `String`, `ArrayList<Integer>` …) automatisch abgeleitet. |
| **Eigene Funktionen** | „definiere …“-Blöcke mit Parametern (Zahnrad) und Rückgabewert. |

### Die Blöcke

- **Start**: „Wenn Programm startet“
- **Ausgabe**: schreibe (mit/ohne neue Zeile), frage … und lies (Text, ganze Zahl, Kommazahl)
- **Steuerung**: wiederhole n mal, wiederhole bis/solange, zähle von … bis, für jedes Element, falls/sonst falls/sonst, abbrechen, weiter
- **Operatoren**: + − × ÷, ganzzahlig ÷, Rest, hoch, Vergleiche, und/oder/nicht, Zufallszahl, Wurzel/Betrag/Runden …, Umwandeln (als Zahl/Text), falls-dann-sonst
- **Text**: Text, verbinde, Länge, Text-Bibliothek
- **Variablen**: setze, ändere um, Variable
- **Listen**: Liste aus …, leere Liste, füge hinzu, Element an Position (ab 0), setze Element, Länge, Listen-Bibliothek
- **Bibliotheken**: Mathe, Text, Liste, Zufall, Zeit
- **Funktionen**: definiere, definiere mit Rückgabe, gib zurück, Aufrufe
- **Mehr**: Notiz (Kommentar), Methodenaufruf, Eigenschaft

### Was noch keinen eigenen Block hat

Konstrukte ohne eigenen Block werden beim Einlesen als **Code-Block** übernommen. Er
enthält den Originaltext, damit nichts verloren geht. Das betrifft derzeit vor allem
Klassen, `try`/`catch`, `switch`, Dictionaries/Maps, Lambdas, `do … while`, Tupel und
Standardwerte für Parameter. List Comprehensions in Python werden automatisch in eine
Schleife umgewandelt.

## Schnellstart

Voraussetzung: Node.js 18 oder neuer.

```bash
npm install
```

```bash
npm run build
```

```bash
npm run serve
```

Danach <http://localhost:8080/> öffnen.

| Befehl | Zweck |
|---|---|
| `npm run build` | baut Web-App (`dist/web`), Ein-Datei-Version (`dist/artifact`) und Erweiterung (`extension/dist`) |
| `npm test` | Tests: Rundlauf Code → Blöcke → Code für alle Sprachen, Übersetzung zwischen den Sprachen, Ausführung |
| `npm run typecheck` | TypeScript-Prüfung |

### VS-Code-Erweiterung

```bash
npm run build && cd extension && npx @vscode/vsce package --no-dependencies
```

Die entstandene `visualizing-code-0.1.0.vsix` in VS Code über
**Erweiterungen → … → Aus VSIX installieren** installieren. Danach:

- **Neues Programm**: Befehlspalette → „Visualizing Code: Neues Block-Programm“ (legt eine `.blocks`-Datei an)
- **Code-Datei als Blöcke**: In einer `.py`/`.java`/… Datei oben rechts auf „Als Blöcke öffnen“ klicken.
  Änderungen an den Blöcken schreiben die Datei. Änderungen im Text-Editor aktualisieren die Blöcke.
- **Im Terminal**: führt den echten Code mit `python3`, `node`, `java`, `g++` bzw. `dotnet` aus (müssen installiert sein).
  VBA läuft nur in Office; die eingebaute Konsole kann es aber ausführen.
- **Code exportieren**: speichert das Programm in einer beliebigen der 6 Sprachen.

## Aufbau

```
src/core/            sprachneutraler Kern (läuft auch in Node)
  ir.ts              Programmmodell
  analysis.ts        Gültigkeitsbereiche und Typableitung
  library.ts         Bibliothekskatalog mit Code-Mustern je Sprache
  generators/        Programmmodell → Code (eine Datei je Sprache)
  parsers/           Code → Programmmodell (Python, C-artige Sprachen, VBA) + normalize.ts
  interpreter.ts     eingebaute Ausführung für die Konsole
  blockly.ts         Programmmodell ↔ Blockly-JSON
  examples.ts        Beispielprogramme
src/ui/              Editor-Oberfläche (Blockly, CodeMirror, Konsole)
src/web/             Web-App
src/vscode/          VS-Code-Erweiterung (Host + Webview)
extension/           Manifest der Erweiterung
tests/               Vitest-Tests
```

Die Bibliotheks-Muster in `library.ts` werden in beide Richtungen verwendet: Aus
`{0}.upper()` wird beim Erzeugen `name.upper()`, und beim Einlesen wird `name.upper()`
wieder als „Text → in Großbuchstaben“ erkannt. Eine neue Bibliotheksfunktion braucht
deshalb nur einen Eintrag mit sechs Mustern.
