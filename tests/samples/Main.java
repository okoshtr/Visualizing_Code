import java.util.Scanner;
import java.util.ArrayList;

public class Main {
    static int zaehler = 0;

    // Gibt das Doppelte zurück
    static int doppelt(int x) {
        return x * 2;
    }

    static void zeige(String text) {
        zaehler++;
        System.out.println(zaehler + ": " + text);
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        ArrayList<String> namen = new ArrayList<>();
        namen.add("Ada");
        namen.add("Linus");
        for (String n : namen) {
            zeige(n.toUpperCase());
        }
        for (int i = 0; i < 3; i++) {
            System.out.print(i + " ");
        }
        System.out.println();
        int a = 7, b = 2;
        System.out.println(a / b);
        System.out.println((double) a / b);
        double d = a;
        System.out.println(doppelt(21));
        if (namen.size() > 1 && !namen.get(0).equals("Bob")) {
            System.out.println("erster: " + namen.get(0));
        } else if (namen.isEmpty()) {
            System.out.println("leer");
        } else {
            System.out.println("sonst");
        }
        int k = 10;
        while (k > 0) {
            k -= 4;
        }
        System.out.println("k=" + k + " d=" + d);
    }
}
