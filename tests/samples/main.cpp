#include <iostream>
#include <vector>
#include <string>
using namespace std;

int summe(vector<int>& v) {
    int s = 0;
    for (int x : v) s += x;
    return s;
}

int main() {
    vector<int> werte = {4, 8, 15};
    werte.push_back(16);
    cout << "Summe: " << summe(werte) << endl;
    for (int i = werte.size() - 1; i >= 0; i--) {
        cout << werte[i] << " ";
    }
    cout << "\n";
    string name = "Welt";
    cout << "Hallo " << name << "!" << endl;
    int n = 5;
    long f = 1;
    for (int i = 1; i <= n; ++i) f *= i;
    cout << n << "! = " << f << endl;
    return 0;
}
