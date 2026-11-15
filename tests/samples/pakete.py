# Lineare Optimierung mit dem Paket PuLP
import pulp
from pulp import lpSum

prob = pulp.LpProblem("Gewinn", sense=pulp.LpMaximize)
x = prob.add_variable("x", lowBound=0)
y = prob.add_variable("y", lowBound=0, cat="Integer")
prob += lpSum([3 * x, 2 * y])
prob += x + y <= 4
prob += x + 3 * y <= 6
prob.solve(pulp.HiGHS(msg=False))
print(pulp.value(x))
print(pulp.value(y))
