import { getI18nConfig } from "emdash";

export interface LocaleOption {
	code: string;
	label: string;
}

/**
 * Retrieve activated locales dynamically from the EmDash core i18n runtime config.
 */
export function getActivatedLocales(): string[] {
	const config = getI18nConfig();
	if (config?.locales && config.locales.length > 0) {
		return config.locales;
	}
	return [];
}

/**
 * Get native localized display label for a locale code (e.g. "en" -> "English", "ja" -> "日本語").
 * Uses standard Intl.DisplayNames in the target language so each language is displayed in its own endonym.
 */
export function getLocaleLabel(code: string): string {
	try {
		const names = new Intl.DisplayNames([code], { type: "language" });
		const label = names.of(code) ?? code.toUpperCase();
		return label.charAt(0).toUpperCase() + label.slice(1);
	} catch {
		return code.toUpperCase();
	}
}

/**
 * Calculate the localized target pathname when switching to a different locale.
 * Preserves the subpath and search query.
 */
export function getLocalizedPath(
	pathname: string,
	targetLocale: string,
	currentLocale?: string,
	search = "",
	knownLocales: string[] = getActivatedLocales(),
): string {
	const cleanSearch = search ? (search.startsWith("?") ? search : `?${search}`) : "";
	const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;

	// Handle root path
	if (normalizedPath === "/" || normalizedPath === "") {
		return `/${targetLocale}/${cleanSearch}`;
	}

	const allLocales = new Set([...knownLocales, ...(currentLocale ? [currentLocale] : [])]);
	if (allLocales.size > 0) {
		const regex = new RegExp(`^/(${[...allLocales].join("|")})(/.*)?$`);
		const match = normalizedPath.match(regex);

		if (match) {
			const subpath = match[2] ?? "/";
			return `/${targetLocale}${subpath}${cleanSearch}`;
		}
	}

	// If there was no locale prefix, prepend the target locale
	return `/${targetLocale}${normalizedPath}${cleanSearch}`;
}
