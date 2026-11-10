import { describe, expect, it } from 'vitest';
import { EXERCISES } from './fitness-catalogue.ts';
import { cycleSeconds, LEN, MOVES, place, pointsOf, poseAt, reach } from './fitness-moves.ts';

describe('animations des exercices', () => {
  it('chaque exercice du catalogue a la sienne', () => {
    expect(EXERCISES.filter((e) => !MOVES[e.id]).map((e) => e.id)).toEqual([]);
  });

  it('le bonhomme ne passe jamais sous le sol, et y garde un appui (sauf en l’air)', () => {
    for (const [id, move] of Object.entries(MOVES)) {
      const cycle = cycleSeconds(move);
      for (let i = 0; i < 40; i++) {
        const pose = poseAt(move, (i / 40) * cycle);
        const f = place(move, pose);
        const lowest = Math.max(f.head[1] + LEN.head, ...pointsOf(f).map(([, y]) => y));
        expect(lowest, id).toBeLessThan(1.5);
        if (!pose.lift && !pose.at && !move.props) expect(lowest, id).toBeGreaterThan(-1.5);
      }
    }
  });

  it('les mains et les pieds décrits par points tombent où il faut', () => {
    const [thigh, shin] = reach(10, 30, LEN.thigh, LEN.shin, 1);
    const knee = [Math.sin((thigh * Math.PI) / 180) * LEN.thigh, Math.cos((thigh * Math.PI) / 180) * LEN.thigh];
    const ankle = [knee[0] + Math.sin((shin * Math.PI) / 180) * LEN.shin, knee[1] + Math.cos((shin * Math.PI) / 180) * LEN.shin];
    expect(ankle[0]).toBeCloseTo(10, 5);
    expect(ankle[1]).toBeCloseTo(30, 5);
    expect(knee[0]).toBeGreaterThan(0); // genou vers l'avant
    const dips = place(MOVES['dips-genoux'], MOVES['dips-genoux'].poses[1]);
    expect(dips.arms[0][1][0]).toBeCloseTo(0, 1);
    expect(dips.arms[0][1][1]).toBeCloseTo(-25, 1);
  });
});
