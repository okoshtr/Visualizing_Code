using System;
using System.Collections.Generic;

class Hund
{
    public string Name { get; set; }
    public int Alter { get; set; } = 0;

    public Hund(string name)
    {
        Name = name;
    }

    public void Geburtstag()
    {
        Alter += 1;
    }

    public string Beschreibung()
    {
        return $"{Name} ist {Alter} Jahre alt";
    }
}

class Program
{
    static void Main()
    {
        var bello = new Hund("Bello");
        var luna = new Hund("Luna");
        bello.Geburtstag();
        bello.Geburtstag();
        var hunde = new List<Hund> { bello, luna };
        foreach (var h in hunde)
        {
            Console.WriteLine(h.Beschreibung());
        }
        if (bello.Alter > luna.Alter)
        {
            Console.WriteLine(bello.Name + " ist älter");
        }
    }
}
