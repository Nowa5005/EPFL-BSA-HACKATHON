// Recovery questions: the client picks 3 distinct questions out of these 15.
// They only help recognise the client — they never restore access on their own.
//
// Storage compatibility: the recovery partner stores (and returns) the question TEXT that was sent at enrolment.
// Historically that text was the French wording, so the French wording stays the canonical stored value
// (RECOVERY_QUESTIONS). The UI translates a stored question for display with questionLabel(). Answers are
// normalised and hashed independently of the language, so verification does not depend on the UI language.

import type { Lang } from './i18n';

export const RECOVERY_QUESTION_SET = [
  { id: 'nickname', en: 'What nickname did you use as a child?', fr: 'Quel surnom utilisiez-vous pendant votre enfance ?' },
  { id: 'first-pet', en: 'What was the name of your first pet?', fr: 'Quel était le nom de votre premier animal de compagnie ?' },
  { id: 'primary-school', en: 'What was the name of your primary school?', fr: 'Quel était le nom de votre école primaire ?' },
  { id: 'childhood-street', en: 'What street did you live on as a child?', fr: 'Dans quelle rue habitiez-vous pendant votre enfance ?' },
  { id: 'best-friend', en: 'What was the first name of your first best friend?', fr: 'Quel était le prénom de votre premier meilleur ami ?' },
  { id: 'teacher', en: 'What was the name of the first teacher who made an impression on you?', fr: 'Quel était le nom de votre premier professeur marquant ?' },
  { id: 'first-holiday', en: 'Where did you go on the first holiday you can remember?', fr: 'Quelle destination avez-vous visitée lors de vos premières vacances dont vous vous souvenez ?' },
  { id: 'childhood-book', en: 'What was the title of your favourite book as a child?', fr: 'Quel était le titre de votre livre préféré pendant votre enfance ?' },
  { id: 'first-concert', en: 'What was the first concert you went to?', fr: 'Quel était le premier concert auquel vous avez assisté ?' },
  { id: 'first-club', en: 'What was the name of your first sports or hobby club?', fr: 'Quel était le nom de votre premier club sportif ou de loisirs ?' },
  { id: 'childhood-dish', en: 'What dish did you particularly like as a child?', fr: 'Quel plat aimiez-vous particulièrement pendant votre enfance ?' },
  { id: 'first-bike', en: 'What was the model of your first bike?', fr: 'Quel était le modèle de votre premier vélo ?' },
  { id: 'first-film', en: 'What was the first film you saw at the cinema?', fr: 'Quel était le premier film que vous avez vu au cinéma ?' },
  { id: 'first-job', en: 'What was the name of the place where you had your first job?', fr: 'Quel était le nom du lieu où vous avez exercé votre premier emploi ?' },
  { id: 'after-school', en: 'Where did you spend most of your time after school?', fr: "Quel endroit fréquentiez-vous le plus après l'école ?" },
] as const;

/** Canonical stored values (French wording, as stored by existing enrolments). Send these to the server. */
export const RECOVERY_QUESTIONS: readonly string[] = RECOVERY_QUESTION_SET.map((q) => q.fr);

/** Display text of question `i` in `lang`. */
export const questionText = (i: number, lang: Lang): string => {
  const q = RECOVERY_QUESTION_SET[i];
  return q ? q[lang] : '';
};

/** Display a stored question (canonical French text, English text or id) in `lang`; unknown text is shown as is. */
export function questionLabel(stored: string, lang: Lang): string {
  const q = RECOVERY_QUESTION_SET.find((x) => x.fr === stored || x.en === stored || x.id === stored);
  return q ? q[lang] : stored;
}

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
