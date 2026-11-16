// Typical beginner code in every language: it must become real blocks (no code blocks,
// no unknown functions) and come out the same way again.
import { describe, expect, it } from 'vitest';
import { generate, parse, walkAllExprs, walkStmts, type Lang } from '../src/core';
import { allStmts } from './helpers';

const SNIPPETS: [Lang, string, string][] = [
  // ---------------- Python
  ['python', 'format 2 decimals f-string', 'preis = 3.5\nprint(f"Preis: {preis:.2f} Euro")\n'],
  ['python', 'round 2', 'x = 2.345\nprint(round(x, 2))\n'],
  ['python', 'format()', 'x = 2.5\nprint("{:.1f}".format(x))\n'],
  ['python', 'str methods', 's = " Hallo Welt "\nt = s.strip()\nprint(t.lower(), t.upper(), t.replace("Welt", "Du"))\nprint(t.startswith("Ha"), t.endswith("lt"), t.find("W"))\n'],
  ['python', 'split join', 'satz = "a b c"\nteile = satz.split(" ")\nprint(len(teile))\nprint("-".join(teile))\n'],
  ['python', 'slicing', 's = "Hallo"\nprint(s[1:3], s[:2], s[-1])\n'],
  ['python', 'list ops', 'xs = [3, 1, 2]\nxs.append(5)\nxs.insert(0, 9)\nxs.remove(1)\nx = xs.pop()\nxs.sort()\nxs.reverse()\nprint(xs, x, xs.index(3), 2 in xs, len(xs))\n'],
  ['python', 'sum min max sorted', 'xs = [3, 1, 2]\nprint(sum(xs), min(xs), max(xs), sorted(xs))\n'],
  ['python', 'enumerate', 'for i, n in enumerate(["a", "b"]):\n    print(i, n)\n'],
  ['python', 'range len', 'xs = [1, 2]\nfor i in range(len(xs)):\n    print(xs[i])\n'],
  ['python', 'while True break', 'n = 0\nwhile True:\n    n += 1\n    if n > 3:\n        break\nprint(n)\n'],
  ['python', 'try ValueError', 'try:\n    z = int("x")\nexcept ValueError:\n    print("keine Zahl")\n'],
  ['python', 'dict get items', 'd = {"a": 1}\nprint(d.get("b", 0))\nfor k, v in d.items():\n    print(k, v)\n'],
  ['python', 'chained compare', 'x = 5\nif 0 < x < 10:\n    print("ok")\n'],
  ['python', 'not in', 'xs = [1]\nif 2 not in xs:\n    print("fehlt")\n'],
  ['python', 'ternary', 'x = 3\ny = "gerade" if x % 2 == 0 else "ungerade"\nprint(y)\n'],
  ['python', 'abs max min args', 'print(abs(-3), max(2, 5), min(2, 5))\n'],
  ['python', 'ord chr', 'print(ord("A"), chr(66))\n'],
  ['python', 'isdigit', 's = "12"\nif s.isdigit():\n    print(int(s) * 2)\n'],
  ['python', 'augmented', 'x = 2\nx *= 3\nx -= 1\nx //= 2\nprint(x)\n'],
  ['python', 'count', 's = "banane"\nprint(s.count("a"))\nxs = [1, 1, 2]\nprint(xs.count(1))\n'],
  ['python', 'list comp filter', 'xs = [1, 2, 3, 4]\nge = [x for x in xs if x % 2 == 0]\nprint(ge)\n'],
  ['python', 'input int', 'alter = int(input("Alter: "))\nprint(alter + 1)\n'],
  ['python', 'float input', 'x = float(input("Zahl: "))\nprint(x * 2)\n'],
  ['python', 'random', 'import random\nz = random.randint(1, 6)\nw = random.choice(["a", "b"])\nprint(z > 0, len(w))\n'],
  ['python', 'math', 'import math\nprint(math.sqrt(16), math.pi > 3, math.floor(2.7), math.ceil(2.1))\n'],
  ['python', 'string multiply', 'print("-" * 10)\n'],
  ['python', 'nested list', 'm = [[1, 2], [3, 4]]\nprint(m[1][0])\n'],
  ['python', 'zip', 'for a, b in zip([1, 2], ["x", "y"]):\n    print(a, b)\n'],
  ['python', 'reversed', 'for i in reversed(range(3)):\n    print(i)\n'],
  ['python', 'str()', 'n = 5\ntext = "Zahl " + str(n)\nprint(text)\n'],
  ['python', 'len dict', 'd = {"a": 1}\nprint(len(d))\ndel d["a"]\nprint(d)\n'],
  ['python', 'global', 'zaehler = 0\ndef plus():\n    global zaehler\n    zaehler += 1\nplus()\nprint(zaehler)\n'],
  ['python', 'return multiple', 'def mm(xs):\n    return min(xs), max(xs)\na, b = mm([1, 2])\nprint(a, b)\n'],
  ['python', 'lambda sort key', 'xs = ["aaa", "b"]\nxs.sort(key=len)\nprint(xs)\n'],
  ['python', 'set', 's = set([1, 2, 2])\nprint(len(s))\n'],
  ['python', 'while input', 'eingabe = ""\nwhile eingabe != "ende":\n    eingabe = input("> ")\n'],
  // ---------------- Java
  ['java', 'array int', 'public class Main {\n    public static void main(String[] args) {\n        int[] zahlen = {3, 1, 2};\n        int summe = 0;\n        for (int i = 0; i < zahlen.length; i++) {\n            summe += zahlen[i];\n        }\n        System.out.println(summe);\n    }\n}\n'],
  ['java', 'new array', 'public class Main {\n    public static void main(String[] args) {\n        int[] a = new int[5];\n        a[0] = 3;\n        System.out.println(a[0] + a.length);\n    }\n}\n'],
  ['java', 'array foreach', 'public class Main {\n    public static void main(String[] args) {\n        String[] namen = {"Ada", "Bob"};\n        for (String n : namen) {\n            System.out.println(n);\n        }\n    }\n}\n'],
  ['java', 'Arrays.sort', 'import java.util.Arrays;\npublic class Main {\n    public static void main(String[] args) {\n        int[] a = {3, 1};\n        Arrays.sort(a);\n        System.out.println(Arrays.toString(a));\n    }\n}\n'],
  ['java', 'String.format', 'public class Main {\n    public static void main(String[] args) {\n        double p = 3.5;\n        System.out.println(String.format("%.2f", p));\n        System.out.printf("%d Stück%n", 3);\n    }\n}\n'],
  ['java', 'Scanner', 'import java.util.Scanner;\npublic class Main {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        System.out.print("Zahl: ");\n        int n = sc.nextInt();\n        String s = sc.next();\n        double d = sc.nextDouble();\n        System.out.println(n + s + d);\n    }\n}\n'],
  ['java', 'parseInt', 'public class Main {\n    public static void main(String[] args) {\n        int n = Integer.parseInt("12");\n        double d = Double.parseDouble("1.5");\n        System.out.println(n + d);\n    }\n}\n'],
  ['java', 'String methods', 'public class Main {\n    public static void main(String[] args) {\n        String s = "Hallo";\n        System.out.println(s.length() + " " + s.charAt(0) + " " + s.substring(1, 3) + " " + s.toUpperCase() + " " + s.indexOf("l") + " " + s.equals("x") + " " + s.contains("al"));\n    }\n}\n'],
  ['java', 'StringBuilder', 'public class Main {\n    public static void main(String[] args) {\n        StringBuilder sb = new StringBuilder();\n        for (int i = 0; i < 3; i++) {\n            sb.append(i);\n        }\n        System.out.println(sb.toString());\n    }\n}\n'],
  ['java', 'ArrayList ops', 'import java.util.ArrayList;\npublic class Main {\n    public static void main(String[] args) {\n        ArrayList<Integer> xs = new ArrayList<>();\n        xs.add(3);\n        xs.add(1);\n        xs.set(0, 5);\n        xs.remove(0);\n        System.out.println(xs.size() + " " + xs.get(0) + " " + xs.contains(1) + " " + xs.indexOf(1));\n    }\n}\n'],
  ['java', 'HashMap ops', 'import java.util.HashMap;\npublic class Main {\n    public static void main(String[] args) {\n        HashMap<String, Integer> m = new HashMap<>();\n        m.put("a", 1);\n        System.out.println(m.getOrDefault("b", 0));\n        for (String k : m.keySet()) {\n            System.out.println(k + "=" + m.get(k));\n        }\n    }\n}\n'],
  ['java', 'while true', 'public class Main {\n    public static void main(String[] args) {\n        int n = 0;\n        while (true) {\n            n++;\n            if (n > 3) break;\n        }\n        System.out.println(n);\n    }\n}\n'],
  ['java', 'Math', 'public class Main {\n    public static void main(String[] args) {\n        System.out.println(Math.max(2, 5) + " " + Math.abs(-3) + " " + Math.sqrt(16) + " " + Math.round(2.6) + " " + Math.pow(2, 3));\n    }\n}\n'],
  ['java', 'char arithmetic', 'public class Main {\n    public static void main(String[] args) {\n        char c = \'A\';\n        System.out.println((char) (c + 1));\n    }\n}\n'],
  ['java', 'random', 'import java.util.Random;\npublic class Main {\n    public static void main(String[] args) {\n        Random r = new Random();\n        int z = r.nextInt(6) + 1;\n        System.out.println(z > 0);\n    }\n}\n'],
  ['java', 'Math.random', 'public class Main {\n    public static void main(String[] args) {\n        int z = (int) (Math.random() * 6) + 1;\n        System.out.println(z > 0);\n    }\n}\n'],
  ['java', '2d array', 'public class Main {\n    public static void main(String[] args) {\n        int[][] m = {{1, 2}, {3, 4}};\n        System.out.println(m[1][0]);\n    }\n}\n'],
  ['java', 'static method array param', 'public class Main {\n    static int summe(int[] a) {\n        int s = 0;\n        for (int x : a) s += x;\n        return s;\n    }\n    public static void main(String[] args) {\n        System.out.println(summe(new int[]{1, 2, 3}));\n    }\n}\n'],
  // ---------------- C#
  ['csharp', 'ReadLine parse', 'using System;\nclass Program\n{\n    static void Main()\n    {\n        Console.Write("Zahl: ");\n        int n = int.Parse(Console.ReadLine());\n        double d = Convert.ToDouble("1,5");\n        Console.WriteLine(n + 1);\n    }\n}\n'],
  ['csharp', 'format', 'using System;\nclass Program\n{\n    static void Main()\n    {\n        double p = 3.5;\n        Console.WriteLine($"Preis: {p:F2}");\n        Console.WriteLine(p.ToString("0.00"));\n        Console.WriteLine(Math.Round(p, 1));\n    }\n}\n'],
  ['csharp', 'array', 'using System;\nclass Program\n{\n    static void Main()\n    {\n        int[] a = { 3, 1, 2 };\n        Array.Sort(a);\n        Console.WriteLine(a.Length + " " + a[0]);\n        int[] b = new int[3];\n        b[1] = 4;\n        foreach (int x in b) Console.WriteLine(x);\n    }\n}\n'],
  ['csharp', 'List Dictionary', 'using System;\nusing System.Collections.Generic;\nclass Program\n{\n    static void Main()\n    {\n        var xs = new List<int> { 3, 1 };\n        xs.Add(2);\n        xs.Sort();\n        xs.RemoveAt(0);\n        Console.WriteLine(xs.Count + " " + xs.Contains(2));\n        var d = new Dictionary<string, int>();\n        d["a"] = 1;\n        if (d.ContainsKey("a")) Console.WriteLine(d["a"]);\n        foreach (var kv in d) Console.WriteLine(kv.Key + kv.Value);\n    }\n}\n'],
  ['csharp', 'string methods', 'using System;\nclass Program\n{\n    static void Main()\n    {\n        string s = " Hallo ";\n        string t = s.Trim();\n        Console.WriteLine(t.Length + t.ToUpper() + t.Substring(1, 2) + t.IndexOf("l") + t.Replace("H", "h") + t.StartsWith("H"));\n        string[] teile = "a,b".Split(\',\');\n        Console.WriteLine(string.Join("-", teile));\n    }\n}\n'],
  ['csharp', 'TryParse', 'using System;\nclass Program\n{\n    static void Main()\n    {\n        if (int.TryParse("12", out int n)) Console.WriteLine(n);\n    }\n}\n'],
  ['csharp', 'random', 'using System;\nclass Program\n{\n    static void Main()\n    {\n        Random r = new Random();\n        int z = r.Next(1, 7);\n        Console.WriteLine(z > 0);\n    }\n}\n'],
  // ---------------- C++
  ['cpp', 'array', '#include <iostream>\nusing namespace std;\nint main() {\n    int a[3] = {3, 1, 2};\n    int s = 0;\n    for (int i = 0; i < 3; i++) s += a[i];\n    cout << s << endl;\n    return 0;\n}\n'],
  ['cpp', 'vector ops', '#include <iostream>\n#include <vector>\n#include <algorithm>\nusing namespace std;\nint main() {\n    vector<int> v = {3, 1};\n    v.push_back(2);\n    sort(v.begin(), v.end());\n    v.pop_back();\n    cout << v.size() << " " << v[0] << " " << v.back() << endl;\n    for (int x : v) cout << x << " ";\n    cout << endl;\n    return 0;\n}\n'],
  ['cpp', 'cin', '#include <iostream>\n#include <string>\nusing namespace std;\nint main() {\n    int n;\n    string name;\n    cout << "Zahl: ";\n    cin >> n;\n    getline(cin, name);\n    cout << n * 2 << endl;\n    return 0;\n}\n'],
  ['cpp', 'setprecision', '#include <iostream>\n#include <iomanip>\nusing namespace std;\nint main() {\n    double p = 3.5;\n    cout << fixed << setprecision(2) << p << endl;\n    return 0;\n}\n'],
  ['cpp', 'string methods', '#include <iostream>\n#include <string>\nusing namespace std;\nint main() {\n    string s = "Hallo";\n    cout << s.length() << s.substr(1, 2) << s.find("l") << s[0] << endl;\n    s += "!";\n    cout << s << endl;\n    return 0;\n}\n'],
  ['cpp', 'map', '#include <iostream>\n#include <map>\nusing namespace std;\nint main() {\n    map<string, int> m;\n    m["a"] = 1;\n    if (m.count("a")) cout << m["a"] << endl;\n    for (auto& [k, v] : m) cout << k << v << endl;\n    return 0;\n}\n'],
  ['cpp', 'rand', '#include <iostream>\n#include <cstdlib>\n#include <ctime>\nusing namespace std;\nint main() {\n    srand(time(0));\n    int z = rand() % 6 + 1;\n    cout << (z > 0) << endl;\n    return 0;\n}\n'],
  // ---------------- JavaScript
  ['javascript', 'toFixed', 'const p = 3.5;\nconsole.log(p.toFixed(2));\nconsole.log(`Preis: ${p.toFixed(1)}`);\n'],
  ['javascript', 'array methods', 'const xs = [3, 1, 2];\nxs.push(4);\nconst y = xs.pop();\nxs.unshift(0);\nconsole.log(xs.length, xs.includes(2), xs.indexOf(1), xs.join("-"), y);\nconst ys = xs.slice(1, 3);\nconsole.log(ys);\n'],
  ['javascript', 'map filter', 'const xs = [1, 2, 3];\nconst q = xs.map(x => x * x);\nconst g = xs.filter(x => x % 2 === 0);\nconst s = xs.reduce((a, b) => a + b, 0);\nconsole.log(q, g, s);\n'],
  ['javascript', 'forEach', 'const xs = [1, 2];\nxs.forEach(x => console.log(x));\n'],
  ['javascript', 'sort numbers', 'const xs = [10, 2];\nxs.sort((a, b) => a - b);\nconsole.log(xs);\n'],
  ['javascript', 'string methods', 'const s = " Hallo ";\nconst t = s.trim();\nconsole.log(t.length, t.toUpperCase(), t.slice(1, 3), t.includes("al"), t.split("l"), t.charAt(0), t.replace("H", "h"), t.startsWith("H"));\n'],
  ['javascript', 'parse', 'const n = parseInt("12");\nconst d = parseFloat("1.5");\nconst m = Number("3");\nconsole.log(n + d + m);\n'],
  ['javascript', 'Math', 'console.log(Math.max(2, 5), Math.round(2.5), Math.floor(Math.random() * 6) + 1 > 0, Math.abs(-1));\n'],
  ['javascript', 'object literal', 'const person = { name: "Ada", alter: 36 };\nconsole.log(person.name);\nperson.alter += 1;\n'],
  ['javascript', 'for in / of keys', 'const m = new Map();\nm.set("a", 1);\nfor (const [k, v] of m) console.log(k, v);\n'],
  ['javascript', 'function expression', 'const quadrat = function (x) {\n  return x * x;\n};\nconsole.log(quadrat(3));\n'],
  ['javascript', 'arrow function', 'const quadrat = (x) => x * x;\nconsole.log(quadrat(3));\n'],
  ['javascript', 'prompt', 'const name = prompt("Name?");\nconsole.log("Hallo " + name);\n'],
  // ---------------- VBA
  ['vba', 'Format', 'Sub Main()\n    Dim p As Double\n    p = 3.5\n    Debug.Print Format(p, "0.00")\n    Debug.Print Round(p, 1)\nEnd Sub\n'],
  ['vba', 'array', 'Sub Main()\n    Dim a(1 To 3) As Integer\n    Dim i As Integer\n    For i = 1 To 3\n        a(i) = i * 2\n    Next i\n    Debug.Print a(2)\nEnd Sub\n'],
  ['vba', 'string fns', 'Sub Main()\n    Dim s As String\n    s = "Hallo"\n    Debug.Print Len(s), Left(s, 2), Mid(s, 2, 2), UCase(s), InStr(s, "l"), Replace(s, "H", "h"), Trim(" x ")\nEnd Sub\n'],
  ['vba', 'InputBox MsgBox', 'Sub Main()\n    Dim n As Integer\n    n = CInt(InputBox("Zahl?"))\n    MsgBox "Doppelt: " & n * 2\nEnd Sub\n'],
  ['vba', 'Split Join', 'Sub Main()\n    Dim teile As Variant\n    teile = Split("a,b,c", ",")\n    Debug.Print UBound(teile) + 1\n    Debug.Print Join(teile, "-")\nEnd Sub\n'],
  ['vba', 'Rnd', 'Sub Main()\n    Randomize\n    Dim z As Integer\n    z = Int(Rnd * 6) + 1\n    Debug.Print z > 0\nEnd Sub\n'],
];

