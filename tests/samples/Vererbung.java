import java.util.ArrayList;
import java.util.List;

public class Main {
    static class Tier {
        protected String name;
        protected int beine = 4;

        Tier(String name) {
            this.name = name;
        }

        String laut() {
            return "...";
        }

        void vorstellen() {
            System.out.println(name + " sagt " + laut());
        }
    }

    static class Hund extends Tier {
        Hund(String name) {
            super(name);
        }

        @Override
        String laut() {
            return "Wuff";
        }
    }

    static class Vogel extends Tier {
        private boolean kannFliegen;

        Vogel(String name, boolean kannFliegen) {
            super(name);
            beine = 2;
            this.kannFliegen = kannFliegen;
        }

        @Override
        String laut() {
            return "Piep";
        }

        @Override
        void vorstellen() {
            super.vorstellen();
            if (kannFliegen) {
                System.out.println(name + " fliegt davon");
            }
        }
    }

    public static void main(String[] args) {
        List<Tier> tiere = new ArrayList<>();
        tiere.add(new Tier("Etwas"));
        tiere.add(new Hund("Bello"));
        tiere.add(new Vogel("Tweety", true));
        for (Tier t : tiere) {
            t.vorstellen();
        }
        int beine = 0;
        for (Tier t : tiere) {
            beine += t.beine;
        }
        System.out.println("Beine zusammen: " + beine);
    }
}
