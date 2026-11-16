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
| **Code → Blöcke** | Code im Code-Feld ändern oder eine Datei öffnen, dann „In Blöcke umwandeln“. Leerzeilen und Kommentare am Zeilenende bleiben erhalten. |
| **Block ↔ Code verknüpft** | Ein Klick auf einen Block markiert seine Code-Zeilen; ein Klick in eine Code-Zeile markiert den Block. Fährt man über einen Block, zeigt ein Tooltip den Code dazu. |
| **Start / Konsole** | Das Programm läuft direkt im Editor, mit Ausgabe und Eingabe („frage … und lies“). „Zeitlupe“ zeigt den gerade ausgeführten Block. Code und Konsole lassen sich einklappen. |
| **Schritt für Schritt** | „Schritt“ (F10) führt einen Block nach dem anderen aus und markiert ihn; der Reiter „Variablen“ zeigt dabei die aktuellen Werte (Hauptprogramm, laufende Funktion oder Methode, „dieses Objekt“). „Weiter“ läuft ohne Halt bis zum Ende. |
| **Zeichnen** | Bibliothek „Zeichnen“ (vorwärts, drehen, Stiftfarbe …). Die Zeichnung erscheint im Reiter „Zeichnung“; Python nutzt `turtle`, die anderen Sprachen speichern `zeichnung.svg`. |
| **Bibliotheken** | Ein Block mit zwei Dropdowns: Bibliothek (Mathe, Text, Liste, Wörterbuch, Datei, Zufall, Zeit, Zeichnen) und Funktion. Die Parameter sind weiße Felder, in die man Werte oder Blöcke zieht. Jede Funktion hat für jede Sprache die passende Umsetzung (z. B. `s.upper()`, `s.toUpperCase()`, `s.ToUpper()`, `UCase(s)`). Nötige `import`/`#include`-Zeilen ergänzt der Editor selbst. |
| **Pakete importieren** | „importiere Paket `pulp` als `pulp`“ bzw. „aus Paket `pulp` importiere `LpProblem, lpSum`“. Das Paket erscheint danach im ersten Dropdown der Bibliotheks-Blöcke; für bekannte Pakete (pulp, numpy, pandas, matplotlib, requests, statistics, json, os, lodash, fs, path) stehen die Funktionen schon im zweiten Dropdown, jede andere lässt sich eintippen. |
| **Benannte Werte** | „benannt `lowBound` = 0“ für Aufrufe wie `LpVariable("x", lowBound=0)`. Python schreibt `name=wert`, C# `name: wert`, VBA `name:=wert`; die anderen Sprachen übergeben den Wert an seiner Stelle (mit Hinweis). Werte aus Paketen wie `pulp.LpMaximize` haben den Block „Wert … aus …“. |
| **Klassen** | Klasse mit Eigenschaften, „beim Erzeugen“ (Konstruktor) und Methoden; „dieses Objekt“, „neues Objekt“, „setze Eigenschaft“. In VBA wird daraus ein `Type` mit `NeuKlasse` und `Klasse_methode`. |
| **Vererbung** | „Klasse Hund erbt von Tier“: Die Unterklasse übernimmt Eigenschaften und Methoden und kann einzelne neu festlegen. „Basisklasse erzeugen mit …“ ruft den Konstruktor der Basisklasse auf (`super(...)` / `base(...)`), „Basisklasse“ als Objekt eines Methodenaufrufs ruft deren Version einer Methode auf. C# bekommt `virtual`/`override`, C++ `virtual`; in VBA, das keine Vererbung kennt, werden die geerbten Teile in jede Unterklasse kopiert (und beim Einlesen wiedererkannt). Eine Methode „legt jede Unterklasse selbst fest“ ist abstrakt (`@abstractmethod`, `abstract`, `= 0`); Schnittstellen (`interface`) aus Java und C# werden zu solchen Basisklassen. |
| **Aufgaben** | 16 geführte Aufgaben in drei Stufen mit Tipp und automatischer Prüfung (Ausgabe, verlangte Bausteine wie Schleife oder Funktion, Schutz vor Endlosschleifen). Gelöste Aufgaben bekommen ein ✓. |
| **Typen** | Für Java, C# und C++ werden Typen (`int`, `double`, `String`, `ArrayList<Integer>`, `Map<String, Integer>`, eigene Klassen …) automatisch abgeleitet. |
| **Teilen** | In der Web-App kopiert „Teilen“ einen Link, in dem das ganze Programm (komprimiert) steckt. Wer ihn öffnet, sieht genau diese Blöcke. |
| **Zahlen wie in der Sprache** | Ausgabe, Division (`/`, `//`, `%`), Runden und die Reihenfolge von Wörterbüchern verhalten sich in der eingebauten Konsole wie in der gewählten Sprache. |

