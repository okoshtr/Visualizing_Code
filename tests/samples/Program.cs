using System;
using System.Collections.Generic;

namespace Demo
{
    class Program
    {
        static bool IstGerade(int n)
        {
            return n % 2 == 0;
        }

        static void Main(string[] args)
        {
            var liste = new List<int> { 3, 6, 9 };
            liste.Add(12);
            foreach (var x in liste)
            {
                if (IstGerade(x))
                    Console.WriteLine($"{x} ist gerade");
                else
                    Console.WriteLine($"{x} ist ungerade");
            }
            Console.WriteLine("Anzahl: " + liste.Count);
            string text = "Blöcke";
            Console.WriteLine(text.ToUpper() + " " + text.Length);
        }
    }
}
