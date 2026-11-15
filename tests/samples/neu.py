# Neue Konstrukte: Wörterbücher, Fehler, match, Tupel
def begruessung(name, gruss="Hallo"):
    return gruss + ", " + name + "!"


alter = {"Anna": 12, "Ben": 15}
alter["Clara"] = 11
del alter["Ben"]
for name, jahre in alter.items():
    print(name, "ist", jahre)
print("Anna" in alter, len(alter))

punkte = [3, 9, 4]
for i, p in enumerate(punkte):
    print(i, p)
print(sum(punkte), min(punkte), max(punkte))

a, b = 0, 1
for _ in range(6):
    a, b = b, a + b
print("Fibonacci:", a)

try:
    zahl = int("zwölf")
except ValueError as fehler:
    print("Fehler:", fehler)

zaehler = 0
while True:
    zaehler += 1
    if not zaehler < 3:
        break
print("Zähler", zaehler)

match zaehler:
    case 1:
        print("eins")
    case 2 | 3:
        print("zwei oder drei")
    case _:
        print("viel")

print(begruessung("Ada"))
print(begruessung("Linus", gruss="Moin"))
