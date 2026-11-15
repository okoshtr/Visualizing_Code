import java.util.ArrayList;

public class Main {
    static class Hund {
        private String name;
        private int alter = 0;

        Hund(String name) {
            this.name = name;
        }

        void geburtstag() {
            alter++;
        }

        String beschreibung() {
            return name + " ist " + alter + " Jahre alt";
        }
    }

    public static void main(String[] args) {
        Hund bello = new Hund("Bello");
        Hund luna = new Hund("Luna");
        bello.geburtstag();
        bello.geburtstag();
        ArrayList<Hund> hunde = new ArrayList<>();
        hunde.add(bello);
        hunde.add(luna);
        for (Hund h : hunde) {
            System.out.println(h.beschreibung());
        }
        if (bello.alter > luna.alter) {
            System.out.println(bello.name + " ist älter");
        }
    }
}
