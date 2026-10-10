// Recovery questions: the client picks 3 distinct questions out of these 15.
// They only help recognise the client — they never restore access on their own.

export const RECOVERY_QUESTIONS = [
  'Quel surnom utilisiez-vous pendant votre enfance ?',
  'Quel était le nom de votre premier animal de compagnie ?',
  'Quel était le nom de votre école primaire ?',
  'Dans quelle rue habitiez-vous pendant votre enfance ?',
  'Quel était le prénom de votre premier meilleur ami ?',
  'Quel était le nom de votre premier professeur marquant ?',
  'Quelle destination avez-vous visitée lors de vos premières vacances dont vous vous souvenez ?',
  'Quel était le titre de votre livre préféré pendant votre enfance ?',
  'Quel était le premier concert auquel vous avez assisté ?',
  'Quel était le nom de votre premier club sportif ou de loisirs ?',
  'Quel plat aimiez-vous particulièrement pendant votre enfance ?',
  'Quel était le modèle de votre premier vélo ?',
  'Quel était le premier film que vous avez vu au cinéma ?',
  'Quel était le nom du lieu où vous avez exercé votre premier emploi ?',
  "Quel endroit fréquentiez-vous le plus après l'école ?",
] as const;

/** Questions still selectable in slot `slot`, given the choices of all slots (null = empty). */
export function availableQuestions(selected: (number | null)[], slot: number): number[] {
  const taken = new Set(selected.filter((q, i): q is number => q !== null && i !== slot));
  return RECOVERY_QUESTIONS.map((_, i) => i).filter((i) => !taken.has(i));
}

/** Normalisation before hashing/comparison: lower case, no accents, collapsed spaces, trimmed, no trailing punctuation. */
export function normalizeAnswer(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\s.,;:!?…'"«»)-]+$/u, '')
    .trim();
}
