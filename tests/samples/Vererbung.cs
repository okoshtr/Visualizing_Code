using System;
using System.Collections.Generic;

class Tier
{
    public string Name { get; set; }
    public int Beine { get; set; } = 4;

    public Tier(string name)
    {
        Name = name;
    }

    public virtual string Laut()
    {
        return "...";
    }

    public virtual void Vorstellen()
    {
        Console.WriteLine($"{Name} sagt {Laut()}");
    }
}

class Hund : Tier
{
    public Hund(string name) : base(name)
    {
    }

    public override string Laut()
    {
        return "Wuff";
    }
}

class Vogel : Tier
{
    private bool kannFliegen;

    public Vogel(string name, bool kannFliegen) : base(name)
    {
        Beine = 2;
        this.kannFliegen = kannFliegen;
    }

    public override string Laut()
    {
        return "Piep";
    }

    public override void Vorstellen()
    {
        base.Vorstellen();
        if (kannFliegen)
        {
            Console.WriteLine($"{Name} fliegt davon");
        }
    }
}

class Program
{
    static void Main()
    {
        var tiere = new List<Tier> { new Tier("Etwas"), new Hund("Bello"), new Vogel("Tweety", true) };
        foreach (var t in tiere)
        {
            t.Vorstellen();
        }
        int beine = 0;
        foreach (var t in tiere)
        {
            beine += t.Beine;
        }
        Console.WriteLine("Beine zusammen: " + beine);
    }
}
