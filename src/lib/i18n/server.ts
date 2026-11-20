import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";

import { dictionaries, LOCALE_COOKIE, resolveLocale, type Dictionary, type Locale } from "./config";

/** Locale from the cookie (request-time — call inside a <Suspense> boundary). */
export const getLocale = cache(async (): Promise<Locale> => {
  const store = await cookies();
  return resolveLocale(store.get(LOCALE_COOKIE)?.value);
});

/** Dictionary for Server Components: `const t = await getDictionary()`. */
export async function getDictionary(): Promise<Dictionary> {
  return dictionaries[await getLocale()];
}
