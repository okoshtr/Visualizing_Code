# Tiere mit Vererbung
class Tier:
    def __init__(self, name):
        self.name = name
        self.beine = 4

    def laut(self):
        return "..."

    def vorstellen(self):
        print(self.name + " sagt " + self.laut())


class Hund(Tier):
    def laut(self):
        return "Wuff"


class Vogel(Tier):
    def __init__(self, name, kann_fliegen):
        super().__init__(name)
        self.beine = 2
        self.kann_fliegen = kann_fliegen

    def laut(self):
        return "Piep"

    def vorstellen(self):
        super().vorstellen()
        if self.kann_fliegen:
            print(self.name + " fliegt davon")


tiere = [Tier("Etwas"), Hund("Bello"), Vogel("Tweety", True)]
for t in tiere:
    t.vorstellen()
beine = 0
for t in tiere:
    beine += t.beine
print("Beine zusammen: " + str(beine))
