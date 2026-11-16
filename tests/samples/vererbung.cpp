#include <iostream>
#include <memory>
#include <string>
#include <vector>
using namespace std;

class Tier {
public:
    string name;
    int beine = 4;

    Tier(string name) : name(name) {}

    virtual string laut() {
        return "...";
    }

    virtual void vorstellen() {
        cout << name << " sagt " << laut() << endl;
    }
};

class Hund : public Tier {
public:
    Hund(string name) : Tier(name) {}

    string laut() override {
        return "Wuff";
    }
};

class Vogel : public Tier {
public:
    bool kannFliegen;

    Vogel(string name, bool kannFliegen) : Tier(name), kannFliegen(kannFliegen) {
        beine = 2;
    }

    string laut() override {
        return "Piep";
    }

    void vorstellen() override {
        Tier::vorstellen();
        if (kannFliegen) {
            cout << name << " fliegt davon" << endl;
        }
    }
};

int main() {
    vector<shared_ptr<Tier>> tiere = {make_shared<Tier>("Etwas"), make_shared<Hund>("Bello"), make_shared<Vogel>("Tweety", true)};
    for (auto t : tiere) {
        t->vorstellen();
    }
    int beine = 0;
    for (auto t : tiere) {
        beine += t->beine;
    }
    cout << "Beine zusammen: " << beine << endl;
    return 0;
}
