# Hunde mit einer eigenen Klasse
class Hund:
    def __init__(self, name):
        self.name = name
        self.alter = 0

    def geburtstag(self):
        self.alter += 1

    def beschreibung(self):
        return f"{self.name} ist {self.alter} Jahre alt"


bello = Hund("Bello")
luna = Hund("Luna")
bello.geburtstag()
bello.geburtstag()
hunde = [bello, luna]
for h in hunde:
    print(h.beschreibung())
if bello.alter > luna.alter:
    print(bello.name + " ist älter")
