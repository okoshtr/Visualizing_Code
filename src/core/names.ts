import type { Lang } from './ir';

const words = (s: string) => s.split(/\s+/).filter(Boolean);

const RESERVED: Record<Lang, Set<string>> = {
  python: new Set(
    words(`False None True and as assert async await break class continue def del elif else except finally for from
      global if import in is lambda nonlocal not or pass raise return try while with yield
      print input int float str len range round abs max min sum list random math time bool type`),
  ),
  java: new Set(
    words(`abstract assert boolean break byte case catch char class const continue default do double else enum extends
      final finally float for goto if implements import instanceof int interface long native new package private
      protected public return short static strictfp super switch synchronized this throw throws transient try void
      volatile while true false null var record yield Main String Math System scanner random input sleep List
      ArrayList Arrays Collections Scanner Random Integer Double Boolean Object Pattern args`),
  ),
  javascript: new Set(
    words(`break case catch class const continue debugger default delete do else export extends false finally for
      function if import in instanceof new null return super switch this throw true try typeof var void while with
      yield let static enum await implements package protected interface private public arguments eval undefined
      NaN Infinity console Math process input sleep String Number parseInt parseFloat Date Atomics sortList
      shuffleList require`),
  ),
  csharp: new Set(
    words(`abstract as base bool break byte case catch char checked class const continue decimal default delegate do
      double else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface
      internal is lock long namespace new null object operator out override params private protected public readonly
      ref return sbyte sealed short sizeof stackalloc static string struct switch this throw true try typeof uint
      ulong unchecked unsafe ushort using virtual void volatile while var Console Math Program Main Input random
      List Random Thread Shuffle Enumerable`),
  ),
  cpp: new Set(
    words(`alignas alignof and and_eq asm auto bitand bitor bool break case catch char char16_t char32_t class compl
      const constexpr const_cast continue decltype default delete do double dynamic_cast else enum explicit export
      extern false float for friend goto if inline int long mutable namespace new noexcept not not_eq nullptr
      operator or or_eq private protected public register reinterpret_cast return short signed sizeof static
      static_assert static_cast struct switch template this thread_local throw true try typedef typeid typename union
      unsigned using virtual void volatile wchar_t while xor xor_eq main cout cin endl string vector input std rand
      srand time sort reverse find max min sin cos tan sqrt abs pow round floor ceil log exp toUpper toLower trim
      split joinList repeatText indexOf endsWith replaceAll nowSeconds`),
  ),
  vba: new Set(
    words(`and as boolean byref byval call case const dim do double each else elseif end error exit false for function
      get goto if in integer is let like long loop me mod new next not nothing null on option or private public
      redim rem resume return select set single static step stop string sub then to true type until variant wend
      while with xor debug print inputbox msgbox len array ubound lbound main abs sqr int fix rnd randomize round log
      exp clng cdbl cstr mid left right trim ucase lcase replace split join instr sin cos tan atn timer now name
      date time iif strreverse`),
  ),
};

/** Turns a user-chosen name (may contain spaces, umlauts, ...) into a valid identifier. */
export function ident(name: string, lang: Lang): string {
  let id = name.trim().replace(/[^\p{L}\p{N}_]+/gu, '_').replace(/^_+(?=.)/u, (m) => (lang === 'vba' ? '' : m));
  if (!id || id === '_') id = lang === 'python' ? '_' : 'x';
  if (/^\p{N}/u.test(id)) id = (lang === 'vba' ? 'v' : '_') + id;
  if (lang === 'vba' && id.startsWith('_')) id = 'v' + id;
  const key = lang === 'vba' ? id.toLowerCase() : id;
  if (RESERVED[lang].has(key)) id += '_';
  return id;
}

export function isReserved(name: string, lang: Lang): boolean {
  return RESERVED[lang].has(lang === 'vba' ? name.toLowerCase() : name);
}

/** Picks a name that is not in `taken` (and records it). */
export function freshName(base: string, taken: Set<string>): string {
  let name = base;
  let i = 2;
  while (taken.has(name)) name = `${base}${i++}`;
  taken.add(name);
  return name;
}
