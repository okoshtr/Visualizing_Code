// Fibonacci
function fib(n) {
  if (n < 2) return n;
  return fib(n - 1) + fib(n - 2);
}

const liste = [];
for (let i = 0; i < 10; i++) {
  liste.push(fib(i));
}
console.log("Fibonacci:", liste.join(", "));
let text = `Die 10. Zahl ist ${fib(10)}`;
console.log(text);
const tiere = ["Hund", "Katze", "Maus"];
for (const tier of tiere) {
  if (tier.length > 4) {
    console.log(tier.toUpperCase());
  }
}
let zahl = 17;
console.log(zahl % 5 === 2 ? "Rest 2" : "anders");
console.log(Math.max(3, 9), Math.floor(7 / 2));
