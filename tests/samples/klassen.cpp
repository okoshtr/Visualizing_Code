#include <iostream>
#include <string>
#include <vector>
using namespace std;

class Hund {
public:
    string name;
    int alter = 0;

    Hund(string name) {
        this->name = name;
    }

    void geburtstag() {
        alter++;
    }

    string beschreibung() {
        return name + " ist " + to_string(alter) + " Jahre alt";
    }
};

int main() {
    Hund bello("Bello");
    Hund luna = Hund("Luna");
    bello.geburtstag();
    bello.geburtstag();
    vector<Hund> hunde = {bello, luna};
    for (Hund h : hunde) {
        cout << h.beschreibung() << endl;
    }
    if (bello.alter > luna.alter) {
        cout << bello.name << " ist älter" << endl;
    }
    return 0;
}