### Die Blöcke

- **Start**: „Wenn Programm startet“
- **Ausgabe**: schreibe (mit/ohne neue Zeile), frage … und lies (Text, ganze Zahl, Kommazahl)
- **Steuerung**: wiederhole n mal, wiederhole bis/solange, wiederhole … bis/solange (Prüfung am Ende), zähle von … bis, für jedes Element, falls/sonst falls/sonst, abbrechen, weiter, versuche … falls Fehler, löse Fehler aus, Fehlermeldung
- **Operatoren**: + − × ÷, ganzzahlig ÷, Rest, hoch, Vergleiche, und/oder/nicht, Zufallszahl, Wurzel/Betrag/Runden …, Umwandeln (als Zahl/Text), falls-dann-sonst
- **Text**: Text, verbinde, Länge, Text-Bibliothek (u. a. Zahl mit Nachkommastellen, Anzahl von, besteht nur aus Ziffern, Zeichencode)
- **Variablen**: setze, ändere um, Variable
- **Listen**: Liste aus …, leere Liste, füge hinzu, Element an Position (ab 0), setze Element, Länge, Summe/Minimum/Maximum, sortieren, sortierte Kopie, Liste mit gleichen Werten (Arrays), letztes Element herausnehmen, entferne den Wert, Anzahl von …
- **Bibliotheken**: Mathe, Text, Liste, Wörterbuch, Datei, Zufall, Zeit, Zeichnen und importierte Pakete
- **Wörterbücher**: Wörterbuch aus Paaren, Wert zu Schlüssel, Wert zu Schlüssel oder sonst, setze Schlüssel, enthält/Schlüssel/Werte/Anzahl/entferne
- **Funktionen**: definiere, definiere mit Rückgabe, gib zurück, Aufrufe (Standardwerte und benannte Argumente aus dem Code werden beim Einlesen aufgelöst)
- **Klassen**: Klasse (mit „erbt von“), Eigenschaft, beim Erzeugen, Methode, dieses Objekt, neues Objekt, Eigenschaft lesen/setzen, Methode aufrufen, Basisklasse erzeugen, Basisklasse
- **Mehr**: Notiz (Kommentar), Methodenaufruf

Beim Einlesen werden auch typische Schreibweisen erkannt, z. B. `f"{x:.2f}"`, `"%d" % n`,
`String.format`/`printf`, `$"{x:F2}"`, `cout << fixed << setprecision(2)`, `toFixed`,
`Format(x, "0.00")`, Arrays (`new int[5]`, `int a[3] = {…}`), `StringBuilder`,
`Substring(von, Länge)`/`substr`/`Mid`, `for (auto& [k, v] : m)` und
`const f = (x) => …`. `switch`/`Select Case` wird beim Einlesen zu „falls / sonst falls“, Tupel-Zuweisungen
(`a, b = b, a`) und List Comprehensions werden in einzelne Schritte bzw. Schleifen umgewandelt.

### Was noch keinen eigenen Block hat

Konstrukte ohne eigenen Block werden beim Einlesen als **Code-Block** übernommen. Er
enthält den Originaltext, damit nichts verloren geht. Das betrifft derzeit vor allem
Lambdas (z. B. `map`/`filter`, Sortierschlüssel), Mengen (`set`), `zip`, mehrere
Schnittstellen, Generatoren, rohe Zeiger in C++, Objekt-Literale in JavaScript und
VBA-Arrays mit `1 To n`. `tests/idioms.test.ts` führt die typischen Anfänger-Schnipsel
auf, die schon Blöcke werden, und die noch offenen.

Objekte eigener Klassen verhalten sich in allen Sprachen gleich: Zwei Variablen können
dasselbe Objekt meinen. In C++ werden sie deshalb als `shared_ptr` (mit `make_shared`)
erzeugt; so behält ein Hund auch in einer Liste von Tieren seine eigenen Methoden.

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
| `npm test` | Tests (siehe unten) |
| `npm run test:ui` | Browser-Test der gebauten Web-App mit Chromium (braucht Playwright) |
| `npm run test:vscode` | startet ein echtes VS Code mit der Erweiterung (lädt VS Code herunter; unter Linux ohne Bildschirm mit `xvfb-run`) |
| `npm run typecheck` | TypeScript-Prüfung |
| `npm run package:vscode` | baut die `.vsix`-Datei der Erweiterung |

