import { expect, it } from 'vitest';
import { balanceWeight, editorWeights, setWeight, totalWeight } from './ranking-weights';

it('converts relative weights to percentages without mutating saved weights', () => {
  const saved = {
    skills: 30,
    experience: 19,
    projects: 14,
    seniority: 10,
    role: 8,
    depth: 7,
    education: 4,
    lexical: 3,
  };
  const draft = editorWeights(saved);
  expect(totalWeight(draft)).toBe(100);
  expect(draft.skills).toBe(31.6);
  expect(saved.skills).toBe(30);
  expect(editorWeights(draft)).toEqual(draft);
  expect(totalWeight({ skills: 99.96 })).not.toBe(100);
  expect(totalWeight(editorWeights({ skills: 33.333, experience: 66.667 }))).toBe(100);
});
it('caps sliders and numeric values at the remaining budget and handles invalid numbers', () => {
  const weights = { skills: 30, experience: 70 };
  expect(setWeight(weights, 'skills', 100).skills).toBe(30);
  const reduced = setWeight(weights, 'experience', 50);
  expect(totalWeight(reduced)).toBe(80);
  expect(setWeight(reduced, 'skills', 100)).toEqual({ skills: 50, experience: 50 });
  expect(setWeight(weights, 'skills', -5).skills).toBe(0);
  expect(setWeight(weights, 'skills', NaN)).toEqual(weights);
});

it('automatically balances only the method components and preserves a total of 100', () => {
  const next = balanceWeight({ skills: 30, experience: 70, salary: 0 }, 'skills', 60, [
    'skills',
    'experience',
  ]);
  expect(next).toEqual({ skills: 60, experience: 40, salary: 0 });
  expect(
    totalWeight(
      balanceWeight({ skills: 100, experience: 0, salary: 0 }, 'skills', 50, [
        'skills',
        'experience',
      ]),
    ),
  ).toBe(100);
});
