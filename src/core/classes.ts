// Class hierarchy (inheritance): base classes, where methods and properties are defined,
// constructors that are inherited. Used by the analysis, the generators and the runner.

import type { ClassDef, Program, Stmt } from './ir';
import { walkStmts } from './ir';

export class Hierarchy {
  private byName: Map<string, ClassDef>;

  constructor(public classes: ClassDef[]) {
    this.byName = new Map(classes.map((c) => [c.name, c]));
  }

  static of(program: Program): Hierarchy {
    return new Hierarchy(program.classes ?? []);
  }

  get(name: string): ClassDef | undefined {
    return this.byName.get(name);
  }

  /** The base class (only if it is one of the program's classes). */
  base(name: string): ClassDef | undefined {
    const b = this.byName.get(name)?.base;
    return b ? this.byName.get(b) : undefined;
  }

  /** The class and its base classes, nearest first (stops at cycles). */
  chain(name: string): ClassDef[] {
    const out: ClassDef[] = [];
    for (let c = this.byName.get(name); c && !out.includes(c); c = c.base ? this.byName.get(c.base) : undefined) out.push(c);
    return out;
  }

  isSubclass(sub: string, base: string): boolean {
    return this.chain(sub).some((c) => c.name === base);
  }

  /** Nearest class both objects belong to, e.g. Tier for Hund and Katze. */
  commonBase(a: string, b: string): string | null {
    const names = this.chain(a).map((c) => c.name);
    return this.chain(b).find((c) => names.includes(c.name))?.name ?? null;
  }

  subclasses(name: string): ClassDef[] {
    return this.classes.filter((c) => c.name !== name && this.isSubclass(c.name, name));
  }

  /** The class whose method `method` an object of class `cls` runs. */
  methodOwner(cls: string, method: string): ClassDef | undefined {
    return this.chain(cls).find((c) => c.methods.some((m) => m.name === method));
  }

  /** Is the method redefined in a subclass (C#/C++ need "virtual")? */
  isOverridden(cls: string, method: string): boolean {
    return this.subclasses(cls).some((c) => c.methods.some((m) => m.name === method));
  }

  /** Does the method redefine a method of a base class (C# needs "override")? */
  overrides(cls: string, method: string): boolean {
    return this.chain(cls)
      .slice(1)
      .some((c) => c.methods.some((m) => m.name === method));
  }

  /** Properties a class declares itself: start values and "dieses Objekt.x = …" in its own code. */
  ownFields(c: ClassDef): string[] {
    const names = c.fields.map((f) => f.name);
    walkStmts([...c.ctor, ...c.methods.flatMap((m) => m.body)], (s) => {
      if (s.k === 'fset' && s.obj?.k === 'self' && !names.includes(s.name)) names.push(s.name);
    });
    return names;
  }

  /** The class that declares a property (the topmost base class that has it). */
  fieldOwner(cls: string, name: string): string {
    let owner = cls;
    for (const c of this.chain(cls)) if (this.ownFields(c).includes(name)) owner = c.name;
    return owner;
  }

  /** Properties a class must declare (those of base classes are inherited). */
  declaredFields(c: ClassDef): string[] {
    return this.ownFields(c).filter((n) => this.fieldOwner(c.name, n) === c.name);
  }

  /** Has the class methods without content (then no object can be made of it)? */
  isAbstract(c: ClassDef): boolean {
    return c.methods.some((m) => m.abstract);
  }

  /** Does the method give back a value (an abstract method: if one of its versions does)? */
  methodReturns(cls: string, method: string): boolean {
    const own = this.get(cls)?.methods.find((m) => m.name === method);
    if (own && !own.abstract) return own.returns;
    return [this.get(cls)!, ...this.subclasses(cls)].some((c) => c?.methods.some((m) => m.name === method && !m.abstract && m.returns)) || !!own?.returns;
  }

  hasOwnCtor(c: ClassDef): boolean {
    return c.ctorParams.length > 0 || c.ctor.length > 0;
  }

  /** Values a new object of the class needs (a class without own constructor uses the base's). */
  ctorParams(name: string): string[] {
    const c = this.byName.get(name);
    if (!c) return [];
    if (this.hasOwnCtor(c) || !this.base(name)) return c.ctorParams;
    return this.ctorParams(c.base!);
  }

  /** The class whose constructor runs for "neues Objekt cls". */
  ctorOwner(name: string): ClassDef | undefined {
    return this.chain(name).find((c) => this.hasOwnCtor(c)) ?? this.byName.get(name);
  }
}

/** "rufe Basisklasse beim Erzeugen auf" at the start of a constructor, if any. */
export function superInitOf(ctor: Stmt[]): (Stmt & { k: 'superinit' }) | null {
  const first = ctor.find((s) => s.k !== 'comment');
  return first?.k === 'superinit' ? first : null;
}
