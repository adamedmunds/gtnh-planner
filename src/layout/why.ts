/** Why a line couldn't be laid out, in plain words, with what to try. */
export interface FailureReason {
  text: string;
  /** What to try, as one sentence (`tips` joined). */
  advice: string;
  /** What to try, one tip each (the same tip can come with several reasons). */
  tips: string[];
  /** How many of the layouts tried failed this way. */
  count: number;
}

const STRAIGHT = 'Try ticking "Straight line" (one long row gives machines more room around them)';
const SPLIT = 'Build part of the chain as its own line (fewer different pipes in one place)';
const FEWER = 'Pick a recipe or machine with fewer inputs and outputs for it';
const FUEL = 'Give the line more fuel (raise what you have) so it gets more generators, or power it from outside';
const VOLTS = 'Use one voltage for the machines that repeat in each slice, and generators of that voltage (or one above)';

/** Patterns of the layout code's failure reasons, turned into plain words and advice. */
const RULES: { test: RegExp; text: (m: RegExpMatchArray) => string; tips: string[] | ((m: RegExpMatchArray) => string[]) }[] = [
  {
    test: /^(.+) needs (\w+) power, but the line's power is (\w+)$/,
    text: (m) => `The ${m[1]} needs ${m[2]} power, but the line's power is ${m[3]} (GT machines can't run below their recipe's voltage)`,
    tips: (m) => [
      `Use ${m[2]} generators instead of ${m[3]} ones`,
      `Or remove the generator and bring ${m[2]} power in from outside`,
      `Or pick a ${m[3]} machine and recipe for that step`,
    ],
  },
  {
    test: /^The (.+?) at \(.+?\) is a single block/,
    text: (m) => `The ${m[1]} couldn't be laid out whole: there was no room for its casings and hatches`,
    tips: (m) => [SPLIT, `Or build the ${m[1]} yourself beside the line`],
  },
  {
    test: /^The (.+?) has no energy hatch$/,
    text: (m) => `The ${m[1]} has no energy hatch, so it can't run`,
    tips: (m) => [`Give the ${m[1]} an energy hatch with its power cable on the hatch's front`],
  },
  {
    test: /no free face on the (.+?) for (.+)$/,
    text: (m) => `The ${m[1]} has more pipes than free sides (it needed one for ${m[2]})`,
    tips: [FEWER, STRAIGHT],
  },
  {
    test: /no room to join the (.+?) runs/,
    text: (m) => `Couldn't connect all the ${m[1]} pipes: too many pipes cross in a small space`,
    tips: [STRAIGHT, SPLIT],
  },
  {
    test: /no room to run (.+?) in the (core|line|slice)/,
    text: (m) => `No way through for the ${m[1]} in the ${m[2] === 'line' ? 'line' : m[2]}`,
    tips: [STRAIGHT, SPLIT],
  },
  {
    test: /no straight run left for (.+)/,
    text: (m) => `No straight run left for the ${m[1]}: too many different pipes run through each slice`,
    tips: [STRAIGHT, SPLIT],
  },
  {
    test: /not enough generators|more machines than the transformers can feed/,
    text: () => "The generators in a slice can't cover what its machines use",
    tips: [FUEL],
  },
  {
    test: /voltages|different voltage|supply|generators of different/,
    text: () => 'Machines of different voltages ended up sharing power',
    tips: [VOLTS],
  },
  {
    test: /burns|carrying (LV|MV|HV)/,
    text: () => 'A cable would have touched one of a higher voltage',
    tips: [STRAIGHT],
  },
  {
    test: /^core:|core/,
    text: () => 'The core (the one-off machines in the middle) has too many pipes to fit',
    tips: [STRAIGHT, SPLIT],
  },
];

/** Groups raw reasons, explains each, most common first (`fallbackTips` for reasons no rule knows). */
export function explainFailures(raw: string[], fallbackTips: string[] = [STRAIGHT, SPLIT]): FailureReason[] {
  const out = new Map<string, FailureReason>();
  for (const r of raw) {
    const reason = r.replace(/^(core|check|slice): /, '');
    const rule = RULES.find((x) => x.test.test(reason)) ?? RULES.find((x) => x.test.test(r));
    const m = rule ? reason.match(rule.test) ?? r.match(rule.test)! : undefined;
    const text = rule && m ? rule.text(m) : reason.charAt(0).toUpperCase() + reason.slice(1);
    const tips = !rule ? fallbackTips : typeof rule.tips === 'function' ? rule.tips(m!) : rule.tips;
    const prev = out.get(text);
    out.set(text, { text, tips, advice: tips.join('. '), count: (prev?.count ?? 0) + 1 });
  }
  return [...out.values()].sort((a, b) => b.count - a.count);
}

/** Thrown when no layout fits: the reasons, most common first, and the first in the message. */
export class LayoutFailure extends Error {
  readonly reasons: FailureReason[];
  constructor(raw: string[]) {
    const reasons = explainFailures(raw).slice(0, 4);
    const first = reasons[0]?.text;
    super(`Couldn't lay out this line: ${first ? first.charAt(0).toLowerCase() + first.slice(1) : "there isn't room to connect all its pipes and cables"}.`);
    this.name = 'LayoutFailure';
    this.reasons = reasons;
  }
}
