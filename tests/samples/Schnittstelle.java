import java.util.ArrayList;
import java.util.List;

public class Main {
    interface Form {
        double flaeche();

        String name();
    }

    static class Kreis implements Form {
        private double radius;

        Kreis(double radius) {
            this.radius = radius;
        }

        public double flaeche() {
            return 3.0 * radius * radius;
        }

        public String name() {
            return "Kreis";
        }
    }

    static class Quadrat implements Form {
        private double seite;

        Quadrat(double seite) {
            this.seite = seite;
        }

        public double flaeche() {
            return seite * seite;
        }

        public String name() {
            return "Quadrat";
        }
    }

    public static void main(String[] args) {
        List<Form> formen = new ArrayList<>();
        formen.add(new Kreis(1.0));
        formen.add(new Quadrat(2.0));
        for (Form f : formen) {
            System.out.println(f.name() + ": " + f.flaeche());
        }
    }
}
