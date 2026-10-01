import type { ContextInput } from "@fitness-os/ai";

export const input: ContextInput = {
  date: "2026-01-15", hour: 19, waterMl: 500, currentWeightKg: 81, avg7WeightKg: 81.2, targetWeightKg: 75, week: null, diet: "non_vegetarian", foods: [],
  day: { goal: "lose_fat", targets: { calories: 2100, proteinG: 150, carbsG: 220, fatG: 60, fibreG: 30, steps: 9000 },
    totals: { calories: 1760, proteinG: 137, carbsG: 180, fatG: 55, fibreG: 25 }, mealsLogged: 4, stepsToday: 11420, activeMinutes: null,
    workoutsLast7: 3, trainingDays: 3, weightTrendKgPerWeek: null, hour: 19, dayComplete: false },
};
