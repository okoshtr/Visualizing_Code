class Hund {
  constructor(name) {
    this.name = name;
    this.alter = 0;
  }

  geburtstag() {
    this.alter++;
  }

  beschreibung() {
    return `${this.name} ist ${this.alter} Jahre alt`;
  }
}

const bello = new Hund("Bello");
const luna = new Hund("Luna");
bello.geburtstag();
bello.geburtstag();
const hunde = [bello, luna];
for (const h of hunde) {
  console.log(h.beschreibung());
}
if (bello.alter > luna.alter) {
  console.log(bello.name + " ist älter");
}
