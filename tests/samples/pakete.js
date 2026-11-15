const _ = require("lodash");
const { readFileSync, writeFileSync } = require("fs");

const zahlen = [3, 1, 2];
console.log(_.sum(zahlen));
writeFileSync("zahlen.txt", _.join(zahlen, ", "));
console.log(readFileSync("zahlen.txt", "utf8"));
