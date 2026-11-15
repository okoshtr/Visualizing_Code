import math
import random

# Ein kleines Rechenprogramm
def quadrat(x):
    return x * x

def begruesse(name):
    print(f"Hallo {name}, willkommen!")

zahlen = [n * 2 for n in range(1, 6) if n != 3]
print("Zahlen:", zahlen)
summe = 0
for z in zahlen:
    summe += z
print("Summe ist", summe, sep=" = ")
begruesse("Ada")
print(quadrat(7))
wort = "Hallo Welt"
print(wort.upper(), len(wort))
print(wort[0:5], wort[::-1])
if "Welt" in wort:
    print("gefunden")
i = 10
while True:
    i -= 3
    if i < 0:
        break
print("Ende bei", i)
print(round(math.sqrt(16)), 7 // 2, 7 / 2, 2 ** 10)
x = random.randint(1, 6)
print(x >= 1 and x <= 6)
