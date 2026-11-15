function teile(a, b = 2) {
  if (b === 0) {
    throw new Error("Division durch null");
  }
  return a / b;
}

const farben = new Map([["rot", 1], ["blau", 2]]);
farben.set("grün", 3);
for (const f of farben.keys()) {
  console.log(f + "=" + farben.get(f));
}
let tag = 3;
switch (tag) {
  case 6:
  case 7:
    console.log("Wochenende");
    break;
  default:
    console.log("Werktag");
}
try {
  console.log(teile(9));
  console.log(teile(1, 0));
} catch (err) {
  console.log("Fehler: " + err.message);
}
