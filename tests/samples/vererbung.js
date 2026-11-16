class Tier {
  constructor(name) {
    this.name = name;
    this.beine = 4;
  }

  laut() {
    return "...";
  }

  vorstellen() {
    console.log(`${this.name} sagt ${this.laut()}`);
  }
}

class Hund extends Tier {
  laut() {
    return "Wuff";
  }
}

class Vogel extends Tier {
  constructor(name, kannFliegen) {
    super(name);
    this.beine = 2;
    this.kannFliegen = kannFliegen;
  }

  laut() {
    return "Piep";
  }

  vorstellen() {
    super.vorstellen();
    if (this.kannFliegen) {
      console.log(`${this.name} fliegt davon`);
    }
  }
}

const tiere = [new Tier("Etwas"), new Hund("Bello"), new Vogel("Tweety", true)];
for (const t of tiere) {
  t.vorstellen();
}
let beine = 0;
for (const t of tiere) {
  beine += t.beine;
}
console.log("Beine zusammen: " + beine);