/** Still without own blocks (lambdas, sets, zip, 1-based VBA arrays, ...). */
const OPEN = new Set([
  'python zip', 'python lambda sort key', 'python set',
  'java char arithmetic', 'csharp TryParse',
  'javascript array methods', 'javascript map filter', 'javascript forEach', 'javascript sort numbers',
  'javascript string methods', 'javascript object literal',
  'vba array', 'vba InputBox MsgBox',
]);

function gaps(code: string, lang: Lang): string[] {
  const res = parse(code, lang);
  const out: string[] = res.diagnostics.map((d) => d.message);
  const stmts = allStmts(res.program);
  walkStmts(stmts, (s) => {
    if (s.k === 'raw') out.push(s.code);
    if (s.k === 'libstmt' && s.lib.startsWith('ext:')) out.push(`${s.lib}.${s.fn}`);
    if (s.k === 'methodstmt') out.push(`.${s.name}()`);
  });
  walkAllExprs(stmts, (e) => {
    if (e.k === 'raw') out.push(e.code);
    if (e.k === 'lib' && e.lib.startsWith('ext:')) out.push(`${e.lib}.${e.fn}`);
    if (e.k === 'method') out.push(`.${e.name}()`);
  });
  return out;
}

describe('typical beginner code becomes blocks', () => {
  for (const [lang, title, code] of SNIPPETS) {
    const name = `${lang} ${title}`;
    it.skipIf(OPEN.has(name))(name, () => {
      expect(gaps(code, lang)).toEqual([]);
      const once = generate(parse(code, lang).program, lang).code;
      expect(generate(parse(once, lang).program, lang).code).toBe(once);
    });
  }
  it('the list of open cases is up to date', () => {
    for (const [lang, title, code] of SNIPPETS) if (OPEN.has(`${lang} ${title}`)) expect(gaps(code, lang).length, `${lang} ${title}`).toBeGreaterThan(0);
  });
});
