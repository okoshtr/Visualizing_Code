import java.util.*;

public class Neu {
    static String note(int punkte, String fach) {
        switch (punkte) {
            case 1:
            case 2:
                return fach + ": sehr gut";
            case 3:
                return fach + ": gut";
            default:
                return fach + ": weiter üben";
        }
    }

    public static void main(String[] args) {
        HashMap<String, Integer> lager = new HashMap<>();
        lager.put("Äpfel", 5);
        lager.put("Birnen", 2);
        if (lager.containsKey("Äpfel")) {
            System.out.println("Äpfel: " + lager.get("Äpfel"));
        }
        int n = 0;
        do {
            n += 2;
        } while (n < 5);
        System.out.println("n = " + n);
        try {
            int x = Integer.parseInt("abc");
            System.out.println(x);
        } catch (NumberFormatException e) {
            System.out.println("Keine Zahl: " + e.getMessage());
        }
        System.out.println(note(2, "Mathe"));
        System.out.println(note(5, "Kunst"));
    }
}
