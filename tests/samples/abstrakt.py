# Abstrakte Methoden: Jede Form berechnet ihre Fläche selbst
from abc import ABC, abstractmethod


class Form(ABC):
    def __init__(self, name):
        self.name = name

    @abstractmethod
    def flaeche(self):
        pass

    def beschreibung(self):
        print(self.name + ": " + str(self.flaeche()))


class Rechteck(Form):
    def __init__(self, breite, hoehe):
        super().__init__("Rechteck")
        self.breite = breite
        self.hoehe = hoehe

    def flaeche(self):
        return self.breite * self.hoehe


class Quadrat(Rechteck):
    def __init__(self, seite):
        super().__init__(seite, seite)
        self.name = "Quadrat"


formen = [Rechteck(2, 3), Quadrat(4)]
for f in formen:
    f.beschreibung()