### Tests

- **Rundlauf**: Code → Blöcke → Code ist für alle Beispiele in allen 6 Sprachen zeichengleich.
- **Übersetzen**: Ein Programm aus einer Sprache behält in jeder anderen Sprache seine Bedeutung.
- **Echte Compiler**: Der erzeugte Code wird mit `python3`, `node`, `javac`/`java`, `g++` und
  `dotnet` übersetzt und ausgeführt; die Ausgabe muss der eingebauten Konsole entsprechen.
  Fehlt ein Compiler, wird der Test übersprungen.
- **Handgeschriebener Code**: `tests/samples` enthält typischen Code je Sprache (auch Klassen,
  Vererbung und Pakete), der ohne Code-Blöcke eingelesen werden muss – im Browser auch durch
  den echten Block-Editor. Die Klassen- und Vererbungsbeispiele laufen nach dem Übersetzen in
  jeder Sprache mit dem echten Compiler und liefern dieselbe Ausgabe.
- **Aufgaben**: Jede Musterlösung besteht ihre Prüfung und läuft in allen Compilern.

### Automatisch auf GitHub

- `.github/workflows/ci.yml` führt bei jedem Push alle Tests aus (mit Python, Java, .NET, g++,
  Chromium und einem echten VS Code) und legt die `.vsix`-Datei als Build-Artefakt ab.
- `.github/workflows/pages.yml` veröffentlicht die Web-App bei jedem Push auf `main` auf
  GitHub Pages. Dafür muss in den Repository-Einstellungen unter **Pages** als Quelle
  „GitHub Actions“ gewählt sein.

### VS-Code-Erweiterung

```bash
npm run package:vscode
```

Die entstandene `extension/visualizing-code-0.1.0.vsix` in VS Code über
**Erweiterungen → … → Aus VSIX installieren** installieren. Danach:

- **Neues Programm**: Befehlspalette → „Visualizing Code: Neues Block-Programm“ (legt eine `.blocks`-Datei an)
- **Code-Datei als Blöcke**: In einer `.py`/`.java`/… Datei oben rechts auf „Als Blöcke öffnen“ klicken.
  Änderungen an den Blöcken schreiben die Datei (nur die geänderten Zeilen). Änderungen im Text-Editor aktualisieren die Blöcke.
- **Im Terminal**: führt den echten Code mit `python3`, `node`, `java`, `g++` bzw. `dotnet` aus (müssen installiert sein).
  VBA läuft nur in Office; die eingebaute Konsole kann es aber ausführen.
- **Code exportieren**: speichert das Programm in einer beliebigen der 6 Sprachen.

Für eine Veröffentlichung im Marketplace fehlen noch zwei Entscheidungen: eine **Lizenz**
(derzeit keine) und eine eigene **Publisher-ID** (in `extension/package.json` steht der
Platzhalter `visualizing-code`).

## Aufbau

```
src/core/            sprachneutraler Kern (läuft auch in Node)
  ir.ts              Programmmodell
  analysis.ts        Gültigkeitsbereiche und Typableitung
  library.ts         Bibliothekskatalog mit Code-Mustern je Sprache
  packages.ts        bekannte Pakete (Funktionen für die Dropdowns)
  generators/        Programmmodell → Code (eine Datei je Sprache)
  parsers/           Code → Programmmodell (Python, C-artige Sprachen, VBA) + normalize.ts
  interpreter.ts     eingebaute Ausführung für die Konsole
  blockly.ts         Programmmodell ↔ Blockly-JSON
  examples.ts        Beispielprogramme
  tasks.ts           Aufgaben mit Prüfung
src/ui/              Editor-Oberfläche (Blockly, CodeMirror, Konsole)
src/web/             Web-App
src/vscode/          VS-Code-Erweiterung (Host + Webview)
extension/           Manifest der Erweiterung
tests/               Vitest-Tests, Beispieldateien, VS-Code-Test
scripts/             Build, lokaler Server, Browser- und VS-Code-Test
```

Die Bibliotheks-Muster in `library.ts` werden in beide Richtungen verwendet: Aus
`{0}.upper()` wird beim Erzeugen `name.upper()`, und beim Einlesen wird `name.upper()`
wieder als „Text → in Großbuchstaben“ erkannt. Eine neue Bibliotheksfunktion braucht
deshalb nur einen Eintrag mit sechs Mustern.
