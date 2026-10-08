// Telegram Serverless doesn't expose Railway-style ADMIN_IDS environment
// variables to runtime modules. Keep numeric IDs here once the migration is
// deployed. Do not put tokens or other secrets in this file.
//
// Empty by default on this branch because main obtains the value only from its
// deployment environment, which isn't committed to the repository.
export const DEVELOPER_IDS = Object.freeze([]);

const DEVELOPER_SET = new Set(DEVELOPER_IDS.map((value) => Number(value)));

export function isDeveloper(userId) {
  const id = Number(userId);
  return Number.isSafeInteger(id) && DEVELOPER_SET.has(id);
}

export function primaryDeveloperId() {
  return DEVELOPER_IDS.length ? Number(DEVELOPER_IDS[0]) : null;
}
