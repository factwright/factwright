/** Checks one value of a resume or a letter, naming each problem by where it is. */
export type Check = (value: unknown, where: string, problems: string[]) => void;

export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function text(required: boolean): Check {
  return (value, where, problems) => {
    if (value === undefined || value === null) {
      if (required) problems.push(`${where} is missing.`);
    } else if (typeof value !== 'string') {
      problems.push(`${where} should be text.`);
    }
  };
}

export const yesOrNo: Check = (value, where, problems) => {
  if (value !== undefined && value !== null && typeof value !== 'boolean') {
    problems.push(`${where} should be true or false.`);
  }
};

export function list(item: Check, required = false): Check {
  return (value, where, problems) => {
    if (value === undefined || value === null) {
      if (required) problems.push(`${where} is missing.`);
      return;
    }
    if (!Array.isArray(value)) {
      problems.push(`${where} should be a list.`);
      return;
    }
    for (const [i, each] of value.entries()) item(each, `${where}[${i}]`, problems);
  };
}

export function shape(fields: Record<string, Check>, required = true): Check {
  return (value, where, problems) => {
    if (value === undefined || value === null) {
      if (required) problems.push(`${where} is missing.`);
      return;
    }
    if (!isObject(value)) {
      problems.push(`${where} should be an object.`);
      return;
    }
    for (const [key, check] of Object.entries(fields))
      check(value[key], `${where}.${key}`, problems);
  };
}

/** The contact details at the top of a resume or a letter. */
export const contactCheck = shape(
  {
    phone: text(false),
    email: text(false),
    linkedin: text(false),
    location: text(false),
    website: text(false),
  },
  false,
);
